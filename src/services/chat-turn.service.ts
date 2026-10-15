// What happens when the user sends a chat message, confirms a booking, or books from the form.
//
// Each message: ask the AI to extract details -> merge them into the draft -> check the draft
// against the real booking rules -> decide the reply -> commit. The AI only extracts and phrases
// follow-up questions; whether a slot is free, and the booking itself, are decided here.
//
// Every turn is written by commitTurn in one transaction that first claims the session (it must
// still be ACTIVE and at the version this request read). Overlapping requests on one conversation
// therefore can't overwrite each other's draft or both book: the later one gets a 409.
import type { ExtractionContext } from "../ai/booking-extraction.prompt.js";
import type { BookingExtraction } from "../ai/booking-extraction.schema.js";
import { extractBookingDetails } from "../ai/extract-booking-details.js";
import { bookingRules } from "../config/booking.js";
import type { BookingSource, ChatSession } from "../generated/prisma/client.js";
import { addMinutes, businessDateTime, formatBusinessTime, toBusinessDate, weekdayName } from "../lib/business-time.js";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { parseBookingDraft, type BookingDraft } from "../schemas/booking-draft.schema.js";

import { logAiInteraction } from "./ai-interaction.service.js";
import { safeAcknowledgement, safeFollowUp } from "./ai-text-guard.service.js";
import { createAppointment, type AppointmentView } from "./appointment.service.js";
import { describeOpeningHours } from "./booking-rules.service.js";
import { evaluateDraft, isSameDraft, mergeDraft, type DraftEvaluation } from "./booking-draft.service.js";
import { chatReplies } from "./chat-replies.service.js";
import {
  getActiveOwnedSession,
  getRecentMessages,
  toSessionView,
  type ChatMessageView,
  type SessionView,
} from "./chat-session.service.js";
import { getActiveServiceOrThrow, listActiveServices, type ServiceView } from "./service-catalog.service.js";

/** Messages sent to the AI as conversation memory (including the new one). */
const HISTORY_LIMIT = 10;
/** Messages in a row with no new detail before the form is suggested. */
const STALLED_TURNS_BEFORE_FORM = 3;
/** Messages in a row with no new detail before the conversation is closed (spam protection). */
const STALLED_TURNS_BEFORE_CLOSE = 5;
const CALENDAR_DAYS = 14;

const CONVERSATION_CHANGED = "This conversation was updated somewhere else, like another tab. Please try again.";

export type TurnResult = {
  userMessage: ChatMessageView;
  assistantMessage: ChatMessageView;
  session: SessionView;
  /** Why the UI should point the user to the form this turn, or null. */
  formSuggestion: FormSuggestion | null;
};

/**
 * requested: the user asked for the form (open it). stuck: several messages without progress.
 * ai_unavailable: the AI call failed. The last two only show a "Fill in the form" action.
 */
export type FormSuggestion = "requested" | "stuck" | "ai_unavailable";

/** An appointment to create as part of committing the turn. */
type BookingRequest = {
  serviceId: string;
  startsAt: Date;
  notes: string | undefined;
  source: BookingSource;
};

/** The outcome of one turn, decided but not yet saved. */
type TurnOutcome = {
  reply: string;
  draft: BookingDraft;
  stalledTurns: number;
  formSuggestion: FormSuggestion | null;
  /** Set when this turn ends the conversation: an appointment is made, or it went nowhere. */
  ending: "booked" | "stalled" | null;
  booking?: BookingRequest;
  evaluation?: DraftEvaluation;
};

/** The user's message, saved only if the turn commits, so a rejected turn leaves nothing behind. */
type IncomingMessage = { content: string; receivedAt: Date };

/** Thrown inside the commit when the appointment insert is refused (slot taken, rule broken). */
class BookingRejected extends Error {
  constructor(readonly reason: HttpError) {
    super(reason.message);
    this.name = "BookingRejected";
  }
}

export async function sendMessage(userId: string, sessionId: string, content: string): Promise<TurnResult> {
  const incoming: IncomingMessage = { content, receivedAt: new Date() };
  const session = await getActiveOwnedSession(userId, sessionId);

  const draft = parseBookingDraft(session.bookingDraft);
  const services = await listActiveServices();
  const context = buildExtractionContext(draft, services, incoming.receivedAt);
  const history = [...(await getRecentMessages(sessionId, HISTORY_LIMIT - 1)), { role: "USER" as const, content }];

  const ai = await extractBookingDetails(context, history);
  await logAiInteraction({ userId, sessionId, input: { context, history }, result: ai });

  const outcome: TurnOutcome = ai.ok
    ? await decideTurn(session, draft, ai.extraction, services)
    : // The AI failed or answered nonsense: keep the draft and offer the form.
      // The counter is kept as is: an AI outage isn't the user's fault, but it mustn't reset spam either.
      {
        reply: chatReplies.aiUnavailable,
        draft,
        stalledTurns: session.stalledTurns,
        formSuggestion: "ai_unavailable",
        ending: null,
      };

  const committed = await commitChatTurn(userId, session, outcome, incoming);
  if (!committed.userMessage) {
    throw new Error("The user message was not saved with the turn");
  }
  return {
    userMessage: committed.userMessage,
    assistantMessage: committed.assistantMessage,
    session: committed.session,
    formSuggestion: outcome.formSuggestion,
  };
}

/** The "Confirm booking" button: books the current draft if it's complete and still free. */
export async function confirmBooking(userId: string, sessionId: string) {
  const session = await getActiveOwnedSession(userId, sessionId);
  const draft = parseBookingDraft(session.bookingDraft);
  const evaluation = await evaluateDraft(draft);

  if (evaluation.status === "incomplete") {
    throw HttpError.unprocessable(chatReplies.incompleteForConfirm);
  }

  const outcome =
    evaluation.status === "ready"
      ? bookingOutcome(draft, evaluation, session.stalledTurns)
      : unavailableOutcome(evaluation, draft, session.stalledTurns);

  const { assistantMessage, session: updated } = await commitChatTurn(userId, session, outcome);
  return { assistantMessage, session: updated };
}

/** The form fallback for a chat: books with source FORM and closes the conversation, atomically. */
export async function bookFromForm(
  userId: string,
  input: { chatSessionId: string; serviceId: string; startsAt: Date; notes?: string | undefined },
): Promise<AppointmentView> {
  const session = await getActiveOwnedSession(userId, input.chatSessionId);
  const service = await getActiveServiceOrThrow(input.serviceId);

  const outcome: TurnOutcome = {
    reply: chatReplies.booked(service, input.startsAt),
    // The form may have changed details, so the draft is rewritten to what's being booked.
    draft: {
      serviceId: service.id,
      date: toBusinessDate(input.startsAt),
      time: formatBusinessTime(input.startsAt),
      notes: input.notes ?? null,
    },
    stalledTurns: 0,
    formSuggestion: null,
    ending: "booked",
    booking: { serviceId: service.id, startsAt: input.startsAt, notes: input.notes, source: "FORM" },
  };

  try {
    const { appointment } = await commitTurn(userId, session, outcome);
    if (!appointment) {
      throw new Error("The appointment was not created with the turn");
    }
    return appointment;
  } catch (error) {
    // The form shows the API's reason (slot taken, outside opening hours) as is.
    if (error instanceof BookingRejected) throw error.reason;
    throw error;
  }
}

async function decideTurn(
  session: ChatSession,
  draft: BookingDraft,
  extraction: BookingExtraction,
  services: ServiceView[],
): Promise<TurnOutcome> {
  const { updates, intent } = extraction;
  // Changing an existing appointment isn't supported. Details in such a message ("move it to
  // Tuesday") are ignored, so it can't quietly turn into a second booking.
  const managesExisting = intent === "manage_existing";
  const nextDraft = managesExisting
    ? draft
    : mergeDraft(draft, {
        // The schema only allows real service names, so this lookup always finds a match.
        serviceId: services.find((s) => s.name === updates.service)?.id ?? null,
        date: updates.date,
        time: updates.time,
        notes: updates.notes,
      });
  const changed = !isSameDraft(draft, nextDraft);

  // Every reply is: what the AI understood (checked) + what the backend knows to be true.
  const lead = leadSentence(extraction, draft, nextDraft);
  const withLead = (text: string) => (lead ? `${lead} ${text}` : text);

  if (intent === "want_form") {
    return {
      reply: withLead(chatReplies.openForm),
      draft: nextDraft,
      // Not progress on the booking itself, so asking repeatedly can't dodge the spam limit.
      stalledTurns: session.stalledTurns,
      formSuggestion: "requested",
      ending: null,
    };
  }

  // A "yes" to a proposal is progress even though it changes nothing in the draft.
  const madeProgress = changed || intent === "confirm";
  const stalledTurns = madeProgress ? 0 : session.stalledTurns + 1;

  // Spam protection: close the conversation after several messages that went nowhere, whatever
  // state it's in. Checked before anything else so spam costs no further database work.
  if (stalledTurns >= STALLED_TURNS_BEFORE_CLOSE) {
    return { reply: chatReplies.closedNoProgress, draft: nextDraft, stalledTurns, formSuggestion: null, ending: "stalled" };
  }

  if (managesExisting) {
    return { reply: chatReplies.cannotManageExisting, draft, stalledTurns, formSuggestion: null, ending: null };
  }

  const evaluation = await evaluateDraft(nextDraft);

  if (evaluation.status === "ready") {
    // A "yes" that also changes a detail is a new proposal, not a confirmation.
    if (intent === "confirm" && !changed) {
      return bookingOutcome(nextDraft, evaluation, stalledTurns);
    }
    // The proposal already states service, day and time, so an acknowledgement would only repeat
    // it. It's kept only when it carries something new: a note added in this message.
    const proposal = chatReplies.confirmPrompt(evaluation.service, evaluation.startsAt);
    const reply = noteLead(draft, nextDraft) ? withLead(proposal) : proposal;
    return { reply, draft: nextDraft, stalledTurns, formSuggestion: null, ending: null, evaluation };
  }

  if (evaluation.status === "unavailable") {
    // No AI text next to a "no": it tends to restate the time that just turned out to be taken.
    // Only a newly added note is mentioned, in our own words.
    return unavailableOutcome(evaluation, nextDraft, stalledTurns, noteLead(draft, nextDraft));
  }

  // Still collecting: the AI's follow-up question (if it passes the guard), plus a nudge to the
  // form if the conversation is stuck.
  const followUp = withLead(safeFollowUp(extraction.reply) ?? chatReplies.nextQuestion(nextDraft, services));
  // Suggested once, when the count reaches the threshold. The count keeps going towards closing.
  return stalledTurns === STALLED_TURNS_BEFORE_FORM
    ? {
        reply: `${followUp} ${chatReplies.suggestForm}`,
        draft: nextDraft,
        stalledTurns,
        formSuggestion: "stuck",
        ending: null,
        evaluation,
      }
    : { reply: followUp, draft: nextDraft, stalledTurns, formSuggestion: null, ending: null, evaluation };
}

/** The AI's acknowledgement if it passes the guard. A newly added note is never left unmentioned. */
function leadSentence(extraction: BookingExtraction, draft: BookingDraft, nextDraft: BookingDraft): string | null {
  return safeAcknowledgement(extraction.acknowledgement) ?? noteLead(draft, nextDraft);
}

function noteLead(draft: BookingDraft, nextDraft: BookingDraft): string | null {
  return nextDraft.notes && nextDraft.notes !== draft.notes ? chatReplies.noteAdded(nextDraft.notes) : null;
}

/** Books the draft. The appointment itself is created when the turn commits. */
function bookingOutcome(
  draft: BookingDraft,
  evaluation: Extract<DraftEvaluation, { status: "ready" }>,
  stalledTurns: number,
): TurnOutcome {
  return {
    reply: chatReplies.booked(evaluation.service, evaluation.startsAt),
    draft,
    stalledTurns,
    formSuggestion: null,
    ending: "booked",
    booking: {
      serviceId: evaluation.service.id,
      startsAt: evaluation.startsAt,
      notes: draft.notes ?? undefined,
      source: "CHAT",
    },
  };
}

/** Explains why the slot can't be booked and drops the parts the user needs to choose again. */
function unavailableOutcome(
  evaluation: Extract<DraftEvaluation, { status: "unavailable" }>,
  draft: BookingDraft,
  stalledTurns: number,
  lead: string | null = null,
): TurnOutcome {
  const date = draft.date ?? toBusinessDate(new Date());
  const hasAlternatives = evaluation.alternatives.length > 0;
  return {
    reply: [lead, chatReplies.unavailable(evaluation.reason, date, evaluation.alternatives, evaluation.requestedStart)]
      .filter(Boolean)
      .join(" "),
    // Free times exist that day: only the time needs to change. Otherwise the date does too.
    draft: { ...draft, time: null, date: hasAlternatives ? draft.date : null },
    stalledTurns,
    formSuggestion: null,
    ending: null,
  };
}

/**
 * Commits a chat turn. If its booking is refused because the slot was taken between the check and
 * the insert, the turn is committed again as "that time is gone, here are the free ones".
 */
async function commitChatTurn(userId: string, session: ChatSession, outcome: TurnOutcome, incoming?: IncomingMessage) {
  try {
    return await commitTurn(userId, session, outcome, incoming);
  } catch (error) {
    if (!(error instanceof BookingRejected)) throw error;

    const fresh = await evaluateDraft(outcome.draft);
    const fallback: TurnOutcome =
      fresh.status === "unavailable"
        ? unavailableOutcome(fresh, outcome.draft, outcome.stalledTurns)
        : { ...outcome, reply: error.reason.message, ending: null, booking: undefined };
    return commitTurn(userId, session, fallback, incoming);
  }
}

/**
 * Writes a turn in one transaction: claim the session, create the appointment (if booking), save
 * the user's message and the reply, update the draft. All of it happens, or none of it does.
 */
async function commitTurn(userId: string, session: ChatSession, outcome: TurnOutcome, incoming?: IncomingMessage) {
  const committed = await prisma.$transaction(async (tx) => {
    // The claim: matches only if the session is still active and nobody committed since we read it.
    // It also locks the row, so a concurrent turn waits here and then fails this same check.
    const claimed = await tx.chatSession.updateMany({
      where: { id: session.id, status: "ACTIVE", version: session.version },
      data: { version: { increment: 1 } },
    });
    if (claimed.count === 0) {
      throw HttpError.conflict(CONVERSATION_CHANGED);
    }

    let appointment: AppointmentView | null = null;
    if (outcome.booking) {
      try {
        appointment = await createAppointment({ userId, ...outcome.booking, chatSessionId: session.id }, tx);
      } catch (error) {
        if (error instanceof HttpError) throw new BookingRejected(error);
        throw error;
      }
    }

    const messageSelect = { id: true, role: true, content: true, createdAt: true } as const;
    // Explicit timestamps: inside one transaction Postgres' now() is the same for every row.
    const userMessage = incoming
      ? await tx.chatMessage.create({
          data: { sessionId: session.id, role: "USER", content: incoming.content, createdAt: incoming.receivedAt },
          select: messageSelect,
        })
      : null;
    const assistantMessage = await tx.chatMessage.create({
      data: { sessionId: session.id, role: "ASSISTANT", content: outcome.reply, createdAt: new Date() },
      select: messageSelect,
    });

    const next = await tx.chatSession.update({
      where: { id: session.id },
      data: {
        bookingDraft: outcome.draft,
        stalledTurns: outcome.stalledTurns,
        lastMessageAt: assistantMessage.createdAt,
        ...(outcome.ending ? { status: "CLOSED" as const } : {}),
      },
    });

    return { userMessage, assistantMessage, appointment, next };
  });

  // The evaluation is only still valid if the conversation is still going.
  const evaluation = outcome.evaluation && !outcome.ending ? outcome.evaluation : undefined;
  return {
    userMessage: committed.userMessage,
    assistantMessage: committed.assistantMessage,
    appointment: committed.appointment,
    session: await toSessionView(committed.next, evaluation),
  };
}

function buildExtractionContext(draft: BookingDraft, services: ServiceView[], now: Date): ExtractionContext {
  const today = toBusinessDate(now);
  const noonToday = businessDateTime(today, 12 * 60);
  const calendar = Array.from({ length: CALENDAR_DAYS }, (_, day) => {
    const date = toBusinessDate(addMinutes(noonToday, day * 24 * 60));
    return `${weekdayName(date).slice(0, 3)} ${date}`;
  });

  return {
    today: `${weekdayName(today)} ${today}`,
    timeZone: bookingRules.timeZone,
    openingHours: describeOpeningHours(),
    calendar,
    services: services.map((s) => ({ name: s.name, durationMinutes: s.durationMinutes })),
    draft: {
      service: services.find((s) => s.id === draft.serviceId)?.name ?? null,
      date: draft.date,
      time: draft.time,
      notes: draft.notes,
    },
  };
}

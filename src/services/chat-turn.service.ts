// What happens when the user sends a chat message, confirms a booking, or books from the form.
//
// Each message: save it -> ask the AI to extract details -> merge them into the draft -> check the
// draft against the real booking rules -> reply. The AI only extracts and phrases follow-up
// questions; whether a slot is free, and the booking itself, are decided here.
import type { ExtractionContext } from "../ai/booking-extraction.prompt.js";
import type { BookingExtraction } from "../ai/booking-extraction.schema.js";
import { extractBookingDetails } from "../ai/extract-booking-details.js";
import { bookingRules } from "../config/booking.js";
import type { ChatSession } from "../generated/prisma/client.js";
import { addMinutes, businessDateTime, formatBusinessTime, toBusinessDate, weekdayName } from "../lib/business-time.js";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { parseBookingDraft, type BookingDraft } from "../schemas/booking-draft.schema.js";

import { logAiInteraction } from "./ai-interaction.service.js";
import { createAppointment, type AppointmentView } from "./appointment.service.js";
import { describeOpeningHours } from "./booking-rules.service.js";
import { evaluateDraft, isSameDraft, mergeDraft, type DraftEvaluation } from "./booking-draft.service.js";
import { chatReplies } from "./chat-replies.service.js";
import {
  getActiveOwnedSession,
  getRecentMessages,
  saveMessage,
  toSessionView,
  type ChatMessageView,
  type SessionView,
} from "./chat-session.service.js";
import { listActiveServices, type ServiceView } from "./service-catalog.service.js";

/** Messages sent to the AI as conversation memory. */
const HISTORY_LIMIT = 10;
/** Messages in a row with no new detail before the form is suggested. */
const STALLED_TURNS_BEFORE_FORM = 3;
const CALENDAR_DAYS = 14;

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

/** The outcome of one turn, before it's saved. */
type TurnOutcome = {
  reply: string;
  draft: BookingDraft;
  stalledTurns: number;
  formSuggestion: FormSuggestion | null;
  booked: boolean;
  evaluation?: DraftEvaluation;
};

export async function sendMessage(userId: string, sessionId: string, content: string): Promise<TurnResult> {
  const session = await getActiveOwnedSession(userId, sessionId);
  const userMessage = await saveMessage(sessionId, "USER", content);

  const draft = parseBookingDraft(session.bookingDraft);
  const services = await listActiveServices();
  const context = buildExtractionContext(draft, services, new Date());
  const history = await getRecentMessages(sessionId, HISTORY_LIMIT);

  const ai = await extractBookingDetails(context, history);
  await logAiInteraction({ userId, sessionId, input: { context, history }, result: ai });

  const outcome: TurnOutcome = ai.ok
    ? await decideTurn(userId, session, draft, ai.extraction, services)
    : // The AI failed or answered nonsense: keep the draft and offer the form.
      { reply: chatReplies.aiUnavailable, draft, stalledTurns: 0, formSuggestion: "ai_unavailable", booked: false };

  const { assistantMessage, session: updated } = await saveTurn(session, outcome);
  return { userMessage, assistantMessage, session: updated, formSuggestion: outcome.formSuggestion };
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
      ? await book(userId, session, draft, evaluation, session.stalledTurns)
      : unavailableOutcome(evaluation, draft, session.stalledTurns);

  return saveTurn(session, outcome);
}

/** The form fallback for a chat: books with source FORM and closes the conversation. */
export async function bookFromForm(
  userId: string,
  input: { chatSessionId: string; serviceId: string; startsAt: Date; notes?: string | undefined },
): Promise<AppointmentView> {
  const session = await getActiveOwnedSession(userId, input.chatSessionId);
  const appointment = await createAppointment({ userId, ...input, source: "FORM" });

  await saveTurn(session, {
    reply: chatReplies.booked(appointment.service, appointment.startsAt),
    // The form may have changed details, so the draft is rewritten to what was actually booked.
    draft: {
      serviceId: appointment.service.id,
      date: toBusinessDate(appointment.startsAt),
      time: formatBusinessTime(appointment.startsAt),
      notes: appointment.notes,
    },
    stalledTurns: 0,
    formSuggestion: null,
    booked: true,
  });
  return appointment;
}

async function decideTurn(
  userId: string,
  session: ChatSession,
  draft: BookingDraft,
  extraction: BookingExtraction,
  services: ServiceView[],
): Promise<TurnOutcome> {
  const { updates, intent } = extraction;
  const nextDraft = mergeDraft(draft, {
    // The schema only allows real service names, so this lookup always finds a match.
    serviceId: services.find((s) => s.name === updates.service)?.id ?? null,
    date: updates.date,
    time: updates.time,
    notes: updates.notes,
  });
  const changed = !isSameDraft(draft, nextDraft);

  if (intent === "want_form") {
    return { reply: chatReplies.openForm, draft: nextDraft, stalledTurns: 0, formSuggestion: "requested", booked: false };
  }

  const stalledTurns = changed ? 0 : session.stalledTurns + 1;
  const evaluation = await evaluateDraft(nextDraft);

  if (evaluation.status === "ready") {
    // A "yes" that also changes a detail is a new proposal, not a confirmation.
    if (intent === "confirm" && !changed) {
      return book(userId, session, nextDraft, evaluation, stalledTurns);
    }
    const reply = chatReplies.confirmPrompt(evaluation.service, evaluation.startsAt);
    return { reply, draft: nextDraft, stalledTurns: 0, formSuggestion: null, booked: false, evaluation };
  }

  if (evaluation.status === "unavailable") {
    return unavailableOutcome(evaluation, nextDraft, stalledTurns);
  }

  // Still collecting: Gemini's short follow-up question, plus a nudge to the form if stuck.
  return stalledTurns >= STALLED_TURNS_BEFORE_FORM
    ? {
        reply: `${extraction.reply} ${chatReplies.suggestForm}`,
        draft: nextDraft,
        stalledTurns: 0,
        formSuggestion: "stuck",
        booked: false,
        evaluation,
      }
    : { reply: extraction.reply, draft: nextDraft, stalledTurns, formSuggestion: null, booked: false, evaluation };
}

async function book(
  userId: string,
  session: ChatSession,
  draft: BookingDraft,
  evaluation: Extract<DraftEvaluation, { status: "ready" }>,
  stalledTurns: number,
): Promise<TurnOutcome> {
  try {
    await createAppointment({
      userId,
      serviceId: evaluation.service.id,
      startsAt: evaluation.startsAt,
      notes: draft.notes ?? undefined,
      source: "CHAT",
      chatSessionId: session.id,
    });
  } catch (error) {
    // Someone else took the slot between the check and the insert: offer the remaining times.
    if (error instanceof HttpError && (error.status === 409 || error.status === 422)) {
      const fresh = await evaluateDraft(draft);
      if (fresh.status === "unavailable") return unavailableOutcome(fresh, draft, stalledTurns);
    }
    throw error;
  }

  const reply = chatReplies.booked(evaluation.service, evaluation.startsAt);
  return { reply, draft, stalledTurns: 0, formSuggestion: null, booked: true };
}

/** Explains why the slot can't be booked and drops the parts the user needs to choose again. */
function unavailableOutcome(
  evaluation: Extract<DraftEvaluation, { status: "unavailable" }>,
  draft: BookingDraft,
  stalledTurns: number,
): TurnOutcome {
  const date = draft.date ?? toBusinessDate(new Date());
  const hasAlternatives = evaluation.alternatives.length > 0;
  return {
    reply: chatReplies.unavailable(evaluation.reason, date, evaluation.alternatives),
    // Free times exist that day: only the time needs to change. Otherwise the date does too.
    draft: { ...draft, time: null, date: hasAlternatives ? draft.date : null },
    stalledTurns,
    formSuggestion: null,
    booked: false,
  };
}

/** Saves the assistant reply and the session's new state together. */
async function saveTurn(session: ChatSession, outcome: TurnOutcome) {
  const updated = await prisma.$transaction(async (tx) => {
    const message = await tx.chatMessage.create({
      data: { sessionId: session.id, role: "ASSISTANT", content: outcome.reply },
      select: { id: true, role: true, content: true, createdAt: true },
    });
    const next = await tx.chatSession.update({
      where: { id: session.id },
      data: {
        bookingDraft: outcome.draft,
        stalledTurns: outcome.stalledTurns,
        lastMessageAt: message.createdAt,
        ...(outcome.booked ? { status: "CLOSED" as const } : {}),
      },
    });
    return { message, next };
  });

  // The evaluation is only still valid if the draft wasn't changed after it was made.
  const evaluation = outcome.evaluation && !outcome.booked ? outcome.evaluation : undefined;
  return { assistantMessage: updated.message, session: await toSessionView(updated.next, evaluation) };
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

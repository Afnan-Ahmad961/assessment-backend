// Chat sessions and their messages: starting a conversation, reading it (including polling for new
// messages), and the session shape returned to the client. A user has at most one ACTIVE session.
import type { ChatSession, Prisma } from "../generated/prisma/client.js";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { parseBookingDraft } from "../schemas/booking-draft.schema.js";

import { findAppointmentForSession, type AppointmentView } from "./appointment.service.js";
import { evaluateDraft, type DraftEvaluation } from "./booking-draft.service.js";
import { chatReplies } from "./chat-replies.service.js";
import { findActiveService, listActiveServices } from "./service-catalog.service.js";

const MAX_MESSAGES = 200;

const messageSelect = { id: true, role: true, content: true, createdAt: true } satisfies Prisma.ChatMessageSelect;

export type ChatMessageView = Prisma.ChatMessageGetPayload<{ select: typeof messageSelect }>;

/**
 * collecting: details still being gathered. confirming: complete and bookable, waiting for "yes".
 * booked: an appointment was made. closed: ended without a booking (a new session was started).
 */
export type ChatState = "collecting" | "confirming" | "booked" | "closed";

export type SessionView = {
  id: string;
  status: ChatSession["status"];
  state: ChatState;
  draft: {
    service: { id: string; name: string; durationMinutes: number } | null;
    date: string | null;
    time: string | null;
    notes: string | null;
  };
  appointment: AppointmentView | null;
  createdAt: Date;
  lastMessageAt: Date | null;
};

export type SessionWithMessages = { session: SessionView; messages: ChatMessageView[] };

/** Closes the user's active session (if any) and starts a fresh one with a greeting. */
export async function startSession(userId: string): Promise<SessionWithMessages> {
  const greeting = chatReplies.greeting(await listActiveServices());

  const session = await prisma.$transaction(async (tx) => {
    await tx.chatSession.updateMany({ where: { userId, status: "ACTIVE" }, data: { status: "CLOSED" } });
    return tx.chatSession.create({
      data: { userId, lastMessageAt: new Date(), messages: { create: { role: "ASSISTANT", content: greeting } } },
    });
  });

  return getSession(userId, session.id);
}

export async function getActiveSession(userId: string): Promise<SessionWithMessages> {
  const session = await prisma.chatSession.findFirst({ where: { userId, status: "ACTIVE" } });
  if (!session) {
    throw HttpError.notFound("No active conversation");
  }
  return getSession(userId, session.id);
}

/** The session and its messages. With `after`, only messages newer than that time (for polling). */
export async function getSession(userId: string, sessionId: string, after?: Date): Promise<SessionWithMessages> {
  const session = await getOwnedSession(userId, sessionId);
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId, ...(after ? { createdAt: { gt: after } } : {}) },
    // UUIDv7 ids are time-ordered, so id breaks ties between messages saved in the same millisecond.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_MESSAGES,
    select: messageSelect,
  });
  return { session: await toSessionView(session), messages };
}

export async function getOwnedSession(userId: string, sessionId: string): Promise<ChatSession> {
  // Filtering by userId means another user's session looks exactly like a missing one.
  const session = await prisma.chatSession.findFirst({ where: { id: sessionId, userId } });
  if (!session) {
    throw HttpError.notFound("Conversation not found");
  }
  return session;
}

export async function getActiveOwnedSession(userId: string, sessionId: string): Promise<ChatSession> {
  const session = await getOwnedSession(userId, sessionId);
  if (session.status !== "ACTIVE") {
    throw HttpError.conflict("This conversation has ended. Start a new one to book again.");
  }
  return session;
}

/** The latest messages, oldest first: the conversation memory sent to the AI. */
export async function getRecentMessages(sessionId: string, limit: number) {
  const latest = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: { role: true, content: true },
  });
  return latest.reverse();
}

/** Pass `evaluation` when the caller already has it, to skip re-checking availability. */
export async function toSessionView(session: ChatSession, evaluation?: DraftEvaluation): Promise<SessionView> {
  const draft = parseBookingDraft(session.bookingDraft);
  const isActive = session.status === "ACTIVE";

  const currentEvaluation = isActive ? (evaluation ?? (await evaluateDraft(draft))) : null;
  const appointment = isActive ? null : await findAppointmentForSession(session.id);
  const service = currentEvaluation
    ? currentEvaluation.service
    : draft.serviceId
      ? await findActiveService(draft.serviceId)
      : null;

  const state: ChatState = appointment
    ? "booked"
    : !isActive
      ? "closed"
      : currentEvaluation?.status === "ready"
        ? "confirming"
        : "collecting";

  return {
    id: session.id,
    status: session.status,
    state,
    draft: {
      service: service && { id: service.id, name: service.name, durationMinutes: service.durationMinutes },
      date: draft.date,
      time: draft.time,
      notes: draft.notes,
    },
    appointment,
    createdAt: session.createdAt,
    lastMessageAt: session.lastMessageAt,
  };
}

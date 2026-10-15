// Every assistant message the backend writes itself. Anything that states a fact about a booking
// comes from here, never from the AI. Gemini's checked acknowledgement may be put in front.
import {
  describeBusinessDay,
  formatFriendlyTime,
  toBusinessDate,
} from "../lib/business-time.js";
import type { BookingDraft } from "../schemas/booking-draft.schema.js";

type NamedService = { name: string };

export const chatReplies = {
  greeting(services: NamedService[]) {
    return `Hi! I can book a ${listServices(services)} for you. What would you like, and when?`;
  },

  confirmPrompt(service: NamedService, startsAt: Date) {
    return `${service.name} ${describeMoment(startsAt)}. Shall I book it?`;
  },

  booked(service: NamedService, startsAt: Date) {
    return `Booked: ${service.name} ${describeMoment(startsAt)}. See you then!`;
  },

  unavailable(reason: string, date: string, alternatives: Date[], requestedStart?: Date) {
    // "2 pm is already booked." reads better than the generic sentence when we know the time.
    const problem = reason === ALREADY_BOOKED && requestedStart ? `${formatFriendlyTime(requestedStart)} is already booked.` : reason;
    if (alternatives.length === 0) {
      return problem;
    }
    return `${problem} Free times ${describeBusinessDay(date)}: ${alternatives.map(formatFriendlyTime).join(", ")}.`;
  },

  /** Used when the AI added a note but didn't mention it, so a note is never added silently. */
  noteAdded(notes: string) {
    return `I've added a note: "${notes.replace(/[.!]+$/, "")}".`;
  },

  /** Fallback when the AI's follow-up question can't be used. */
  nextQuestion(draft: BookingDraft, services: NamedService[]) {
    if (!draft.serviceId) return `Which would you like: ${listServices(services)}?`;
    if (!draft.date) return "Which day works for you?";
    return "What time would suit you?";
  },

  incompleteForConfirm: "A few details are still missing before I can book.",
  openForm: "The form is ready with the details so far.",
  suggestForm: "You can also fill in the form instead.",
  cannotManageExisting:
    "I can't reschedule or cancel existing appointments here, only book new ones. Would you like to book a new appointment?",
  closedNoProgress:
    "I'll close this conversation since we're not getting anywhere. Start a new one whenever you're ready to book.",
  aiUnavailable: "I couldn't process that message. Try again, or fill in the form with the details so far.",
};

export const ALREADY_BOOKED = "That time is already booked.";
export const NO_FREE_TIMES_THAT_DAY = "There are no free times that day. Please pick another day.";

/** "tomorrow (Thu 15 Oct) at 2 pm" or "on Mon 19 Oct at 2:30 pm". */
function describeMoment(instant: Date) {
  return `${describeBusinessDay(toBusinessDate(instant))} at ${formatFriendlyTime(instant)}`;
}

function listServices(services: NamedService[]) {
  const names = services.map((s) => s.name);
  if (names.length <= 1) return names[0] ?? "an appointment";
  return `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

// Every assistant message the backend writes itself (as opposed to Gemini's short follow-up
// questions). Anything that states a fact about a booking comes from here, never from the AI.
import { formatBusinessDate, formatBusinessTime, toBusinessDate } from "../lib/business-time.js";

type NamedService = { name: string };

export const chatReplies = {
  greeting(services: NamedService[]) {
    const names = services.map((s) => s.name);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : (names[0] ?? "an appointment");
    return `Hi! I can book a ${list} for you. What would you like, and when?`;
  },

  confirmPrompt(service: NamedService, startsAt: Date) {
    return `${service.name} on ${formatDateTime(startsAt)}. Shall I book it?`;
  },

  booked(service: NamedService, startsAt: Date) {
    return `Booked: ${service.name} on ${formatDateTime(startsAt)}. See you then!`;
  },

  unavailable(reason: string, date: string, alternatives: Date[]) {
    if (alternatives.length === 0) {
      return reason;
    }
    return `${reason} Free times on ${formatBusinessDate(date)}: ${alternatives.map(formatBusinessTime).join(", ")}.`;
  },

  incompleteForConfirm: "A few details are still missing before I can book.",
  openForm: "Sure. The form is ready with the details so far.",
  suggestForm: "You can also fill in the form instead.",
  aiUnavailable: "I couldn't process that message. Try again, or fill in the form with the details so far.",
};

export const ALREADY_BOOKED = "That time is already booked.";
export const NO_FREE_TIMES_THAT_DAY = "There are no free times that day. Please pick another day.";

function formatDateTime(instant: Date) {
  return `${formatBusinessDate(toBusinessDate(instant))} at ${formatBusinessTime(instant)}`;
}

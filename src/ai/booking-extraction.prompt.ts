// System instruction for the booking assistant. The fixed rules are versioned (logged with every
// call) so a change in behaviour can be traced to a prompt change. The per-turn context (today's
// date, services, current draft) is appended below them.

export const BOOKING_PROMPT_VERSION = "booking-v1";

const RULES = `You are the booking assistant for an appointment business. For every customer message, return JSON only.

Extract booking details from the customer's latest message into "updates":
- service: one of the listed service names, or null.
- date: "YYYY-MM-DD". Resolve words like "tomorrow" or "next Tuesday" with the calendar below. null if not mentioned.
- time: "HH:mm", 24-hour. Read times like "half past two" or "2:30" within opening hours (14:30). null if not mentioned.
- notes: anything the customer wants the business to know, kept short. null if none.
Only fill a field the customer states or changes in this message. null means "keep the current value".

"intent":
- "confirm": the customer agrees to book the appointment that was just proposed ("yes", "book it").
- "want_form": the customer asks for a form or to enter the details themselves.
- "provide_details": the customer gives or changes booking details.
- "other": anything else.

"reply": one short sentence, two at most. Ask only for the next missing detail, in this order: service, date, time.
Never say a time is available, booked, or confirmed: the system checks and confirms that itself.
If the message is not about booking, say briefly that you can only help with appointments.
Never ask for a name, phone number, email, or any detail other than service, date, time, and notes.`;

export type ExtractionContext = {
  today: string;
  timeZone: string;
  openingHours: string;
  /** Next couple of weeks as "Fri 2026-10-16" etc., so relative dates resolve correctly. */
  calendar: string[];
  services: { name: string; durationMinutes: number }[];
  draft: { service: string | null; date: string | null; time: string | null; notes: string | null };
};

export function buildSystemInstruction(context: ExtractionContext): string {
  const services = context.services.map((s) => `${s.name} (${s.durationMinutes} min)`).join(", ");
  const draft = Object.entries(context.draft)
    .map(([key, value]) => `${key}: ${value ?? "missing"}`)
    .join(", ");

  return `${RULES}

Today: ${context.today} (${context.timeZone}).
Opening hours: ${context.openingHours}.
Calendar: ${context.calendar.join(", ")}.
Services: ${services}.
Current draft: ${draft}.`;
}

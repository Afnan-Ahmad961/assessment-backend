// The booking draft stored on a chat session (chat_sessions.booking_draft). Parsed with this schema
// whenever it's read, so a malformed field resets to null instead of breaking the conversation.
import { z } from "zod";

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const bookingDraftSchema = z.object({
  serviceId: z.uuid().nullable().default(null).catch(null),
  /** Calendar date in business time, "YYYY-MM-DD". */
  date: z.iso.date().nullable().default(null).catch(null),
  /** Start time in business time, "HH:mm". */
  time: z.string().regex(TIME_PATTERN).nullable().default(null).catch(null),
  notes: z.string().max(1000).nullable().default(null).catch(null),
});

export type BookingDraft = z.infer<typeof bookingDraftSchema>;

export const EMPTY_DRAFT: BookingDraft = { serviceId: null, date: null, time: null, notes: null };

export function parseBookingDraft(value: unknown): BookingDraft {
  const parsed = bookingDraftSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_DRAFT;
}

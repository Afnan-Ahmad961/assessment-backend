// Booking rules: when appointments can start, and how far ahead they can be booked.
import { env } from "./env.js";

export const bookingRules = {
  timeZone: env.BUSINESS_TIMEZONE,
  /** Days the business is open, 0 = Sunday ... 6 = Saturday. */
  openDays: [1, 2, 3, 4, 5],
  /** Opening hours in minutes after midnight, business timezone. An appointment must fit inside. */
  opensAtMinute: 9 * 60,
  closesAtMinute: 17 * 60,
  /** Start times fall on this grid, e.g. 09:00, 09:15, 09:30. */
  slotStepMinutes: 15,
  minNoticeMinutes: 60,
  maxDaysAhead: 60,
} as const;

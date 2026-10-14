// Converts between exact instants (stored as UTC) and wall-clock time in the business timezone.
// TZDate handles daylight-saving shifts, so 09:00 is always 09:00 local.
import { TZDate } from "@date-fns/tz";

import { bookingRules } from "../config/booking.js";

const { timeZone } = bookingRules;

/** The instant at which `minuteOfDay` occurs on calendar `date` ("YYYY-MM-DD") in business time. */
export function businessDateTime(date: string, minuteOfDay: number): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const local = new TZDate(year, month - 1, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60, timeZone);
  return new Date(local.getTime());
}

/** How an instant reads on the business's clock and calendar. */
export function toBusinessTime(instant: Date) {
  const local = new TZDate(instant.getTime(), timeZone);
  return {
    weekday: local.getDay(),
    minuteOfDay: local.getHours() * 60 + local.getMinutes(),
    isWholeMinute: local.getSeconds() === 0 && local.getMilliseconds() === 0,
  };
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}

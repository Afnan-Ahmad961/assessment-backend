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

/** Calendar date ("YYYY-MM-DD") of an instant in business time. */
export function toBusinessDate(instant: Date): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** "Tue 20 Oct" for a business calendar date. */
export function formatBusinessDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(
    businessDateTime(date, 12 * 60),
  );
}

/** "14:30" for an instant, on the business clock. */
export function formatBusinessTime(instant: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
}

/** "Thursday" for a business calendar date. */
export function weekdayName(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long" }).format(businessDateTime(date, 12 * 60));
}

/** "HH:mm" to minutes after midnight. */
export function timeToMinute(time: string): number {
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  return hours * 60 + minutes;
}

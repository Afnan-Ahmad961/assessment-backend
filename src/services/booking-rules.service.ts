// The single check for "may an appointment start here?". Used when listing availability and when
// creating an appointment, so the two can never disagree. Overlaps are checked separately, against
// the database.
import { bookingRules } from "../config/booking.js";
import { addMinutes, toBusinessTime } from "../lib/business-time.js";

const { openDays, opensAtMinute, closesAtMinute, slotStepMinutes, minNoticeMinutes, maxDaysAhead } = bookingRules;

/** Returns a user-facing reason the slot can't be booked, or null if it can. */
export function getSlotProblem(startsAt: Date, durationMinutes: number, now: Date): string | null {
  const start = toBusinessTime(startsAt);

  if (!(openDays as readonly number[]).includes(start.weekday)) {
    return "We're closed on that day. Please pick a weekday.";
  }

  if (!start.isWholeMinute || start.minuteOfDay % slotStepMinutes !== 0) {
    return `Appointments start every ${slotStepMinutes} minutes, e.g. 10:00, 10:15, 10:30.`;
  }

  if (start.minuteOfDay < opensAtMinute || start.minuteOfDay + durationMinutes > closesAtMinute) {
    return `Appointments must fit within opening hours, ${formatMinute(opensAtMinute)} to ${formatMinute(closesAtMinute)}.`;
  }

  if (startsAt < addMinutes(now, minNoticeMinutes)) {
    return `Appointments need to be booked at least ${minNoticeMinutes} minutes in advance.`;
  }

  if (startsAt > addMinutes(now, maxDaysAhead * 24 * 60)) {
    return `Appointments can be booked up to ${maxDaysAhead} days ahead.`;
  }

  return null;
}

function formatMinute(minuteOfDay: number): string {
  const hours = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
  const minutes = String(minuteOfDay % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

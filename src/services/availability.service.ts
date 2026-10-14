// Free start times for a service on a given day.
import { bookingRules } from "../config/booking.js";
import { addMinutes, businessDateTime } from "../lib/business-time.js";
import { prisma } from "../lib/prisma.js";

import { getSlotProblem } from "./booking-rules.service.js";
import { getActiveServiceOrThrow } from "./service-catalog.service.js";

export type TimeSlot = { startsAt: Date; endsAt: Date };

export async function getAvailableSlots(serviceId: string, date: string, now = new Date()) {
  const service = await getActiveServiceOrThrow(serviceId);
  const { opensAtMinute, closesAtMinute, slotStepMinutes } = bookingRules;

  const candidates: TimeSlot[] = [];
  for (let minute = opensAtMinute; minute + service.durationMinutes <= closesAtMinute; minute += slotStepMinutes) {
    const startsAt = businessDateTime(date, minute);
    if (getSlotProblem(startsAt, service.durationMinutes, now) === null) {
      candidates.push({ startsAt, endsAt: addMinutes(startsAt, service.durationMinutes) });
    }
  }

  const first = candidates[0];
  const last = candidates.at(-1);
  const busy = first && last ? await findBookedRanges(first.startsAt, last.endsAt) : [];
  const slots = candidates.filter((slot) => !busy.some((b) => b.startsAt < slot.endsAt && b.endsAt > slot.startsAt));

  return { service, timeZone: bookingRules.timeZone, slots };
}

/**
 * Active appointments overlapping [from, to). Written as raw SQL on purpose: this exact
 * `tstzrange(...) && ...` expression plus the status filter matches the index behind the
 * appointments_no_overlap constraint, so Postgres can answer it from that GiST index.
 */
function findBookedRanges(from: Date, to: Date): Promise<TimeSlot[]> {
  return prisma.$queryRaw<TimeSlot[]>`
    SELECT starts_at AS "startsAt", ends_at AS "endsAt"
    FROM appointments
    WHERE status <> 'CANCELLED'
      AND tstzrange(starts_at, ends_at, '[)') && tstzrange(${from}::timestamptz, ${to}::timestamptz, '[)')
  `;
}

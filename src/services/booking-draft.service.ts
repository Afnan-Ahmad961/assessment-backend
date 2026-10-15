// Business logic for the booking draft collected in a chat: merging what the AI extracted, and
// deciding whether the draft is incomplete, unbookable, or ready to confirm. Pure business rules;
// the AI's opinion about availability is never used.
import { bookingRules } from "../config/booking.js";
import { businessDateTime, timeToMinute } from "../lib/business-time.js";
import type { BookingDraft } from "../schemas/booking-draft.schema.js";

import { getSlotProblem } from "./booking-rules.service.js";
import { getAvailableSlots } from "./availability.service.js";
import { ALREADY_BOOKED, NO_FREE_TIMES_THAT_DAY } from "./chat-replies.service.js";
import { findActiveService, type ServiceView } from "./service-catalog.service.js";

const MAX_ALTERNATIVES = 4;

export type DraftUpdates = {
  serviceId: string | null;
  date: string | null;
  time: string | null;
  notes: string | null;
};

export type DraftEvaluation =
  | { status: "incomplete"; service: ServiceView | null }
  | {
      status: "unavailable";
      service: ServiceView;
      reason: string;
      alternatives: Date[];
      /** The start the user asked for, when the problem is that specific time. */
      requestedStart?: Date;
    }
  | { status: "ready"; service: ServiceView; startsAt: Date };

/** Applies new details on top of the draft. `null` means "not mentioned", so the old value stays. */
export function mergeDraft(draft: BookingDraft, updates: DraftUpdates): BookingDraft {
  return {
    serviceId: updates.serviceId ?? draft.serviceId,
    date: updates.date ?? draft.date,
    time: updates.time ?? draft.time,
    notes: updates.notes ?? draft.notes,
  };
}

export function isSameDraft(a: BookingDraft, b: BookingDraft): boolean {
  return a.serviceId === b.serviceId && a.date === b.date && a.time === b.time && a.notes === b.notes;
}

export async function evaluateDraft(draft: BookingDraft, now = new Date()): Promise<DraftEvaluation> {
  const service = draft.serviceId ? await findActiveService(draft.serviceId) : null;

  if (!service || !draft.date) {
    return { status: "incomplete", service };
  }

  const { slots } = await getAvailableSlots(service.id, draft.date, now);

  // A date with no free times at all (closed, fully booked, out of range) is rejected right away,
  // before the user picks a time for it.
  if (slots.length === 0) {
    const opening = businessDateTime(draft.date, bookingRules.opensAtMinute);
    const reason = getSlotProblem(opening, service.durationMinutes, now) ?? NO_FREE_TIMES_THAT_DAY;
    return { status: "unavailable", service, reason, alternatives: [] };
  }

  if (!draft.time) {
    return { status: "incomplete", service };
  }

  const startsAt = businessDateTime(draft.date, timeToMinute(draft.time));

  if (slots.some((slot) => slot.startsAt.getTime() === startsAt.getTime())) {
    return { status: "ready", service, startsAt };
  }

  return {
    status: "unavailable",
    service,
    reason: getSlotProblem(startsAt, service.durationMinutes, now) ?? ALREADY_BOOKED,
    alternatives: closestStarts(
      slots.map((slot) => slot.startsAt),
      startsAt,
    ),
    requestedStart: startsAt,
  };
}

/** The free start times nearest to the one asked for, in chronological order. */
function closestStarts(starts: Date[], target: Date): Date[] {
  return [...starts]
    .sort((a, b) => Math.abs(a.getTime() - target.getTime()) - Math.abs(b.getTime() - target.getTime()))
    .slice(0, MAX_ALTERNATIVES)
    .sort((a, b) => a.getTime() - b.getTime());
}

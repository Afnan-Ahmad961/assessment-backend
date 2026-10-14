// The exact JSON shape Gemini must return for each chat turn. The same Zod schema is sent to Gemini
// as a JSON Schema (structured output) and used to validate the response before we trust it.
import { z } from "zod";

import { TIME_PATTERN } from "../schemas/booking-draft.schema.js";

export const BOOKING_INTENTS = ["provide_details", "confirm", "want_form", "other"] as const;

export type BookingIntent = (typeof BOOKING_INTENTS)[number];

/** `serviceNames` must not be empty: the service field is limited to these exact names. */
export function buildExtractionSchema(serviceNames: [string, ...string[]]) {
  return z.object({
    reply: z.string().min(1).max(300),
    updates: z.object({
      service: z.enum(serviceNames).nullable(),
      date: z.iso.date().nullable(),
      time: z.string().regex(TIME_PATTERN).nullable(),
      notes: z.string().max(500).nullable(),
    }),
    intent: z.enum(BOOKING_INTENTS),
  });
}

export type BookingExtraction = {
  reply: string;
  updates: { service: string | null; date: string | null; time: string | null; notes: string | null };
  intent: BookingIntent;
};

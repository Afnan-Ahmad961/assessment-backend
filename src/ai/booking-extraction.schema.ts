// The exact JSON shape Gemini must return for each chat turn. The same Zod schema is sent to Gemini
// as a JSON Schema (structured output) and used to validate the response before we trust it.
// Field order matters: Gemini writes them in this order, so it extracts before it phrases.
import { z } from "zod";

import { TIME_PATTERN } from "../schemas/booking-draft.schema.js";

export const BOOKING_INTENTS = ["provide_details", "confirm", "want_form", "manage_existing", "other"] as const;

export type BookingIntent = (typeof BOOKING_INTENTS)[number];

/** `serviceNames` must not be empty: the service field is limited to these exact names. */
export function buildExtractionSchema(serviceNames: [string, ...string[]]) {
  return z.object({
    updates: z.object({
      service: z.enum(serviceNames).nullable(),
      date: z.iso.date().nullable(),
      time: z.string().regex(TIME_PATTERN).nullable(),
      notes: z.string().max(500).nullable(),
    }),
    intent: z.enum(BOOKING_INTENTS),
    acknowledgement: z.string().max(300).nullable(),
    reply: z.string().min(1).max(300),
  });
}

export type BookingExtraction = {
  updates: { service: string | null; date: string | null; time: string | null; notes: string | null };
  intent: BookingIntent;
  /** One sentence reflecting what the AI understood or noted. Shown before the system's reply. */
  acknowledgement: string | null;
  /** A follow-up question for the next missing detail. Only used while details are missing. */
  reply: string;
};

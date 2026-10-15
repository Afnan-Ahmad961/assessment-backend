// Checks the two pieces of free text Gemini writes (the acknowledgement and the follow-up question)
// before they reach the user. Anything that looks like a claim about a booking or availability is
// dropped, and the caller falls back to deterministic text. Facts only ever come from the backend.

// "is available", "has been booked", "I've set your appointment", "I'll reserve"... and any mention
// of availability. Deliberately strict: a false positive only costs a less personal sentence.
const BOOKING_CLAIM =
  /\b(is|are|was|were|been|i've|i have|i'll|i will|we've|we have)\b[^.!?]{0,30}\b(book(ed)?|confirm(ed)?|reserved?|scheduled?|available|free|set|arranged?|secured?|locked)\b|\bavailab/i;

const MAX_ACKNOWLEDGEMENT_LENGTH = 140;

/** The acknowledgement if it's a short statement with no booking claims, otherwise null. */
export function safeAcknowledgement(text: string | null): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_ACKNOWLEDGEMENT_LENGTH || trimmed.includes("?") || BOOKING_CLAIM.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/** The follow-up question if it makes no booking claims, otherwise null. */
export function safeFollowUp(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || BOOKING_CLAIM.test(trimmed)) return null;
  return trimmed;
}

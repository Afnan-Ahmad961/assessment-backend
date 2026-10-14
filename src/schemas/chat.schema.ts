// Zod schemas for chat requests.
import { z } from "zod";

export const chatSessionParamsSchema = z.object({
  id: z.uuid("Invalid conversation id"),
});

export const chatSessionQuerySchema = z.object({
  /** Polling cursor: only return messages created after this time (the last message's createdAt). */
  after: z.iso
    .datetime({ offset: true, message: "after must be an ISO timestamp" })
    .transform((value) => new Date(value))
    .optional(),
});

export const sendMessageBodySchema = z.object({
  content: z.string().trim().min(1, "Message can't be empty").max(2000, "Message must be at most 2000 characters"),
});

export type ChatSessionParams = z.infer<typeof chatSessionParamsSchema>;
export type ChatSessionQuery = z.infer<typeof chatSessionQuerySchema>;
export type SendMessageBody = z.infer<typeof sendMessageBodySchema>;

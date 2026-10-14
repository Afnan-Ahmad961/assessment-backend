// /chat routes. All require a signed-in user.
import { Router } from "express";

import * as chatController from "../controllers/chat.controller.js";
import { chatMessageRateLimiter } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/require-auth.js";
import { validate } from "../middleware/validate.js";
import { chatSessionParamsSchema, chatSessionQuerySchema, sendMessageBodySchema } from "../schemas/chat.schema.js";

export const chatRouter = Router();

chatRouter.use(requireAuth);

chatRouter.post("/sessions", chatController.startSession);
chatRouter.get("/sessions/active", chatController.getActiveSession);
chatRouter.get(
  "/sessions/:id",
  validate({ params: chatSessionParamsSchema, query: chatSessionQuerySchema }),
  chatController.getSession,
);
chatRouter.post(
  "/sessions/:id/messages",
  chatMessageRateLimiter,
  validate({ params: chatSessionParamsSchema, body: sendMessageBodySchema }),
  chatController.sendMessage,
);
chatRouter.post("/sessions/:id/confirm", validate({ params: chatSessionParamsSchema }), chatController.confirmBooking);

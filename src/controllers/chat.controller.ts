// HTTP layer for the booking chat.
import type { Request, Response } from "express";

import { getAuth } from "../middleware/require-auth.js";
import type { ChatSessionParams, ChatSessionQuery, SendMessageBody } from "../schemas/chat.schema.js";
import * as chatSessionService from "../services/chat-session.service.js";
import * as chatTurnService from "../services/chat-turn.service.js";
import type { ValidatedRequest } from "../types/http.js";

export async function startSession(req: Request, res: Response) {
  const result = await chatSessionService.startSession(getAuth(req).userId);
  res.status(201).json({ data: result });
}

export async function getActiveSession(req: Request, res: Response) {
  const result = await chatSessionService.getActiveSession(getAuth(req).userId);
  res.status(200).json({ data: result });
}

export async function getSession(req: ValidatedRequest<unknown, ChatSessionQuery, ChatSessionParams>, res: Response) {
  const result = await chatSessionService.getSession(getAuth(req).userId, req.params.id, req.query.after);
  res.status(200).json({ data: result });
}

export async function sendMessage(req: ValidatedRequest<SendMessageBody, unknown, ChatSessionParams>, res: Response) {
  const result = await chatTurnService.sendMessage(getAuth(req).userId, req.params.id, req.body.content);
  res.status(200).json({ data: result });
}

export async function confirmBooking(req: ValidatedRequest<unknown, unknown, ChatSessionParams>, res: Response) {
  const result = await chatTurnService.confirmBooking(getAuth(req).userId, req.params.id);
  res.status(200).json({ data: result });
}

// HTTP layer for auth: reads the validated request, calls the auth service, sends the response.
// Successful responses are always shaped { "data": ... }.
import type { Request, Response } from "express";

import { getAuth } from "../middleware/require-auth.js";
import type { LoginBody, LogoutBody, RefreshBody, SignupBody } from "../schemas/auth.schema.js";
import * as authService from "../services/auth.service.js";
import type { ValidatedRequest } from "../types/http.js";

export async function signup(req: ValidatedRequest<SignupBody>, res: Response) {
  const result = await authService.signup(req.body);
  res.status(201).json({ data: result });
}

export async function login(req: ValidatedRequest<LoginBody>, res: Response) {
  const result = await authService.login(req.body);
  res.status(200).json({ data: result });
}

export async function refresh(req: ValidatedRequest<RefreshBody>, res: Response) {
  const result = await authService.refresh(req.body.refreshToken);
  res.status(200).json({ data: result });
}

export async function logout(req: ValidatedRequest<LogoutBody>, res: Response) {
  await authService.logout(req.body.refreshToken);
  res.status(204).end();
}

export async function me(req: Request, res: Response) {
  const user = await authService.getCurrentUser(getAuth(req).userId);
  res.status(200).json({ data: { user } });
}

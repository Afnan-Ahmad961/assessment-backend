// Protects routes that need a logged-in user. Reads the access token from the
// `Authorization: Bearer <token>` header (sent by the Next.js BFF), verifies it, and puts the
// user id on `req.auth`. Use `getAuth(req)` inside handlers to read it with a non-optional type.
import type { Request, RequestHandler } from "express";

import { HttpError } from "../lib/http-error.js";
import { verifyAccessToken } from "../lib/tokens.js";

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;

  if (!token) {
    return next(HttpError.unauthorized());
  }

  const payload = await verifyAccessToken(token);

  if (!payload) {
    return next(HttpError.unauthorized("Invalid or expired access token"));
  }

  req.auth = { userId: payload.userId };
  next();
};

export function getAuth(req: Pick<Request, "auth">): NonNullable<Request["auth"]> {
  if (!req.auth) {
    // Only reachable if a route forgot to mount requireAuth.
    throw HttpError.unauthorized();
  }
  return req.auth;
}

// Rate limiters. `apiRateLimiter` covers every route; `authRateLimiter` is a much stricter limit on
// login/signup to slow down password guessing. Both are keyed by client IP. `chatMessageRateLimiter`
// is keyed by user and protects the Gemini quota.
import { ipKeyGenerator, rateLimit, type Options } from "express-rate-limit";

import { HttpError } from "../lib/http-error.js";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function createLimiter(limit: number, message: string, keyGenerator?: Options["keyGenerator"]) {
  return rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit,
    ...(keyGenerator ? { keyGenerator } : {}),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new HttpError(429, "RATE_LIMITED", message)),
  });
}

export const apiRateLimiter = createLimiter(300, "Too many requests, please slow down");

export const authRateLimiter = createLimiter(20, "Too many authentication attempts, please try again later");

// Mounted after requireAuth, so req.auth is set.
export const chatMessageRateLimiter = createLimiter(
  40,
  "You're sending messages too quickly. Please wait a few minutes.",
  (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? ""),
);

// Rate limiters, keyed by client IP. `apiRateLimiter` covers every route; `authRateLimiter` is a
// much stricter limit on login/signup to slow down password guessing.
import { rateLimit } from "express-rate-limit";

import { HttpError } from "../lib/http-error.js";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function createLimiter(limit: number, message: string) {
  return rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // Route through the error handler so 429s use the same JSON shape as every other error.
    handler: (_req, _res, next) => next(new HttpError(429, "RATE_LIMITED", message)),
  });
}

export const apiRateLimiter = createLimiter(300, "Too many requests, please slow down");

export const authRateLimiter = createLimiter(20, "Too many authentication attempts, please try again later");

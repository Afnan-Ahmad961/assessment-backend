// The real client IP, for rate limiting. Requests from the Next.js BFF arrive from Vercel's servers,
// so the BFF sends the browser's IP in X-Client-IP along with a shared secret. The header is only
// trusted when the secret matches; anyone calling the API directly gets their connection IP.
import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import type { Request } from "express";

import { env } from "../config/env.js";

export function clientIp(req: Request): string {
  const forwarded = req.get("x-client-ip");
  if (forwarded && isIP(forwarded) && isFromBff(req.get("x-bff-secret"))) {
    return forwarded;
  }
  return req.ip ?? "unknown";
}

function isFromBff(secret: string | undefined): boolean {
  const expected = env.BFF_SHARED_SECRET;
  if (!expected || !secret) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(expected);
  // Constant-time comparison, so response timing doesn't leak the secret.
  return a.length === b.length && timingSafeEqual(a, b);
}

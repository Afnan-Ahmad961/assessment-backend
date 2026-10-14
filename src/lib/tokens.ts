// Token primitives. Access tokens are short-lived signed JWTs checked without a DB call.
// Refresh tokens are random opaque strings; only their SHA-256 hash is stored, so a leaked
// database can't be used to mint sessions.
import { createHash, randomBytes } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

import { env } from "../config/env.js";

const JWT_ALGORITHM = "HS256";
const JWT_ISSUER = "appointments-api";
const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export type AccessTokenPayload = { userId: string };

export async function signAccessToken({ userId }: AccessTokenPayload) {
  const expiresAt = new Date(Date.now() + env.ACCESS_TOKEN_TTL_MINUTES * 60_000);

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setSubject(userId)
    .setIssuer(JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(accessSecret);

  return { token, expiresAt };
}

/** Returns the payload, or null if the token is invalid, expired, or tampered with. */
export async function verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, accessSecret, {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
    });
    return payload.sub ? { userId: payload.sub } : null;
  } catch {
    return null;
  }
}

export function generateRefreshToken() {
  return {
    token: randomBytes(32).toString("base64url"),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60_000),
  };
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

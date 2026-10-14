// Auth business logic: signup, login, refresh-token rotation, logout, and loading the current user.
// Knows nothing about HTTP requests; controllers call these functions and shape the response.
import { Prisma } from "../generated/prisma/client.js";
import { HttpError } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "../lib/password.js";
import { prisma } from "../lib/prisma.js";
import { generateRefreshToken, hashRefreshToken, signAccessToken } from "../lib/tokens.js";
import type { LoginBody, SignupBody } from "../schemas/auth.schema.js";

const publicUserSelect = {
  id: true,
  email: true,
  fullName: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

export type AuthTokens = {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
};

export type AuthResult = {
  user: PublicUser;
  tokens: AuthTokens;
};

export async function signup({ email, password, fullName }: SignupBody): Promise<AuthResult> {
  const passwordHash = await hashPassword(password);

  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, passwordHash, fullName },
        select: publicUserSelect,
      });
      return { user, tokens: await issueTokens(user.id, tx) };
    });
  } catch (error) {
    // Rely on the unique index instead of checking first, so two simultaneous signups with the
    // same email can't both succeed.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw HttpError.conflict("An account with this email already exists");
    }
    throw error;
  }
}

export async function login({ email, password }: LoginBody): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email } });

  // Always run bcrypt, even for unknown emails, so both failure cases take the same time.
  const passwordMatches = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

  if (!user || !passwordMatches) {
    throw HttpError.unauthorized("Invalid email or password");
  }

  return {
    user: { id: user.id, email: user.email, fullName: user.fullName, createdAt: user.createdAt },
    tokens: await issueTokens(user.id),
  };
}

/**
 * Exchanges a valid refresh token for a new access + refresh token pair. The old refresh token is
 * revoked (rotation). If an already-revoked token is presented, it has been used twice, which
 * means it leaked, so every session for that user is revoked.
 */
export async function refresh(rawRefreshToken: string): Promise<AuthResult> {
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(rawRefreshToken) },
    include: { user: { select: publicUserSelect } },
  });

  if (!stored) {
    throw HttpError.unauthorized("Invalid refresh token");
  }

  if (stored.revokedAt) {
    await revokeAllUserTokens(stored.userId);
    logger.warn({ userId: stored.userId }, "Refresh token reuse detected; revoked all sessions");
    throw HttpError.unauthorized("Invalid refresh token");
  }

  if (stored.expiresAt <= new Date()) {
    throw HttpError.unauthorized("Refresh token expired");
  }

  const tokens = await prisma.$transaction(async (tx) => {
    // Conditional update: if two requests race with the same token, only one gets count === 1.
    const claimed = await tx.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return claimed.count === 1 ? issueTokens(stored.userId, tx) : null;
  });

  if (!tokens) {
    throw HttpError.unauthorized("Invalid refresh token");
  }

  return { user: stored.user, tokens };
}

/** Revokes one refresh token. Idempotent: logging out twice, or with an unknown token, still succeeds. */
export async function logout(rawRefreshToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashRefreshToken(rawRefreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getCurrentUser(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: publicUserSelect });

  if (!user) {
    // The access token is valid but the account is gone.
    throw HttpError.unauthorized("Account no longer exists");
  }

  return user;
}

async function issueTokens(userId: string, db: Prisma.TransactionClient = prisma): Promise<AuthTokens> {
  const access = await signAccessToken({ userId });
  const refreshToken = generateRefreshToken();

  await db.refreshToken.create({
    data: {
      userId,
      tokenHash: hashRefreshToken(refreshToken.token),
      expiresAt: refreshToken.expiresAt,
    },
  });

  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt,
    refreshToken: refreshToken.token,
    refreshTokenExpiresAt: refreshToken.expiresAt,
  };
}

async function revokeAllUserTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

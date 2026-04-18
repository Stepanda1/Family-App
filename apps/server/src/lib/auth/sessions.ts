import type { FastifyRequest } from "fastify";
import { prisma } from "../prisma.js";
import { constantTimeEqualHex, randomBase64Url, sha256Hex } from "./crypto.js";

const DEFAULT_REFRESH_TTL_DAYS = 30;

export function getRefreshTokenTtlDays() {
  const parsed = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? DEFAULT_REFRESH_TTL_DAYS);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 365) {
    return DEFAULT_REFRESH_TTL_DAYS;
  }
  return parsed;
}

export function parseRefreshToken(refreshToken: string) {
  const parts = refreshToken.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [sessionId, token] = parts;
  if (!sessionId || !token) {
    return null;
  }

  return { sessionId, token };
}

export async function issueSessionTokens(params: {
  userId: string;
  request: FastifyRequest;
  mfa: boolean;
  accessTokenTtl?: string;
}) {
  const token = randomBase64Url(32);
  const refreshTokenTtlDays = getRefreshTokenTtlDays();
  const expiresAt = new Date(Date.now() + refreshTokenTtlDays * 24 * 60 * 60 * 1000);

  const session = await prisma.userSession.create({
    data: {
      userId: params.userId,
      userAgent: params.request.headers["user-agent"],
      ipAddress: params.request.ip,
      mfaVerified: params.mfa,
      refreshTokenHash: sha256Hex(token),
      refreshTokenExpiresAt: expiresAt,
      lastSeenAt: new Date()
    }
  });

  const refreshToken = `${session.id}.${token}`;

  return {
    sessionId: session.id,
    refreshToken,
    refreshTokenExpiresAt: session.refreshTokenExpiresAt,
    mfa: params.mfa
  };
}

export async function rotateRefreshToken(params: { userId: string; refreshToken: string }) {
  const parsed = parseRefreshToken(params.refreshToken);
  if (!parsed) {
    return { ok: false as const, reason: "invalid_token" as const };
  }

  const session = await prisma.userSession.findUnique({
    where: { id: parsed.sessionId }
  });

  if (!session || session.userId !== params.userId) {
    return { ok: false as const, reason: "invalid_token" as const };
  }

  if (session.revokedAt) {
    return { ok: false as const, reason: "revoked" as const };
  }

  if (session.refreshTokenExpiresAt.getTime() <= Date.now()) {
    return { ok: false as const, reason: "expired" as const };
  }

  const tokenHash = sha256Hex(parsed.token);
  if (!constantTimeEqualHex(session.refreshTokenHash, tokenHash)) {
    await prisma.userSession.updateMany({
      where: { userId: params.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "refresh_token_reuse_detected" }
    });

    return { ok: false as const, reason: "reuse_detected" as const };
  }

  const newToken = randomBase64Url(32);
  const newHash = sha256Hex(newToken);

  const updated = await prisma.userSession.update({
    where: { id: session.id },
    data: {
      refreshTokenHash: newHash,
      refreshTokenRotatedAt: new Date(),
      lastSeenAt: new Date()
    }
  });

  return {
    ok: true as const,
    sessionId: updated.id,
    refreshToken: `${updated.id}.${newToken}`,
    refreshTokenExpiresAt: updated.refreshTokenExpiresAt
  };
}

export async function revokeSession(params: { sessionId: string; reason: string }) {
  await prisma.userSession.updateMany({
    where: { id: params.sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: params.reason }
  });
}

export async function touchSession(sessionId: string) {
  const existing = await prisma.userSession.findUnique({
    where: { id: sessionId },
    select: { lastSeenAt: true, revokedAt: true }
  });

  if (!existing || existing.revokedAt) {
    return;
  }

  const lastSeenAt = existing.lastSeenAt?.getTime() ?? 0;
  if (Date.now() - lastSeenAt < 60_000) {
    return;
  }

  await prisma.userSession.update({
    where: { id: sessionId },
    data: { lastSeenAt: new Date() }
  });
}

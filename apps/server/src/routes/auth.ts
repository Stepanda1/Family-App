import { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { decodeEncryptedPayload, decryptAes256Gcm, encodeEncryptedPayload, encryptAes256Gcm } from "../lib/auth/crypto.js";
import { executeIdempotent } from "../lib/http/idempotency.js";
import { AppError } from "../lib/http/problem.js";
import { hashPassword, verifyPassword } from "../lib/auth/passwords.js";
import { verifyAppleIdToken, verifyGoogleIdToken } from "../lib/auth/oauth.js";
import { issueSessionTokens, revokeSession, rotateRefreshToken, touchSession } from "../lib/auth/sessions.js";
import { buildOtpAuthUrl, generateTotpSecret, verifyTotp } from "../lib/auth/totp.js";
import { enqueueOutboxEvent } from "../lib/outbox/outbox.js";
import qrcode from "qrcode";

const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  displayName: z.string().min(2).max(80).optional()
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
  totp: z.string().min(4).max(12).optional()
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20)
});

const oauthSchema = z.object({
  idToken: z.string().min(50)
});

const mfaSetupSchema = z.object({
  password: z.string().min(1).max(200)
});

const mfaEnableSchema = z.object({
  code: z.string().min(4).max(12)
});

const mfaDisableSchema = z.object({
  password: z.string().min(1).max(200),
  code: z.string().min(4).max(12)
});

const mfaVerifyChallengeSchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().min(4).max(12)
});

const sessionParamsSchema = z.object({
  sessionId: z.string().uuid()
});

function getAccessTokenTtl() {
  return process.env.ACCESS_TOKEN_TTL ?? "15m";
}

function getIssuer() {
  return process.env.JWT_ISSUER ?? "family-app-api";
}

function getAudience() {
  return process.env.JWT_AUDIENCE ?? "family-app-mobile";
}

function getMfaIssuer() {
  return process.env.MFA_ISSUER ?? "Family App";
}

function shouldReturnMfaSecret() {
  return (process.env.MFA_RETURN_SECRET ?? "").toLowerCase() === "true";
}

function getMfaEncryptionKey() {
  const raw = process.env.MFA_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("MFA_ENCRYPTION_KEY is required to use MFA endpoints.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("MFA_ENCRYPTION_KEY must be base64 for 32 bytes.");
  }
  return key;
}

function buildAccessToken(app: FastifyInstance, params: { userId: string; sessionId: string; amr: string[]; mfa: boolean }) {
  return app.jwt.sign(
    {
      sid: params.sessionId,
      amr: params.amr,
      mfa: params.mfa
    },
    {
      sub: params.userId,
      iss: getIssuer(),
      aud: getAudience(),
      expiresIn: getAccessTokenTtl()
    }
  );
}

async function ensureLocalUser(params: { email: string; displayName?: string | null; passwordHash?: string | null }) {
  const normalizedEmail = params.email.toLowerCase();
  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail }
  });
  if (existing) {
    return existing;
  }

  return prisma.user.create({
    data: {
      email: normalizedEmail,
      displayName: params.displayName ?? undefined,
      passwordHash: params.passwordHash ?? undefined
    }
  });
}

async function createMfaLoginChallenge(userId: string) {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  const challenge = await prisma.authChallenge.create({
    data: {
      userId,
      type: "MFA_LOGIN",
      expiresAt,
      metadata: { method: "totp" }
    }
  });
  return challenge;
}

function redactSession(session: {
  id: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  revokeReason: string | null;
  userAgent: string | null;
  ipAddress: string | null;
}) {
  return {
    id: session.id,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    revokedAt: session.revokedAt,
    revokeReason: session.revokeReason,
    userAgent: session.userAgent,
    ipAddress: session.ipAddress
  };
}

export async function registerAuthRoutes(
  app: FastifyInstance<any, any, any, any>
) {
  app.post("/api/auth/register", async (request, reply) => {
    const payload = registerSchema.parse(request.body);
    const result = await executeIdempotent({
      request,
      reply,
      operation: "auth.register",
      body: payload,
      statusCode: 201,
      handler: async () => {
        const passwordHash = await hashPassword(payload.password);

        let user;
        try {
          user = await prisma.$transaction(async (tx) => {
            const created = await tx.user.create({
              data: {
                email: payload.email.toLowerCase(),
                displayName: payload.displayName,
                passwordHash
              }
            });

            await enqueueOutboxEvent(tx, {
              type: "email.send",
              payload: {
                toEmail: created.email,
                subject: "Добро пожаловать в Family App",
                body: `UserId: ${created.id}\nEmail: ${created.email}`
              },
              maxAttempts: 10
            });

            return created;
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          ) {
            throw new AppError({
              status: 409,
              detail: "Email already registered",
              code: "EMAIL_ALREADY_REGISTERED"
            });
          }
          throw error;
        }

        const sessionTokens = await issueSessionTokens({
          userId: user.id,
          request,
          mfa: false
        });
        const accessToken = buildAccessToken(app, {
          userId: user.id,
          sessionId: sessionTokens.sessionId,
          amr: ["pwd"],
          mfa: false
        });

        return {
          user: {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            mfaEnabled: user.mfaEnabled
          },
          accessToken,
          accessTokenExpiresIn: getAccessTokenTtl(),
          refreshToken: sessionTokens.refreshToken,
          refreshTokenExpiresAt: sessionTokens.refreshTokenExpiresAt,
          sessionId: sessionTokens.sessionId
        };
      }
    });

    const statusCode = reply.statusCode >= 200 ? reply.statusCode : 201;
    return reply.code(statusCode).send(result);
  });

  app.post("/api/auth/login", async (request, reply) => {
    const payload = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: { email: payload.email.toLowerCase() }
    });

    if (!user || !user.passwordHash) {
      return reply.code(401).send({ message: "Invalid email or password" });
    }

    const ok = await verifyPassword(user.passwordHash, payload.password);
    if (!ok) {
      return reply.code(401).send({ message: "Invalid email or password" });
    }

    if (user.mfaEnabled) {
      if (!payload.totp) {
        const challenge = await createMfaLoginChallenge(user.id);
        return reply.code(200).send({ mfaRequired: true, challengeId: challenge.id, method: "totp" });
      }

      const key = getMfaEncryptionKey();
      const decoded = user.mfaSecretEnc ? decodeEncryptedPayload(user.mfaSecretEnc) : null;
      if (!decoded) {
        return reply.code(409).send({ message: "MFA is enabled but secret is missing" });
      }

      const secret = decryptAes256Gcm(decoded, key);
      const mfaOk = verifyTotp({ token: payload.totp, secret });
      if (!mfaOk) {
        return reply.code(401).send({ message: "Invalid MFA code" });
      }

      const sessionTokens = await issueSessionTokens({ userId: user.id, request, mfa: true });
      const accessToken = buildAccessToken(app, { userId: user.id, sessionId: sessionTokens.sessionId, amr: ["pwd", "mfa"], mfa: true });
      return reply.send({
        user: { id: user.id, email: user.email, displayName: user.displayName, mfaEnabled: user.mfaEnabled },
        accessToken,
        accessTokenExpiresIn: getAccessTokenTtl(),
        refreshToken: sessionTokens.refreshToken,
        refreshTokenExpiresAt: sessionTokens.refreshTokenExpiresAt,
        sessionId: sessionTokens.sessionId
      });
    }

    const sessionTokens = await issueSessionTokens({ userId: user.id, request, mfa: false });
    const accessToken = buildAccessToken(app, { userId: user.id, sessionId: sessionTokens.sessionId, amr: ["pwd"], mfa: false });
    return reply.send({
      user: { id: user.id, email: user.email, displayName: user.displayName, mfaEnabled: user.mfaEnabled },
      accessToken,
      accessTokenExpiresIn: getAccessTokenTtl(),
      refreshToken: sessionTokens.refreshToken,
      refreshTokenExpiresAt: sessionTokens.refreshTokenExpiresAt,
      sessionId: sessionTokens.sessionId
    });
  });

  app.post("/api/auth/mfa/verify", async (request, reply) => {
    const payload = mfaVerifyChallengeSchema.parse(request.body);

    const challenge = await prisma.authChallenge.findUnique({
      where: { id: payload.challengeId },
      include: { user: true }
    });

    if (!challenge || challenge.type !== "MFA_LOGIN") {
      return reply.code(404).send({ message: "Challenge not found" });
    }
    if (challenge.consumedAt) {
      return reply.code(409).send({ message: "Challenge already used" });
    }
    if (challenge.expiresAt.getTime() <= Date.now()) {
      return reply.code(410).send({ message: "Challenge expired" });
    }
    if (challenge.attempts >= 5) {
      await prisma.authChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() }
      });
      return reply.code(429).send({ message: "Too many attempts" });
    }
    if (!challenge.user.mfaEnabled) {
      return reply.code(409).send({ message: "MFA is not enabled for this user" });
    }

    const key = getMfaEncryptionKey();
    const decoded = challenge.user.mfaSecretEnc ? decodeEncryptedPayload(challenge.user.mfaSecretEnc) : null;
    if (!decoded) {
      return reply.code(409).send({ message: "MFA secret is missing" });
    }

    const secret = decryptAes256Gcm(decoded, key);
    const ok = verifyTotp({ token: payload.code, secret });

    await prisma.authChallenge.update({
      where: { id: challenge.id },
      data: {
        attempts: { increment: 1 },
        consumedAt: ok ? new Date() : undefined
      }
    });

    if (!ok) {
      return reply.code(401).send({ message: "Invalid MFA code" });
    }

    const sessionTokens = await issueSessionTokens({ userId: challenge.user.id, request, mfa: true });
    const accessToken = buildAccessToken(app, { userId: challenge.user.id, sessionId: sessionTokens.sessionId, amr: ["pwd", "mfa"], mfa: true });

    return reply.send({
      user: { id: challenge.user.id, email: challenge.user.email, displayName: challenge.user.displayName, mfaEnabled: challenge.user.mfaEnabled },
      accessToken,
      accessTokenExpiresIn: getAccessTokenTtl(),
      refreshToken: sessionTokens.refreshToken,
      refreshTokenExpiresAt: sessionTokens.refreshTokenExpiresAt,
      sessionId: sessionTokens.sessionId
    });
  });

  app.post("/api/auth/refresh", async (request, reply) => {
    const payload = refreshSchema.parse(request.body);
    const parsed = payload.refreshToken.split(".");
    if (parsed.length !== 2) {
      return reply.code(401).send({ message: "Invalid refresh token" });
    }

    const sessionId = parsed[0];
    const session = await prisma.userSession.findUnique({
      where: { id: sessionId }
    });
    if (!session || session.revokedAt) {
      return reply.code(401).send({ message: "Invalid refresh token" });
    }

    const rotation = await rotateRefreshToken({ userId: session.userId, refreshToken: payload.refreshToken });
    if (!rotation.ok) {
      return reply.code(401).send({ message: "Invalid refresh token" });
    }

    const accessToken = buildAccessToken(app, {
      userId: session.userId,
      sessionId: rotation.sessionId,
      amr: session.mfaVerified ? ["refresh", "mfa"] : ["refresh"],
      mfa: session.mfaVerified
    });

    return reply.send({
      accessToken,
      accessTokenExpiresIn: getAccessTokenTtl(),
      refreshToken: rotation.refreshToken,
      refreshTokenExpiresAt: rotation.refreshTokenExpiresAt,
      sessionId: rotation.sessionId
    });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    await request.jwtVerify();
    const userId = request.user.sub;
    const sessionId = request.user.sid;

    if (!sessionId) {
      await prisma.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "logout" }
      });
      return reply.code(204).send();
    }

    await revokeSession({ sessionId, reason: "logout" });
    return reply.code(204).send();
  });

  app.post("/api/auth/logout-all", async (request, reply) => {
    await request.jwtVerify();
    const userId = request.user.sub;

    await prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "logout_all" }
    });

    return reply.code(204).send();
  });

  app.get("/api/auth/me", async (request, reply) => {
    await request.jwtVerify();
    const userId = request.user.sub;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, displayName: true, mfaEnabled: true, createdAt: true, updatedAt: true }
    });

    if (!user) {
      return reply.code(404).send({ message: "User not found" });
    }

    return reply.send(user);
  });

  app.get("/api/auth/sessions", async (request, reply) => {
    await request.jwtVerify();
    const userId = request.user.sub;
    const sessionId = request.user.sid;

    const sessions = await prisma.userSession.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        lastSeenAt: true,
        revokedAt: true,
        revokeReason: true,
        userAgent: true,
        ipAddress: true
      }
    });

    return reply.send({
      currentSessionId: sessionId,
      sessions: sessions.map(redactSession)
    });
  });

  app.post("/api/auth/sessions/:sessionId/revoke", async (request, reply) => {
    await request.jwtVerify();
    const userId = request.user.sub;
    const { sessionId } = sessionParamsSchema.parse(request.params);

    const session = await prisma.userSession.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true, revokedAt: true }
    });

    if (!session || session.userId !== userId) {
      return reply.code(404).send({ message: "Session not found" });
    }

    if (!session.revokedAt) {
      await revokeSession({ sessionId, reason: "user_revoked" });
    }

    return reply.code(204).send();
  });

  app.post("/api/auth/oauth/google", async (request, reply) => {
    const payload = oauthSchema.parse(request.body);
    const audience = process.env.GOOGLE_CLIENT_ID;
    if (!audience) {
      return reply.code(501).send({ message: "GOOGLE_CLIENT_ID is not configured" });
    }

    const verified = await verifyGoogleIdToken(payload.idToken, audience);

    const user = await ensureLocalUser({
      email: verified.email,
      displayName: verified.name ?? null
    });

    await prisma.oAuthAccount.upsert({
      where: {
        provider_providerSubject: { provider: "GOOGLE", providerSubject: verified.sub }
      },
      update: {
        userId: user.id,
        accountEmail: verified.email,
        displayName: verified.name ?? undefined
      },
      create: {
        userId: user.id,
        provider: "GOOGLE",
        providerSubject: verified.sub,
        accountEmail: verified.email,
        displayName: verified.name ?? undefined
      }
    });

    if (user.mfaEnabled) {
      const challenge = await createMfaLoginChallenge(user.id);
      return reply.code(200).send({ mfaRequired: true, challengeId: challenge.id, method: "totp" });
    }

    const sessionTokens = await issueSessionTokens({ userId: user.id, request, mfa: false });
    const accessToken = buildAccessToken(app, { userId: user.id, sessionId: sessionTokens.sessionId, amr: ["oauth"], mfa: false });
    return reply.send({
      user: { id: user.id, email: user.email, displayName: user.displayName, mfaEnabled: user.mfaEnabled },
      accessToken,
      accessTokenExpiresIn: getAccessTokenTtl(),
      refreshToken: sessionTokens.refreshToken,
      refreshTokenExpiresAt: sessionTokens.refreshTokenExpiresAt,
      sessionId: sessionTokens.sessionId
    });
  });

  app.post("/api/auth/oauth/apple", async (request, reply) => {
    const payload = oauthSchema.parse(request.body);
    const audience = process.env.APPLE_CLIENT_ID;
    if (!audience) {
      return reply.code(501).send({ message: "APPLE_CLIENT_ID is not configured" });
    }

    const verified = await verifyAppleIdToken(payload.idToken, audience);

    const user = await ensureLocalUser({
      email: verified.email,
      displayName: verified.name ?? null
    });

    await prisma.oAuthAccount.upsert({
      where: {
        provider_providerSubject: { provider: "APPLE", providerSubject: verified.sub }
      },
      update: {
        userId: user.id,
        accountEmail: verified.email,
        displayName: verified.name ?? undefined
      },
      create: {
        userId: user.id,
        provider: "APPLE",
        providerSubject: verified.sub,
        accountEmail: verified.email,
        displayName: verified.name ?? undefined
      }
    });

    if (user.mfaEnabled) {
      const challenge = await createMfaLoginChallenge(user.id);
      return reply.code(200).send({ mfaRequired: true, challengeId: challenge.id, method: "totp" });
    }

    const sessionTokens = await issueSessionTokens({ userId: user.id, request, mfa: false });
    const accessToken = buildAccessToken(app, { userId: user.id, sessionId: sessionTokens.sessionId, amr: ["oauth"], mfa: false });
    return reply.send({
      user: { id: user.id, email: user.email, displayName: user.displayName, mfaEnabled: user.mfaEnabled },
      accessToken,
      accessTokenExpiresIn: getAccessTokenTtl(),
      refreshToken: sessionTokens.refreshToken,
      refreshTokenExpiresAt: sessionTokens.refreshTokenExpiresAt,
      sessionId: sessionTokens.sessionId
    });
  });

  app.post("/api/auth/mfa/setup", async (request, reply) => {
    await request.jwtVerify();
    const userId = request.user.sub;
    const payload = mfaSetupSchema.parse(request.body);

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    if (!user || !user.passwordHash) {
      return reply.code(404).send({ message: "User not found" });
    }
    const ok = await verifyPassword(user.passwordHash, payload.password);
    if (!ok) {
      return reply.code(401).send({ message: "Invalid password" });
    }

    const secret = generateTotpSecret();
    const otpAuthUrl = buildOtpAuthUrl({ email: user.email, issuer: getMfaIssuer(), secret });
    const qrCodeDataUrl = await qrcode.toDataURL(otpAuthUrl);

    const key = getMfaEncryptionKey();
    const encrypted = encodeEncryptedPayload(encryptAes256Gcm(secret, key));

    await prisma.user.update({
      where: { id: userId },
      data: {
        mfaSecretEnc: encrypted,
        mfaEnabled: false
      }
    });

    return reply.send({
      issuer: getMfaIssuer(),
      secret: shouldReturnMfaSecret() ? secret : undefined,
      otpAuthUrl,
      qrCodeDataUrl
    });
  });

  app.get("/api/auth/mfa/status", async (request, reply) => {
    await request.jwtVerify();
    const userId = request.user.sub;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true }
    });

    if (!user) {
      return reply.code(404).send({ message: "User not found" });
    }

    return reply.send({ mfaEnabled: user.mfaEnabled });
  });

  app.post("/api/auth/mfa/enable", async (request, reply) => {
    await request.jwtVerify();
    const userId = request.user.sub;
    const payload = mfaEnableSchema.parse(request.body);

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user || !user.mfaSecretEnc) {
      return reply.code(404).send({ message: "MFA setup not started" });
    }

    const key = getMfaEncryptionKey();
    const decoded = decodeEncryptedPayload(user.mfaSecretEnc);
    if (!decoded) {
      return reply.code(409).send({ message: "Invalid MFA secret format" });
    }

    const secret = decryptAes256Gcm(decoded, key);
    const ok = verifyTotp({ token: payload.code, secret });
    if (!ok) {
      return reply.code(401).send({ message: "Invalid MFA code" });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true }
    });

    await prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "mfa_enabled_logout_all" }
    });

    return reply.code(204).send();
  });

  app.post("/api/auth/mfa/disable", async (request, reply) => {
    await request.jwtVerify();
    const userId = request.user.sub;
    const payload = mfaDisableSchema.parse(request.body);

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user || !user.passwordHash) {
      return reply.code(404).send({ message: "User not found" });
    }
    if (!user.mfaEnabled || !user.mfaSecretEnc) {
      return reply.code(409).send({ message: "MFA is not enabled" });
    }

    const passwordOk = await verifyPassword(user.passwordHash, payload.password);
    if (!passwordOk) {
      return reply.code(401).send({ message: "Invalid password" });
    }

    const key = getMfaEncryptionKey();
    const decoded = decodeEncryptedPayload(user.mfaSecretEnc);
    if (!decoded) {
      return reply.code(409).send({ message: "Invalid MFA secret format" });
    }
    const secret = decryptAes256Gcm(decoded, key);
    const mfaOk = verifyTotp({ token: payload.code, secret });
    if (!mfaOk) {
      return reply.code(401).send({ message: "Invalid MFA code" });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecretEnc: null }
    });

    await prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "mfa_disabled_logout_all" }
    });

    return reply.code(204).send();
  });

  app.addHook("onRequest", async (request) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return;
    }
    try {
      await request.jwtVerify();
      await touchSession(request.user.sid);
    } catch {
      // ignore
    }
  });
}

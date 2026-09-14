import crypto from "crypto";
import { UserType } from "@prisma/client";
import { prisma } from "../lib/prisma";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function createRawToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export type CreateAuthSessionInput = {
  userId: string;
  userType: UserType;
  deviceInfo?: string | null;
  ipAddress?: string | null;
};

export async function createAuthSession(
  input: CreateAuthSessionInput
) {
  const token = createRawToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const session = await prisma.authSession.create({
    data: {
      userId: input.userId,
      userType: input.userType,
      tokenHash,
      deviceInfo: input.deviceInfo ?? null,
      ipAddress: input.ipAddress ?? null,
      expiresAt,
    },
  });

  return {
    token,
    session: {
      id: session.id,
      userId: session.userId,
      userType: session.userType,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
    },
  };
}

export async function resolveAuthSession(
  token: string
) {
  const cleanToken = String(token ?? "").trim();

  if (!cleanToken) {
    return null;
  }

  const tokenHash = hashToken(cleanToken);

  const session = await prisma.authSession.findUnique({
    where: { tokenHash },
  });

  if (!session) {
    return null;
  }

  if (session.revokedAt) {
    return null;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  void prisma.authSession
    .update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    })
    .catch(() => undefined);

  return session;
}

export async function revokeAuthSession(
  token: string
): Promise<boolean> {
  const cleanToken = String(token ?? "").trim();

  if (!cleanToken) {
    return false;
  }

  const tokenHash = hashToken(cleanToken);

  const result = await prisma.authSession.updateMany({
    where: {
      tokenHash,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  return result.count > 0;
}

import { NextFunction, Request, Response } from "express";
import { UserStatus, UserType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { resolveAuthSession } from "../services/authSession";

export type AuthContext = {
  userId: string;
  userType: UserType;
  sessionId: string;
  token: string;
  customerId: string | null;
  driverId: string | null;
  adminId: string | null;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

function getBearerToken(req: Request): string | null {
  const header = String(req.headers.authorization ?? "").trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

async function loadAuthContext(
  token: string
): Promise<AuthContext | null> {
  const session = await resolveAuthSession(token);

  if (!session) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      userType: true,
      status: true,
      customer: {
        select: { id: true },
      },
      driver: {
        select: { id: true },
      },
      admin: {
        select: {
          id: true,
          approvalStatus: true,
        },
      },
    },
  });

  if (!user) {
    return null;
  }

  if (user.status !== UserStatus.ACTIVE) {
    return null;
  }

  if (session.userType !== user.userType) {
    return null;
  }

  if (session.userType === UserType.ADMIN) {
    const actor = user.admin;

    if (!actor) {
      return null;
    }

    if (actor.approvalStatus !== "APPROVED") {
      return null;
    }
  }

  return {
    userId: user.id,
    userType: user.userType,
    sessionId: session.id,
    token,
    customerId: user.customer?.id ?? null,
    driverId: user.driver?.id ?? null,
    adminId: user.admin?.id ?? null,
  };
}

export function requireAuth(...allowedTypes: UserType[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    return authenticate(req, res, next, allowedTypes);
  };
}

async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
  allowedTypes: UserType[]
): Promise<void> {
  try {
    console.log(
      "AUTH 1: request received",
      req.method,
      req.originalUrl
    );

    const token = getBearerToken(req);

    if (!token) {
      console.log("AUTH 2: no token");

      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    console.log("AUTH 2: token found");

    const auth = await loadAuthContext(token);

    console.log(
      "AUTH 3: loadAuthContext finished",
      !!auth
    );

    if (!auth) {
      res.status(401).json({
        success: false,
        message: "Invalid or expired session",
      });
      return;
    }

    if (
      allowedTypes.length > 0 &&
      !allowedTypes.includes(auth.userType)
    ) {
      res.status(403).json({
        success: false,
        message: "You are not authorized for this account type",
      });
      return;
    }

    req.auth = auth;

    console.log(
      "AUTH 4: calling next()"
    );

    next();

    console.log(
      "AUTH 5: next() returned"
    );
  } catch (error) {
    console.error(
      "AUTH MIDDLEWARE ERROR:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Authentication service unavailable",
    });
  }
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  return authenticate(req, res, next, []);
}

export function requireUserType(
  ...allowedTypes: UserType[]
) {
  return (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    return authenticate(req, res, next, allowedTypes);
  };
}

export function requireCustomerAuth() {
  return requireUserType(UserType.CUSTOMER);
}

export function requireDriverAuth() {
  return requireUserType(UserType.DRIVER);
}

export function requireAdminAuth() {
  return requireUserType(UserType.ADMIN);
}

export function getAuth(req: Request): AuthContext | null {
  return req.auth ?? null;
}

export function getRequiredAuth(req: Request): AuthContext {
  if (!req.auth) {
    throw new Error("Authentication context is missing");
  }

  return req.auth;
}

export function getAuthToken(req: Request): string | null {
  return getBearerToken(req);
}

export async function verifyAuthRequest(
  req: Request
): Promise<AuthContext | null> {
  const token = getBearerToken(req);

  if (!token) {
    return null;
  }

  return loadAuthContext(token);
}

export async function requireApprovedAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      res.status(401).json({
        success: false,
        message: "Admin authentication required",
      });
      return;
    }

    const auth = await loadAuthContext(token);

    if (!auth) {
      res.status(401).json({
        success: false,
        message: "Invalid or expired session",
      });
      return;
    }

    if (auth.userType !== UserType.ADMIN || !auth.adminId) {
      res.status(403).json({
        success: false,
        message: "Approved admin access required",
      });
      return;
    }

    // loadAuthContext already verifies AdminUser.approvalStatus === APPROVED.
    req.auth = auth;
    next();
  } catch (error) {
    console.error(
      "APPROVED ADMIN AUTH ERROR:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Authentication service unavailable",
    });
  }
}

/**
 * Application authentication middleware used by main.ts.
 * This is intentionally compatible with the existing RideX middleware wiring.
 */
export function requireAppAuth() {
  return requireAuth(
    UserType.CUSTOMER,
    UserType.DRIVER,
    UserType.ADMIN
  );
}

/**
 * When a legacy actor/user id header is supplied, ensure it matches the
 * authenticated session. Routes that do not send the header are left alone.
 */
export function enforceActorIdentity(
  req: Request,
  res: Response,
  next: NextFunction
) {
  console.log(
    "ACTOR 1: enforceActorIdentity",
    req.method,
    req.originalUrl
  );

  const auth = req.auth;

  if (!auth) {
    console.log("ACTOR 2: no auth context, next()");
    next();
    return;
  }

  const rawActorId =
    req.headers["x-user-id"] ??
    req.headers["x-actor-id"] ??
    req.headers["x-admin-user-id"];

  const actorId = Array.isArray(rawActorId)
    ? rawActorId[0]
    : rawActorId;

  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const pathCustomerId = String(req.params?.customerId ?? "").trim();
  const pathDriverId = String(req.params?.driverId ?? "").trim();
  const requestedCustomerId = String(body.customerId ?? pathCustomerId).trim();
  const requestedDriverId = String(body.driverId ?? pathDriverId).trim();

  // Customer/driver resource IDs must always belong to the authenticated actor.
  // Admins are intentionally excluded so they can operate on behalf of users.
  if (auth.userType === UserType.CUSTOMER && requestedCustomerId && auth.customerId && requestedCustomerId !== auth.customerId) {
    return res.status(403).json({ success: false, message: "Customer identity does not match session" });
  }
  if (auth.userType === UserType.DRIVER && requestedDriverId && auth.driverId && requestedDriverId !== auth.driverId) {
    return res.status(403).json({ success: false, message: "Driver identity does not match session" });
  }

  if (
    actorId &&
    String(actorId).trim() !== auth.userId
  ) {
    console.log(
      "ACTOR 2: identity mismatch"
    );

    res.status(403).json({
      success: false,
      message:
        "Authenticated actor does not match request identity",
    });
    return;
  }

  console.log(
    "ACTOR 2: identity accepted, next()"
  );

  next();
}

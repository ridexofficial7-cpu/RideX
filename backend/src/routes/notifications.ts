import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

/**
 * =========================================================
 * RIDEX NOTIFICATIONS
 * =========================================================
 *
 * Current schema:
 * Notification
 * - userId
 * - channel
 * - title
 * - body
 * - readAt
 * - sentAt
 * - createdAt
 *
 * User is the common notification recipient for Customer,
 * Driver and Admin accounts.
 *
 * Channels are stored as strings, for example:
 * - IN_APP
 * - PUSH
 * - SMS
 *
 * Current MVP uses in-app records. Real push/SMS provider
 * integration can be added later.
 *
 * Production:
 * actor/recipient identity should come from verified session
 * or JWT middleware rather than trusting arbitrary IDs.
 * =========================================================
 */

/**
 * =========================================================
 * HELPERS
 * =========================================================
 */

type ActorType =
  | "CUSTOMER"
  | "DRIVER"
  | "ADMIN";

function cleanString(
  value: unknown
) {
  const text =
    String(
      value ?? ""
    ).trim();

  return text || null;
}

function isActorType(
  value: unknown
): value is ActorType {
  return (
    value === "CUSTOMER" ||
    value === "DRIVER" ||
    value === "ADMIN"
  );
}

async function findActorUserId(
  actorType: ActorType,
  actorId: string
) {
  if (
    actorType ===
    "CUSTOMER"
  ) {
    const customer =
      await prisma.customer.findUnique({
        where: {
          id: actorId,
        },
        select: {
          id: true,
          userId: true,
        },
      });

    return customer;
  }

  if (
    actorType ===
    "DRIVER"
  ) {
    const driver =
      await prisma.driver.findUnique({
        where: {
          id: actorId,
        },
        select: {
          id: true,
          userId: true,
        },
      });

    return driver;
  }

  const admin =
    await prisma.adminUser.findUnique({
      where: {
        id: actorId,
      },
      select: {
        id: true,
        userId: true,
        approvalStatus:
          true,
      },
    });

  return admin;
}

/**
 * Resolve a notification recipient.
 *
 * Request can provide:
 * - actorType + actorId
 *
 * or:
 * - userId
 *
 * When actor identity is provided, we verify that the linked
 * User exists and matches the requested user.
 */
async function resolveRecipient(
  input: {
    userId?: string | null;
    actorType?: ActorType | null;
    actorId?: string | null;
  }
) {
  const requestedUserId =
    cleanString(
      input.userId
    );

  const actorId =
    cleanString(
      input.actorId
    );

  if (
    input.actorType &&
    actorId
  ) {
    const actor =
      await findActorUserId(
        input.actorType,
        actorId
      );

    if (!actor) {
      return {
        userId: null,
        actor: null,
      };
    }

    if (
      requestedUserId &&
      requestedUserId !==
        actor.userId
    ) {
      return {
        userId: null,
        actor: null,
      };
    }

    if (
      input.actorType ===
        "ADMIN" &&
      "approvalStatus" in actor &&
      actor.approvalStatus !==
        "APPROVED"
    ) {
      return {
        userId: null,
        actor: null,
        notApproved: true,
      };
    }

    return {
      userId:
        actor.userId,
      actor,
    };
  }

  if (
    requestedUserId
  ) {
    const user =
      await prisma.user.findUnique({
        where: {
          id:
            requestedUserId,
        },
        select: {
          id: true,
          userType: true,
          status: true,
        },
      });

    if (!user) {
      return {
        userId: null,
        actor: null,
      };
    }

    return {
      userId:
        user.id,
      actor:
        user,
    };
  }

  return {
    userId: null,
    actor: null,
  };
}

function recipientWhere(
  userId: string
) {
  return {
    userId,
  };
}

/**
 * =========================================================
 * CREATE NOTIFICATION
 * =========================================================
 *
 * POST /api/v1/notifications
 *
 * Body:
 * {
 *   userId?: string,
 *   actorType?: "CUSTOMER" | "DRIVER" | "ADMIN",
 *   actorId?: string,
 *   title: string,
 *   body: string,
 *   channel?: string,
 *   sent?: boolean
 * }
 *
 * This is an MVP/internal creation endpoint.
 * Backend jobs/events can use the same service later.
 */
router.post(
  "/",
  async (
    req,
    res
  ) => {
    try {
      const authUserId = String(req.auth?.userId ?? "").trim();

      const userId =
        cleanString(
          req.body?.userId
        );

      const actorTypeRaw =
        req.body?.actorType !==
        undefined
          ? String(
              req.body.actorType
            )
              .trim()
              .toUpperCase()
          : null;

      const actorType =
        actorTypeRaw &&
        isActorType(
          actorTypeRaw
        )
          ? actorTypeRaw
          : null;

      const actorId =
        cleanString(
          req.body?.actorId
        );

      const title =
        String(
          req.body?.title ??
            ""
        ).trim();

      const body =
        String(
          req.body?.body ??
            ""
        ).trim();

      const channel =
        String(
          req.body?.channel ??
            "IN_APP"
        ).trim();

      const sent =
        req.body?.sent === true;

      if (
        !title ||
        !body ||
        !channel
      ) {
        return res.status(400).json({
          success: false,
          message:
            "title, body and channel are required",
        });
      }

      if (
        actorType &&
        !actorId
      ) {
        return res.status(400).json({
          success: false,
          message:
            "actorId is required when actorType is supplied",
        });
      }

      if (
        actorTypeRaw &&
        !actorType
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid actorType",
          allowedActorTypes: [
            "CUSTOMER",
            "DRIVER",
            "ADMIN",
          ],
        });
      }

      const recipient =
        authUserId
          ? { userId: authUserId }
          : await resolveRecipient({
              userId: userId || authUserId,
              actorType,
              actorId,
            });

      if (
        (actorType &&
          actorId &&
          "notApproved" in
            recipient &&
          recipient.notApproved)
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Admin account is not approved",
        });
      }

      if (
        !recipient.userId
      ) {
        return res.status(404).json({
          success: false,
          message:
            "Notification recipient not found",
        });
      }

      const notification =
        await prisma.notification.create({
          data: {
            userId:
              recipient.userId,
            channel,
            title,
            body,
            sentAt:
              sent
                ? new Date()
                : null,
          },
        });

      return res.status(201).json({
        success: true,
        data: notification,
        message:
          "Notification created successfully",
      });
    } catch (error) {
      console.error(
        "CREATE NOTIFICATION ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to create notification",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/**
 * =========================================================
 * LIST NOTIFICATIONS
 * =========================================================
 *
 * GET /api/v1/notifications
 *
 * Query:
 * ?userId=...
 * ?actorType=CUSTOMER&actorId=...
 * ?unreadOnly=true
 * ?channel=IN_APP
 */
router.get(
  "/",
  async (
    req,
    res
  ) => {
    try {
      const userId =
        cleanString(
          req.query?.userId
        );

      const actorTypeRaw =
        typeof req.query?.actorType ===
        "string"
          ? req.query.actorType
              .trim()
              .toUpperCase()
          : "";

      const actorType =
        actorTypeRaw &&
        isActorType(
          actorTypeRaw
        )
          ? actorTypeRaw
          : null;

      const actorId =
        cleanString(
          req.query?.actorId
        );

      const unreadOnly =
        String(
          req.query?.unreadOnly ??
            ""
        )
          .trim()
          .toLowerCase() ===
        "true";

      const channel =
        cleanString(
          req.query?.channel
        );

      // The authenticated session is the source of truth. Query/body actor IDs
      // remain supported for backward compatibility only when they match the
      // session identity. This also avoids cross-account notification access.
      const authUserId = String(req.auth?.userId ?? "").trim();
      const authActorId =
        req.auth?.userType === "CUSTOMER"
          ? req.auth.customerId
          : req.auth?.userType === "DRIVER"
            ? req.auth.driverId
            : req.auth?.adminId;

      if (authUserId) {
        if (userId && userId !== authUserId) {
          return res.status(403).json({ success: false, message: "Notification access denied" });
        }
        if (actorType && actorType !== req.auth?.userType) {
          return res.status(403).json({ success: false, message: "Notification actor type does not match session" });
        }
        if (actorId && authActorId && actorId !== authActorId) {
          return res.status(403).json({ success: false, message: "Notification actor does not match session" });
        }
      }

      if (
        actorTypeRaw &&
        !actorType
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid actorType",
        });
      }

      if (
        actorType &&
        !actorId
      ) {
        return res.status(400).json({
          success: false,
          message:
            "actorId is required when actorType is supplied",
        });
      }

      const recipient =
        await resolveRecipient({
          userId: userId || authUserId,
          actorType,
          actorId,
        });

      if (
        !recipient.userId
      ) {
        return res.status(404).json({
          success: false,
          message:
            "Notification recipient not found",
        });
      }

      const notifications =
        await prisma.notification.findMany({
          where: {
            ...recipientWhere(
              recipient.userId
            ),
            ...(unreadOnly
              ? {
                  readAt:
                    null,
                }
              : {}),
            ...(channel
              ? {
                  channel,
                }
              : {}),
          },
          orderBy: {
            createdAt:
              "desc",
          },
          take: 100,
        });

      return res.json({
        success: true,
        data: notifications,
      });
    } catch (error) {
      console.error(
        "LIST NOTIFICATIONS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load notifications",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/**
 * =========================================================
 * UNREAD COUNT
 * =========================================================
 *
 * GET /api/v1/notifications/unread-count
 * ?userId=...
 *
 * or:
 * ?actorType=CUSTOMER&actorId=...
 */
router.get(
  "/unread-count",
  async (
    req,
    res
  ) => {
    try {
      const userId =
        cleanString(
          req.query?.userId
        );

      const actorTypeRaw =
        typeof req.query?.actorType ===
        "string"
          ? req.query.actorType
              .trim()
              .toUpperCase()
          : "";

      const actorType =
        actorTypeRaw &&
        isActorType(
          actorTypeRaw
        )
          ? actorTypeRaw
          : null;

      const actorId =
        cleanString(
          req.query?.actorId
        );

      if (
        actorTypeRaw &&
        !actorType
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid actorType",
          allowedActorTypes: [
            "CUSTOMER",
            "DRIVER",
            "ADMIN",
          ],
        });
      }

      if (
        actorType &&
        !actorId
      ) {
        return res.status(400).json({
          success: false,
          message:
            "actorId is required when actorType is supplied",
        });
      }

      const authUserId = String(req.auth?.userId ?? "").trim();
      const authActorId =
        req.auth?.userType === "CUSTOMER"
          ? req.auth.customerId
          : req.auth?.userType === "DRIVER"
            ? req.auth.driverId
            : req.auth?.adminId;

      if (!authUserId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      if (userId && userId !== authUserId) {
        return res.status(403).json({ success: false, message: "Notification access denied" });
      }
      if (actorType && actorType !== req.auth?.userType) {
        return res.status(403).json({ success: false, message: "Notification actor type does not match session" });
      }
      if (actorId && authActorId && actorId !== authActorId) {
        return res.status(403).json({ success: false, message: "Notification actor does not match session" });
      }

      const recipient = { userId: authUserId };

      const unreadCount =
        await prisma.notification.count({
          where: {
            ...recipientWhere(
              recipient.userId
            ),
            readAt: null,
          },
        });

      return res.json({
        success: true,
        data: {
          userId:
            recipient.userId,
          unreadCount,
        },
      });
    } catch (error) {
      console.error(
        "UNREAD NOTIFICATION COUNT ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load unread notification count",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/**
 * =========================================================
 * MARK ONE AS READ
 * =========================================================
 *
 * PATCH /api/v1/notifications/:notificationId/read
 *
 * Body:
 * {
 *   userId?: string,
 *   actorType?: "CUSTOMER" | "DRIVER" | "ADMIN",
 *   actorId?: string
 * }
 */
router.patch(
  "/:notificationId/read",
  async (
    req,
    res
  ) => {
    try {
      const notificationId =
        String(
          req.params.notificationId ??
            ""
        ).trim();

      if (!notificationId) {
        return res.status(400).json({
          success: false,
          message:
            "notificationId is required",
        });
      }

      const readActorTypeRaw =
        req.body?.actorType !==
        undefined
          ? String(
              req.body.actorType
            )
              .trim()
              .toUpperCase()
          : "";

      if (
        readActorTypeRaw &&
        !isActorType(
          readActorTypeRaw
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid actorType",
          allowedActorTypes: [
            "CUSTOMER",
            "DRIVER",
            "ADMIN",
          ],
        });
      }

      const authUserId = String(req.auth?.userId ?? "").trim();
      const authActorId =
        req.auth?.userType === "CUSTOMER"
          ? req.auth.customerId
          : req.auth?.userType === "DRIVER"
            ? req.auth.driverId
            : req.auth?.adminId;
      const requestedUserId = cleanString(req.body?.userId);
      const readActorId = cleanString(req.body?.actorId);
      const readActorType = readActorTypeRaw ? (readActorTypeRaw as ActorType) : null;

      if (!authUserId) {
        return res.status(401).json({ success: false, message: "Authentication required" });
      }
      if (requestedUserId && requestedUserId !== authUserId) {
        return res.status(403).json({ success: false, message: "Notification access denied" });
      }
      if (readActorType && readActorType !== req.auth?.userType) {
        return res.status(403).json({ success: false, message: "Notification actor type does not match session" });
      }
      if (readActorId && authActorId && readActorId !== authActorId) {
        return res.status(403).json({ success: false, message: "Notification actor does not match session" });
      }

      const recipient = { userId: authUserId };

      const notification =
        await prisma.notification.findUnique({
          where: {
            id:
              notificationId,
          },
          select: {
            id: true,
            userId: true,
            readAt: true,
          },
        });

      if (!notification) {
        return res.status(404).json({
          success: false,
          message:
            "Notification not found",
        });
      }

      if (
        notification.userId !==
        recipient.userId
      ) {
        return res.status(403).json({
          success: false,
          message:
            "User is not allowed to modify this notification",
        });
      }

      if (
        notification.readAt
      ) {
        return res.json({
          success: true,
          alreadyRead: true,
          data:
            notification,
          message:
            "Notification already marked as read",
        });
      }

      const updated =
        await prisma.notification.update({
          where: {
            id:
              notificationId,
          },
          data: {
            readAt:
              new Date(),
          },
        });

      return res.json({
        success: true,
        data: updated,
        message:
          "Notification marked as read",
      });
    } catch (error) {
      console.error(
        "MARK NOTIFICATION READ ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to mark notification as read",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/**
 * =========================================================
 * MARK ALL AS READ
 * =========================================================
 *
 * PATCH /api/v1/notifications/read-all
 */
router.patch(
  "/read-all",
  async (
    req,
    res
  ) => {
    try {
      const readAllActorTypeRaw =
        req.body?.actorType !==
        undefined
          ? String(
              req.body.actorType
            )
              .trim()
              .toUpperCase()
          : "";

      if (
        readAllActorTypeRaw &&
        !isActorType(
          readAllActorTypeRaw
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid actorType",
          allowedActorTypes: [
            "CUSTOMER",
            "DRIVER",
            "ADMIN",
          ],
        });
      }

      const authUserId = String(req.auth?.userId ?? "").trim();
      const authActorId =
        req.auth?.userType === "CUSTOMER"
          ? req.auth.customerId
          : req.auth?.userType === "DRIVER"
            ? req.auth.driverId
            : req.auth?.adminId;
      const requestedUserId = cleanString(req.body?.userId);
      const readAllActorId = cleanString(req.body?.actorId);
      const readAllActorType = readAllActorTypeRaw ? (readAllActorTypeRaw as ActorType) : null;

      if (!authUserId) {
        return res.status(401).json({ success: false, message: "Authentication required" });
      }
      if (requestedUserId && requestedUserId !== authUserId) {
        return res.status(403).json({ success: false, message: "Notification access denied" });
      }
      if (readAllActorType && readAllActorType !== req.auth?.userType) {
        return res.status(403).json({ success: false, message: "Notification actor type does not match session" });
      }
      if (readAllActorId && authActorId && readAllActorId !== authActorId) {
        return res.status(403).json({ success: false, message: "Notification actor does not match session" });
      }

      const recipient = { userId: authUserId };

      const result =
        await prisma.notification.updateMany({
          where: {
            ...recipientWhere(
              recipient.userId
            ),
            readAt: null,
          },
          data: {
            readAt:
              new Date(),
          },
        });

      return res.json({
        success: true,
        data: {
          updatedCount:
            result.count,
        },
        message:
          "All notifications marked as read",
      });
    } catch (error) {
      console.error(
        "MARK ALL NOTIFICATIONS READ ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to mark notifications as read",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/**
 * =========================================================
 * DELETE NOTIFICATION
 * =========================================================
 *
 * DELETE /api/v1/notifications/:notificationId
 */
router.delete(
  "/:notificationId",
  async (
    req,
    res
  ) => {
    try {
      const notificationId =
        String(
          req.params.notificationId ??
            ""
        ).trim();

      if (!notificationId) {
        return res.status(400).json({
          success: false,
          message:
            "notificationId is required",
        });
      }

      const deleteActorTypeRaw =
        req.body?.actorType !==
        undefined
          ? String(
              req.body.actorType
            )
              .trim()
              .toUpperCase()
          : "";

      if (
        deleteActorTypeRaw &&
        !isActorType(
          deleteActorTypeRaw
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid actorType",
          allowedActorTypes: [
            "CUSTOMER",
            "DRIVER",
            "ADMIN",
          ],
        });
      }

      const authUserId = String(req.auth?.userId ?? "").trim();
      const authActorId =
        req.auth?.userType === "CUSTOMER"
          ? req.auth.customerId
          : req.auth?.userType === "DRIVER"
            ? req.auth.driverId
            : req.auth?.adminId;
      const requestedUserId = cleanString(req.body?.userId);
      const deleteActorId = cleanString(req.body?.actorId);
      const deleteActorType = deleteActorTypeRaw ? (deleteActorTypeRaw as ActorType) : null;

      if (!authUserId) {
        return res.status(401).json({ success: false, message: "Authentication required" });
      }
      if (requestedUserId && requestedUserId !== authUserId) {
        return res.status(403).json({ success: false, message: "Notification access denied" });
      }
      if (deleteActorType && deleteActorType !== req.auth?.userType) {
        return res.status(403).json({ success: false, message: "Notification actor type does not match session" });
      }
      if (deleteActorId && authActorId && deleteActorId !== authActorId) {
        return res.status(403).json({ success: false, message: "Notification actor does not match session" });
      }

      const recipient = { userId: authUserId };

      const notification =
        await prisma.notification.findUnique({
          where: {
            id:
              notificationId,
          },
          select: {
            id: true,
            userId: true,
          },
        });

      if (!notification) {
        return res.status(404).json({
          success: false,
          message:
            "Notification not found",
        });
      }

      if (
        notification.userId !==
        recipient.userId
      ) {
        return res.status(403).json({
          success: false,
          message:
            "User is not allowed to delete this notification",
        });
      }

      await prisma.notification.delete({
        where: {
          id:
            notificationId,
        },
      });

      return res.json({
        success: true,
        message:
          "Notification deleted successfully",
      });
    } catch (error) {
      console.error(
        "DELETE NOTIFICATION ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to delete notification",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

export {
  router as notificationsRouter,
};


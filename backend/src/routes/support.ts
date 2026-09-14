import { Router, Request } from "express";
import {
  AdminApprovalStatus,
  AuditAction,
  PermissionAction,
  SupportPriority,
  SupportStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma";

const router = Router();

/**
 * =========================================================
 * RIDEX SUPPORT
 * =========================================================
 *
 * Customer / Driver support case flow for MVP.
 *
 * Main flow:
 *
 * Customer/Driver
 *      ↓
 * POST /support/cases
 *      ↓
 * SupportCase OPEN
 *      ↓
 * POST /support/cases/:caseId/messages
 *      ↓
 * SupportMessage
 *
 * Admin support tooling can later assign/update cases through
 * the Admin Panel. This route keeps the customer/driver side
 * ready without inventing a separate admin authentication
 * contract.
 */

/**
 * =========================================================
 * HELPERS
 * =========================================================
 */

type ActorType = "CUSTOMER" | "DRIVER";

function cleanString(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function parsePriority(value: unknown): SupportPriority {
  const raw = String(
    value ?? SupportPriority.NORMAL
  )
    .trim()
    .toUpperCase();

  if (
    Object.values(SupportPriority).includes(
      raw as SupportPriority
    )
  ) {
    return raw as SupportPriority;
  }

  return SupportPriority.NORMAL;
}

function isActorType(value: unknown): value is ActorType {
  return (
    value === "CUSTOMER" ||
    value === "DRIVER"
  );
}

type AdminContext = {
  adminId: string;
  userId: string;
  role: string;
  approvalStatus: AdminApprovalStatus;
  permissions: Set<string>;
  isSuperAdmin: boolean;
};

function adminPermissionKey(
  module: string,
  action: PermissionAction
) {
  return `${module.toLowerCase()}:${String(
    action
  ).toUpperCase()}`;
}

function getAdminUserId(req: Request) {
  const authUserId = String(req.auth?.userId ?? "").trim();
  if (authUserId && req.auth?.userType === "ADMIN") return authUserId;

  const headerValue = req.headers["x-admin-user-id"];
  if (Array.isArray(headerValue)) return String(headerValue[0] ?? "").trim();
  return String(headerValue ?? "").trim();
}

async function requireSupportAdmin(
  req: Request,
  res: any
): Promise<AdminContext | null> {
  const userId =
    getAdminUserId(req);

  if (!userId) {
    res.status(401).json({
      success: false,
      message:
        "Admin authentication required. Send x-admin-user-id.",
    });
    return null;
  }

  const admin =
    await prisma.adminUser.findUnique({
      where: {
        userId,
      },
      include: {
        role: {
          include: {
            permissionLinks: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

  if (!admin) {
    res.status(401).json({
      success: false,
      message:
        "Admin account not found",
    });
    return null;
  }

  if (
    admin.approvalStatus !==
    AdminApprovalStatus.APPROVED
  ) {
    res.status(403).json({
      success: false,
      message:
        "Admin account is not approved",
    });
    return null;
  }

  const permissions =
    new Set<string>();

  for (
    const link of
      admin.role.permissionLinks
  ) {
    permissions.add(
      adminPermissionKey(
        link.permission.module,
        link.permission.action
      )
    );
  }

  const roleName =
    String(
      admin.role.name ?? ""
    ).toUpperCase();

  const isSuperAdmin =
    roleName ===
    "SUPER_ADMIN";

  const canEdit =
    isSuperAdmin ||
    permissions.has(
      adminPermissionKey(
        "SUPPORT",
        PermissionAction.EDIT
      )
    );

  if (!canEdit) {
    res.status(403).json({
      success: false,
      message:
        "Support EDIT permission required",
    });
    return null;
  }

  return {
    adminId:
      admin.id,
    userId:
      admin.userId,
    role:
      roleName,
    approvalStatus:
      admin.approvalStatus,
    permissions,
    isSuperAdmin,
  };
}


/**
 * Validate that the supplied actor exists.
 */
async function validateActor(
  actorType: ActorType,
  actorId: string
) {
  if (actorType === "CUSTOMER") {
    return prisma.customer.findUnique({
      where: {
        id: actorId,
      },
      select: {
        id: true,
      },
    });
  }

  return prisma.driver.findUnique({
    where: {
      id: actorId,
    },
    select: {
      id: true,
    },
  });
}

/**
 * Validate booking access for the actor.
 *
 * Connection Ride is one booking with multiple automatic
 * legs, so a driver is allowed when assigned at booking level
 * OR assigned to any booking leg.
 */
async function validateBookingAccess(
  bookingId: string,
  actorType: ActorType,
  actorId: string
) {
  const booking =
    await prisma.booking.findUnique({
      where: {
        id: bookingId,
      },
      select: {
        id: true,
        customerId: true,
        assignedDriverId: true,
        status: true,
        legs: {
          select: {
            driverId: true,
          },
        },
      },
    });

  if (!booking) {
    return {
      booking: null,
      allowed: false,
    };
  }

  if (actorType === "CUSTOMER") {
    return {
      booking,
      allowed:
        booking.customerId === actorId,
    };
  }

  const driverOnBooking =
    booking.assignedDriverId === actorId;

  const driverOnAnyLeg =
    booking.legs.some(
      (leg) =>
        leg.driverId === actorId
    );

  return {
    booking,
    allowed:
      driverOnBooking ||
      driverOnAnyLeg,
  };
}

/**
 * =========================================================
 * CREATE SUPPORT CASE
 * =========================================================
 *
 * POST /api/v1/support/cases
 *
 * Body:
 * {
 *   actorType: "CUSTOMER" | "DRIVER",
 *   actorId: string,
 *   bookingId?: string,
 *   subject: string,
 *   description: string,
 *   priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT"
 * }
 */
router.post(
  "/cases",
  async (req, res) => {
    try {
      const actorType =
        String(
          req.body?.actorType ??
            ""
        )
          .trim()
          .toUpperCase();

      const actorId =
        String(
          req.body?.actorId ??
            ""
        ).trim();

      const bookingId =
        cleanString(
          req.body?.bookingId
        );

      const subject =
        String(
          req.body?.subject ??
            ""
        ).trim();

      const description =
        String(
          req.body?.description ??
            ""
        ).trim();

      const priority =
        parsePriority(
          req.body?.priority
        );

      if (
        !isActorType(actorType) ||
        !actorId ||
        !subject ||
        !description
      ) {
        return res.status(400).json({
          success: false,
          message:
            "actorType, actorId, subject and description are required",
        });
      }

      const actor =
        await validateActor(
          actorType,
          actorId
        );

      if (!actor) {
        return res.status(404).json({
          success: false,
          message:
            `${actorType.toLowerCase()} not found`,
        });
      }

      if (bookingId) {
        const access =
          await validateBookingAccess(
            bookingId,
            actorType,
            actorId
          );

        if (!access.booking) {
          return res.status(404).json({
            success: false,
            message: "Booking not found",
          });
        }

        if (!access.allowed) {
          return res.status(403).json({
            success: false,
            message:
              "Actor is not allowed to create support case for this booking",
          });
        }
      }

      const supportCase =
        await prisma.supportCase.create({
          data: {
            bookingId,
            customerId:
              actorType ===
              "CUSTOMER"
                ? actorId
                : null,
            driverId:
              actorType ===
              "DRIVER"
                ? actorId
                : null,
            subject,
            description,
            status:
              SupportStatus.OPEN,
            priority,
          },
          include: {
            booking: {
              select: {
                id: true,
                status: true,
                pickupAddress: true,
                dropAddress: true,
              },
            },
            messages: {
              orderBy: {
                createdAt: "asc",
              },
            },
          },
        });

      return res.status(201).json({
        success: true,
        data: supportCase,
        message:
          "Support case created successfully",
      });
    } catch (error) {
      console.error(
        "CREATE SUPPORT CASE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to create support case",
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
 * LIST SUPPORT CASES FOR ACTOR
 * =========================================================
 *
 * GET /api/v1/support/cases?actorType=CUSTOMER&actorId=...
 */
router.get(
  "/cases",
  async (req, res) => {
    try {
      const actorType =
        String(
          req.query?.actorType ??
            ""
        )
          .trim()
          .toUpperCase();

      const actorId =
        String(
          req.query?.actorId ??
            ""
        ).trim();

      if (
        !isActorType(actorType) ||
        !actorId
      ) {
        return res.status(400).json({
          success: false,
          message:
            "actorType and actorId are required",
        });
      }

      const actor =
        await validateActor(
          actorType,
          actorId
        );

      if (!actor) {
        return res.status(404).json({
          success: false,
          message:
            `${actorType.toLowerCase()} not found`,
        });
      }

      const cases =
        await prisma.supportCase.findMany({
          where:
            actorType ===
            "CUSTOMER"
              ? {
                  customerId:
                    actorId,
                }
              : {
                  driverId:
                    actorId,
                },
          orderBy: {
            updatedAt: "desc",
          },
          take: 100,
          include: {
            booking: {
              select: {
                id: true,
                status: true,
                pickupAddress: true,
                dropAddress: true,
              },
            },
            messages: {
              orderBy: {
                createdAt: "asc",
              },
            },
          },
        });

      return res.json({
        success: true,
        data: cases,
      });
    } catch (error) {
      console.error(
        "LIST SUPPORT CASES ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load support cases",
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
 * GET SINGLE SUPPORT CASE
 * =========================================================
 *
 * GET /api/v1/support/cases/:caseId
 *
 * Requires actorType + actorId query parameters so that an
 * actor cannot read another customer's/driver's case merely
 * by guessing the case ID.
 */
router.get(
  "/cases/:caseId",
  async (req, res) => {
    try {
      const caseId =
        String(
          req.params.caseId ??
            ""
        ).trim();

      const actorType =
        String(
          req.query?.actorType ??
            ""
        )
          .trim()
          .toUpperCase();

      const actorId =
        String(
          req.query?.actorId ??
            ""
        ).trim();

      if (
        !caseId ||
        !isActorType(actorType) ||
        !actorId
      ) {
        return res.status(400).json({
          success: false,
          message:
            "caseId, actorType and actorId are required",
        });
      }

      const supportCase =
        await prisma.supportCase.findUnique({
          where: {
            id: caseId,
          },
          include: {
            booking: {
              select: {
                id: true,
                customerId: true,
                assignedDriverId: true,
                status: true,
                pickupAddress: true,
                dropAddress: true,
              },
            },
            messages: {
              orderBy: {
                createdAt: "asc",
              },
            },
          },
        });

      if (!supportCase) {
        return res.status(404).json({
          success: false,
          message:
            "Support case not found",
        });
      }

      const ownerMatch =
        actorType ===
        "CUSTOMER"
          ? supportCase.customerId ===
            actorId
          : supportCase.driverId ===
            actorId;

      if (!ownerMatch) {
        return res.status(403).json({
          success: false,
          message:
            "Actor is not allowed to view this support case",
        });
      }

      return res.json({
        success: true,
        data: supportCase,
      });
    } catch (error) {
      console.error(
        "GET SUPPORT CASE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load support case",
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
 * ADD SUPPORT MESSAGE
 * =========================================================
 *
 * POST /api/v1/support/cases/:caseId/messages
 *
 * Body:
 * {
 *   actorType: "CUSTOMER" | "DRIVER",
 *   actorId: string,
 *   message: string,
 *   attachmentUrl?: string
 * }
 */
router.post(
  "/cases/:caseId/messages",
  async (req, res) => {
    try {
      const caseId =
        String(
          req.params.caseId ??
            ""
        ).trim();

      const actorType =
        String(
          req.body?.actorType ??
            ""
        )
          .trim()
          .toUpperCase();

      const actorId =
        String(
          req.body?.actorId ??
            ""
        ).trim();

      const message =
        String(
          req.body?.message ??
            ""
        ).trim();

      const attachmentUrl =
        cleanString(
          req.body?.attachmentUrl
        );

      if (
        !caseId ||
        !isActorType(actorType) ||
        !actorId ||
        !message
      ) {
        return res.status(400).json({
          success: false,
          message:
            "caseId, actorType, actorId and message are required",
        });
      }

      const actor =
        await validateActor(
          actorType,
          actorId
        );

      if (!actor) {
        return res.status(404).json({
          success: false,
          message:
            `${actorType.toLowerCase()} not found`,
        });
      }

      const supportCase =
        await prisma.supportCase.findUnique({
          where: {
            id: caseId,
          },
          select: {
            id: true,
            customerId: true,
            driverId: true,
            status: true,
          },
        });

      if (!supportCase) {
        return res.status(404).json({
          success: false,
          message:
            "Support case not found",
        });
      }

      const ownerMatch =
        actorType ===
        "CUSTOMER"
          ? supportCase.customerId ===
            actorId
          : supportCase.driverId ===
            actorId;

      if (!ownerMatch) {
        return res.status(403).json({
          success: false,
          message:
            "Actor is not allowed to add a message to this case",
        });
      }

      if (
        supportCase.status ===
          SupportStatus.CLOSED ||
        supportCase.status ===
          SupportStatus.RESOLVED
      ) {
        return res.status(409).json({
          success: false,
          message:
            "This support case is already closed/resolved",
        });
      }

      const result =
        await prisma.$transaction(
          async (tx) => {
            const supportMessage =
              await tx.supportMessage.create({
                data: {
                  caseId,
                  senderType:
                    actorType,
                  senderId:
                    actorId,
                  message,
                  attachmentUrl,
                },
              });

            const updatedCase =
              await tx.supportCase.update({
                where: {
                  id: caseId,
                },
                data: {
                  status:
                    SupportStatus.IN_PROGRESS,
                },
              });

            return {
              supportMessage,
              supportCase:
                updatedCase,
            };
          }
        );

      return res.status(201).json({
        success: true,
        data: result,
        message:
          "Support message added successfully",
      });
    } catch (error) {
      console.error(
        "ADD SUPPORT MESSAGE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to add support message",
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
 * UPDATE CASE STATUS / PRIORITY
 * =========================================================
 *
 * Development/admin-helper endpoint.
 *
 * Production Admin Panel should protect this with Admin RBAC
 * and action-level permissions.
 *
 * Body:
 * {
 *   status?: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED",
 *   priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT"
 * }
 */
router.patch(
  "/cases/:caseId",
  async (req, res) => {
    try {
      const admin =
        await requireSupportAdmin(
          req,
          res
        );

      if (!admin) {
        return;
      }

      const caseId =
        String(
          req.params.caseId ??
            ""
        ).trim();

      const rawStatus =
        req.body?.status !==
        undefined
          ? String(
              req.body.status
            )
              .trim()
              .toUpperCase()
          : null;

      const rawPriority =
        req.body?.priority !==
        undefined
          ? String(
              req.body.priority
            )
              .trim()
              .toUpperCase()
          : null;

      if (!caseId) {
        return res.status(400).json({
          success: false,
          message:
            "caseId is required",
        });
      }

      const data: {
        status?: SupportStatus;
        priority?: SupportPriority;
      } = {};

      if (rawStatus !== null) {
        if (
          !Object.values(
            SupportStatus
          ).includes(
            rawStatus as SupportStatus
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid support status",
          });
        }

        data.status =
          rawStatus as SupportStatus;
      }

      if (rawPriority !== null) {
        if (
          !Object.values(
            SupportPriority
          ).includes(
            rawPriority as SupportPriority
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid support priority",
          });
        }

        data.priority =
          rawPriority as SupportPriority;
      }

      if (
        data.status ===
          undefined &&
        data.priority ===
          undefined
      ) {
        return res.status(400).json({
          success: false,
          message:
            "At least one of status or priority is required",
        });
      }

      const existing =
        await prisma.supportCase.findUnique({
          where: {
            id: caseId,
          },
          select: {
            id: true,
          },
        });

      if (!existing) {
        return res.status(404).json({
          success: false,
          message:
            "Support case not found",
        });
      }

      const updated =
        await prisma.supportCase.update({
          where: {
            id: caseId,
          },
          data,
          include: {
            booking: {
              select: {
                id: true,
                status: true,
              },
            },
            messages: {
              orderBy: {
                createdAt: "asc",
              },
            },
          },
        });

      await prisma.auditLog.create({
        data: {
          adminId:
            admin.adminId,
          action:
            AuditAction.UPDATE,
          module:
            "support",
          entityType:
            "SupportCase",
          entityId:
            caseId,
          beforeData:
            existing,
          afterData: {
            status:
              data.status ?? null,
            priority:
              data.priority ?? null,
          },
          ipAddress:
            typeof req.ip ===
            "string"
              ? req.ip
              : null,
          userAgent:
            typeof req.headers[
              "user-agent"
            ] === "string"
              ? req.headers[
                  "user-agent"
                ]
              : null,
        },
      });

      return res.json({
        success: true,
        data: updated,
        message:
          "Support case updated successfully",
      });
    } catch (error) {
      console.error(
        "UPDATE SUPPORT CASE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to update support case",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

export {
  router as supportRouter,
};

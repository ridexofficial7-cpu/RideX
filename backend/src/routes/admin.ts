import { Router, Request } from "express";
import {
  AdminApprovalStatus,
  AuditAction,
  PermissionAction,
  UserType,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getRideXTestDataRecords, getRideXTestDataSummary, resetRideXTestData, seedRideXTestData } from "../services/testData";

const router = Router();

/**
 * =========================================================
 * RIDEX ADMIN API
 * =========================================================
 *
 * MVP Admin API with:
 * - Dashboard
 * - Drivers / KYC / status
 * - Customer & booking management
 * - Safety/SOS
 * - Support-oriented admin data
 * - Admin users
 * - Roles
 * - Permissions
 * - RBAC checks
 * - Audit logs
 * - High-risk confirmation
 * - Test Pickup Truck setup
 *
 * IMPORTANT
 * ---------------------------------------------------------
 * Current project auth is still TEST/MVP mode.
 * Admin identity is read from:
 *
 *   x-admin-user-id
 *
 * Production must replace this with a verified admin session
 * or JWT middleware and device/session controls.
 *
 * PostgreSQL remains the source of truth.
 * =========================================================
 */

/* =========================================================
   CONSTANTS
   ========================================================= */

const SUPER_ADMIN_ROLE = "SUPER_ADMIN";

const ACTIVE_OPERATIONAL_BOOKING_STATUSES = [
  "MATCHING",
  "DRIVER_ASSIGNED",
  "DRIVER_ARRIVING",
  "DRIVER_ARRIVED",
  "STARTED",
  "IN_PROGRESS",
  "AT_RISK",
] as const;

const ALLOWED_DRIVER_STATUSES = [
  "OFFLINE",
  "ONLINE",
  "ON_TRIP",
  "SUSPENDED",
] as const;

const ALLOWED_VERIFICATION_STATUSES = [
  "PENDING",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
] as const;

const ADMIN_ROLES = [
  "SUPER_ADMIN",
  "OPERATIONS",
  "FINANCE",
  "SAFETY",
  "SUPPORT",
  "VERIFICATION_KYC",
] as const;

/* =========================================================
   TYPES / HELPERS
   ========================================================= */

type AdminContext = {
  adminId: string;
  userId: string;
  name: string;
  role: string;
  approvalStatus: AdminApprovalStatus;
  permissions: Set<string>;
  isSuperAdmin: boolean;
};

function cleanString(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function auditActionOrFallback(
  requested: unknown,
  fallback: AuditAction
) {
  const raw = String(requested ?? "")
    .trim()
    .toUpperCase();

  return Object.values(AuditAction).includes(
    raw as AuditAction
  )
    ? (raw as AuditAction)
    : fallback;
}

function permissionKey(
  module: string,
  action: PermissionAction
) {
  return `${module.toLowerCase()}:${String(
    action
  ).toUpperCase()}`;
}

function getAdminUserId(req: Request) {
  const authUserId = String(req.auth?.userId ?? "").trim();
  if (authUserId && req.auth?.userType === UserType.ADMIN) return authUserId;

  const headerValue = req.headers["x-admin-user-id"];
  if (Array.isArray(headerValue)) return String(headerValue[0] ?? "").trim();
  return String(headerValue ?? "").trim();
}

async function loadAdminContext(
  req: Request
): Promise<AdminContext | null> {
  const userId =
    getAdminUserId(req);

  if (!userId) {
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
    return null;
  }

  const permissions =
    new Set<string>();

  for (
    const link of
      admin.role.permissionLinks
  ) {
    permissions.add(
      permissionKey(
        link.permission.module,
        link.permission.action
      )
    );
  }

  const roleName =
    String(
      admin.role.name ?? ""
    ).toUpperCase();

  return {
    adminId: admin.id,
    userId: admin.userId,
    name: admin.name,
    role: roleName,
    approvalStatus:
      admin.approvalStatus,
    permissions,
    isSuperAdmin:
      roleName ===
      SUPER_ADMIN_ROLE,
  };
}

async function requireAdmin(
  req: Request,
  res: any
) {
  const admin =
    await loadAdminContext(req);

  if (!admin) {
    res.status(401).json({
      success: false,
      message:
        "Admin authentication required.",
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

  return admin;
}

function hasPermission(
  admin: AdminContext,
  module: string,
  action: PermissionAction
) {
  return (
    admin.isSuperAdmin ||
    admin.permissions.has(
      permissionKey(module, action)
    )
  );
}

async function requirePermission(
  req: Request,
  res: any,
  module: string,
  action: PermissionAction
) {
  const admin =
    await requireAdmin(
      req,
      res
    );

  if (!admin) {
    return null;
  }

  if (
    !hasPermission(
      admin,
      module,
      action
    )
  ) {
    res.status(403).json({
      success: false,
      message:
        `Permission denied: ${module}:${action}`,
    });
    return null;
  }

  return admin;
}

async function writeAudit(
  req: Request,
  input: {
    adminId?: string | null;
    action: AuditAction;
    module: string;
    entityType?: string;
    entityId?: string;
    beforeData?: unknown;
    afterData?: unknown;
  }
) {
  try {
    await prisma.auditLog.create({
      data: {
        adminId:
          input.adminId ??
          getAdminUserId(req) ??
          null,
        action: input.action,
        module: input.module,
        entityType:
          input.entityType ??
          null,
        entityId:
          input.entityId ??
          null,
        beforeData:
          input.beforeData !==
          undefined
            ? (input.beforeData as any)
            : undefined,
        afterData:
          input.afterData !==
          undefined
            ? (input.afterData as any)
            : undefined,
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
  } catch (auditError) {
    console.error(
      "ADMIN AUDIT LOG ERROR:",
      auditError
    );
  }
}

function requiresConfirmation(
  req: Request,
  expected: string
) {
  return (
    String(
      req.body?.confirmation ??
        ""
    )
      .trim()
      .toUpperCase() ===
    expected.toUpperCase()
  );
}

function safeJsonValue(
  value: unknown
) {
  try {
    return JSON.parse(
      JSON.stringify(value)
    );
  } catch {
    return null;
  }
}

/* =========================================================
   ADMIN DASHBOARD
   ========================================================= */

router.get(
  "/dashboard",
  async (req, res) => {
    const admin =
      await requirePermission(
        req,
        res,
        "dashboard",
        PermissionAction.VIEW
      );

    if (!admin) return;

    try {
      const [
        customers,
        drivers,
        activeDrivers,
        bookings,
        completed,
        ongoing,
        cancelled,
        sos,
        vehicles,
        pendingKyc,
        pendingAdmins,
        openSupport,
      ] = await Promise.all([
        prisma.customer.count(),

        prisma.driver.count(),

        prisma.driver.count({
          where: {
            driverStatus:
              "ONLINE",
          },
        }),

        prisma.booking.count(),

        prisma.booking.count({
          where: {
            status:
              "COMPLETED",
          },
        }),

        prisma.booking.count({
          where: {
            status: {
              in: [
                ...ACTIVE_OPERATIONAL_BOOKING_STATUSES,
              ],
            },
          },
        }),

        prisma.booking.count({
          where: {
            status:
              "CANCELLED",
          },
        }),

        prisma.sosEvent.count({
          where: {
            status: {
              not: "CLOSED",
            },
          },
        }),

        prisma.vehicle.count(),

        prisma.driver.count({
          where: {
            verificationStatus: {
              in: [
                "PENDING",
                              "UNDER_REVIEW",
              ],
            },
          },
        }),

        prisma.adminUser.count({
          where: {
            approvalStatus:
              AdminApprovalStatus.PENDING,
          },
        }),

        prisma.supportCase.count({
          where: {
            status: {
              in: [
                "OPEN",
                "IN_PROGRESS",
              ],
            },
          },
        }),
      ]);

      return res.json({
        success: true,
        data: {
          customers,
          drivers,
          activeDrivers,
          bookings,
          completed,
          ongoing,
          cancelled,
          sos,
          vehicles,
          pendingKyc,
          pendingAdmins,
          openSupport,
        },
      });
    } catch (error) {
      console.error(
        "ADMIN DASHBOARD ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load dashboard",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   QUICK LOCATIONS
   ========================================================= */

router.get(
  "/quick-locations",
  async (req, res) => {
    const admin =
      await requirePermission(
        req,
        res,
        "operations",
        PermissionAction.VIEW
      );

    if (!admin) return;

    try {
      const data =
        await prisma.quickLocation.findMany({
          orderBy: [
            {
              category:
                "asc",
            },
            {
              name: "asc",
            },
          ],
        });

      return res.json({
        success: true,
        data,
      });
    } catch (error) {
      console.error(
        "ADMIN QUICK LOCATIONS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load quick locations",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   ALL DRIVERS
   ========================================================= */

router.get(
  "/drivers",
  async (req, res) => {
    const admin =
      await requirePermission(
        req,
        res,
        "drivers",
        PermissionAction.VIEW
      );

    if (!admin) return;

    try {
      const verificationStatus =
        typeof req.query
          .verificationStatus ===
        "string"
          ? req.query
              .verificationStatus
              .trim()
          : "";

      const driverStatus =
        typeof req.query
          .driverStatus ===
        "string"
          ? req.query
              .driverStatus
              .trim()
          : "";

      const where: any = {};

      if (verificationStatus) {
        where.verificationStatus =
          verificationStatus;
      }

      if (driverStatus) {
        where.driverStatus =
          driverStatus;
      }

      const data =
        await prisma.driver.findMany({
          where,
          orderBy: {
            createdAt:
              "desc",
          },
          include: {
            vehicles: true,
            location: true,
          },
        });

      return res.json({
        success: true,
        data,
      });
    } catch (error) {
      console.error(
        "ADMIN DRIVERS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load drivers",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   DRIVER DETAILS
   ========================================================= */

router.get(
  "/drivers/:driverId",
  async (req, res) => {
    const admin =
      await requirePermission(
        req,
        res,
        "drivers",
        PermissionAction.VIEW
      );

    if (!admin) return;

    try {
      const driverId =
        String(
          req.params.driverId ||
            ""
        ).trim();

      if (!driverId) {
        return res.status(400).json({
          success: false,
          message:
            "driverId is required",
        });
      }

      const driver =
        await prisma.driver.findUnique({
          where: {
            id: driverId,
          },
          include: {
            vehicles: true,
            location: true,
          },
        });

      if (!driver) {
        return res.status(404).json({
          success: false,
          message:
            "Driver not found",
        });
      }

      return res.json({
        success: true,
        data: driver,
      });
    } catch (error) {
      console.error(
        "ADMIN DRIVER DETAILS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load driver",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   DRIVER VERIFICATION UPDATE
   ========================================================= */

router.patch(
  "/drivers/:driverId/verification",
  async (req, res) => {
    const admin =
      await requirePermission(
        req,
        res,
        "drivers",
        PermissionAction.APPROVE
      );

    if (!admin) return;

    try {
      const driverId =
        String(
          req.params.driverId ||
            ""
        ).trim();

      const verificationStatus =
        String(
          req.body?.verificationStatus ||
            ""
        ).trim();

      if (
        !driverId ||
        !verificationStatus
      ) {
        return res.status(400).json({
          success: false,
          message:
            "driverId and verificationStatus are required",
        });
      }

      if (
        !ALLOWED_VERIFICATION_STATUSES.includes(
          verificationStatus as any
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid verificationStatus",
          allowedStatuses:
            ALLOWED_VERIFICATION_STATUSES,
        });
      }

      const existing =
        await prisma.driver.findUnique({
          where: {
            id: driverId,
          },
        });

      if (!existing) {
        return res.status(404).json({
          success: false,
          message:
            "Driver not found",
        });
      }

      const updated =
        await prisma.driver.update({
          where: {
            id: driverId,
          },
          data: {
            verificationStatus:
              verificationStatus as any,
          },
          include: {
            vehicles: true,
            location: true,
          },
        });

      await writeAudit(
        req,
        {
          adminId:
            admin.adminId,
          action:
            verificationStatus ===
            "APPROVED"
              ? AuditAction.APPROVE
              : verificationStatus ===
                "REJECTED"
              ? AuditAction.REJECT
              : AuditAction.UPDATE,
          module:
            "drivers",
          entityType:
            "Driver",
          entityId:
            driverId,
          beforeData:
            safeJsonValue({
              verificationStatus:
                existing.verificationStatus,
            }),
          afterData:
            safeJsonValue({
              verificationStatus:
                updated.verificationStatus,
            }),
        }
      );

      return res.json({
        success: true,
        message:
          "Driver verification updated",
        data: updated,
      });
    } catch (error) {
      console.error(
        "ADMIN DRIVER VERIFICATION ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to update driver verification",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   DRIVER SUSPEND / ACTIVATE
   ========================================================= */

router.patch(
  "/drivers/:driverId/status",
  async (req, res) => {
    const admin =
      await requirePermission(
        req,
        res,
        "drivers",
        PermissionAction.SUSPEND
      );

    if (!admin) return;

    try {
      const driverId =
        String(
          req.params.driverId ||
            ""
        ).trim();

      const status =
        String(
          req.body?.status ||
            ""
        ).trim();

      if (
        !driverId ||
        !status
      ) {
        return res.status(400).json({
          success: false,
          message:
            "driverId and status are required",
        });
      }

      if (
        !ALLOWED_DRIVER_STATUSES.includes(
          status as any
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid driver status",
          allowedStatuses:
            ALLOWED_DRIVER_STATUSES,
        });
      }

      if (
        status ===
          "SUSPENDED" &&
        !requiresConfirmation(
          req,
          "SUSPEND DRIVER"
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'High-risk action requires confirmation: type "SUSPEND DRIVER"',
        });
      }

      const driver =
        await prisma.driver.findUnique({
          where: {
            id: driverId,
          },
        });

      if (!driver) {
        return res.status(404).json({
          success: false,
          message:
            "Driver not found",
        });
      }

      const updated =
        await prisma.driver.update({
          where: {
            id: driverId,
          },
          data: {
            driverStatus:
              status as any,
          },
        });

      await writeAudit(
        req,
        {
          adminId:
            admin.adminId,
          action:
            status ===
            "SUSPENDED"
              ? AuditAction.SUSPEND
              : AuditAction.UPDATE,
          module:
            "drivers",
          entityType:
            "Driver",
          entityId:
            driverId,
          beforeData:
            safeJsonValue({
              driverStatus:
                driver.driverStatus,
            }),
          afterData:
            safeJsonValue({
              driverStatus:
                updated.driverStatus,
            }),
        }
      );

      return res.json({
        success: true,
        message:
          "Driver status updated",
        data: updated,
      });
    } catch (error) {
      console.error(
        "ADMIN DRIVER STATUS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to update driver status",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   ALL BOOKINGS
   ========================================================= */

router.get(
  "/bookings",
  async (req, res) => {
    const admin =
      await requirePermission(
        req,
        res,
        "bookings",
        PermissionAction.VIEW
      );

    if (!admin) return;

    try {
      const requestedStatus =
        typeof req.query.status ===
        "string"
          ? req.query.status.trim()
          : "";

      const where: any = {};

      if (requestedStatus) {
        where.status =
          requestedStatus;
      }

      const data =
        await prisma.booking.findMany({
          where,
          orderBy: {
            createdAt:
              "desc",
          },
          take: 200,
          include: {
            customer: true,
            assignedDriver: true,
            vehicle: true,
            legs: true,
          },
        });

      return res.json({
        success: true,
        data,
      });
    } catch (error) {
      console.error(
        "ADMIN BOOKINGS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load bookings",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   CUSTOMER PICKUP FOR QUICK RIDE
   ========================================================= */
router.get(
  "/customers/:customerId/latest-pickup",
  async (req, res) => {
    const admin = await requirePermission(req, res, "bookings", PermissionAction.VIEW);
    if (!admin) return;
    try {
      const customerId = String(req.params.customerId || "").trim();
      if (!customerId) return res.status(400).json({ success: false, message: "customerId is required" });
      const booking = await prisma.booking.findFirst({
        where: { customerId },
        orderBy: { createdAt: "desc" },
        select: { id: true, pickupAddress: true, pickupLat: true, pickupLng: true, dropAddress: true, dropLat: true, dropLng: true, status: true, createdAt: true },
      });
      if (!booking) return res.status(404).json({ success: false, message: "No customer booking found" });
      return res.json({ success: true, data: booking });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to load customer pickup" });
    }
  }
);

/* =========================================================
   BOOKING DETAILS
   ========================================================= */

router.get(
  "/bookings/:bookingId",
  async (req, res) => {
    const admin =
      await requirePermission(
        req,
        res,
        "bookings",
        PermissionAction.VIEW
      );

    if (!admin) return;

    try {
      const bookingId =
        String(
          req.params.bookingId ||
            ""
        ).trim();

      if (!bookingId) {
        return res.status(400).json({
          success: false,
          message:
            "bookingId is required",
        });
      }

      const booking =
        await prisma.booking.findUnique({
          where: {
            id: bookingId,
          },
          include: {
            customer: true,
            assignedDriver: true,
            vehicle: true,
            legs: true,
            rideRequests: true,
            payment: true,
            ratings: true,
          },
        });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message:
            "Booking not found",
        });
      }

      return res.json({
        success: true,
        data: booking,
      });
    } catch (error) {
      console.error(
        "ADMIN BOOKING DETAILS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load booking",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   ALL SOS EVENTS
   ========================================================= */

router.get(
  "/safety/sos",
  async (req, res) => {
    const admin =
      await requirePermission(
        req,
        res,
        "safety",
        PermissionAction.VIEW
      );

    if (!admin) return;

    try {
      const data =
        await prisma.sosEvent.findMany({
          orderBy: {
            createdAt:
              "desc",
          },
          take: 200,
          include: {
            incident: true,
            booking: {
              select: {
                id: true,
                status: true,
                pickupAddress: true,
                dropAddress: true,
              },
            },
          },
        });

      return res.json({
        success: true,
        data,
      });
    } catch (error) {
      console.error(
        "ADMIN SOS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load SOS events",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   CUSTOMER LIST
   ========================================================= */

router.get(
  "/customers",
  async (req, res) => {
    const admin =
      await requirePermission(
        req,
        res,
        "customers",
        PermissionAction.VIEW
      );

    if (!admin) return;

    try {
      const data =
        await prisma.customer.findMany({
          orderBy: {
            createdAt:
              "desc",
          },
          take: 200,
          include: {
            user: true,
          },
        });

      return res.json({
        success: true,
        data,
      });
    } catch (error) {
      console.error(
        "ADMIN CUSTOMERS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load customers",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   CUSTOMER DETAILS
   ========================================================= */

router.get(
  "/customers/:customerId",
  async (req, res) => {
    const admin =
      await requirePermission(
        req,
        res,
        "customers",
        PermissionAction.VIEW
      );

    if (!admin) return;

    try {
      const customerId =
        String(
          req.params.customerId ||
            ""
        ).trim();

      const customer =
        await prisma.customer.findUnique({
          where: {
            id: customerId,
          },
          include: {
            user: true,
            bookings: {
              orderBy: {
                createdAt:
                  "desc",
              },
              take: 50,
            },
            ratings: true,
            supportCases: true,
            sosEvents: true,
          },
        });

      if (!customer) {
        return res.status(404).json({
          success: false,
          message:
            "Customer not found",
        });
      }

      return res.json({
        success: true,
        data: customer,
      });
    } catch (error) {
      console.error(
        "ADMIN CUSTOMER DETAILS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load customer",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   ADMIN USER LIST
   ========================================================= */

router.get(
  "/admins",
  async (req, res) => {
    const admin =
      await requirePermission(
        req,
        res,
        "admins",
        PermissionAction.VIEW
      );

    if (!admin) return;

    try {
      const data =
        await prisma.adminUser.findMany({
          orderBy: {
            createdAt:
              "desc",
          },
          include: {
            role: true,
            user: {
              select: {
                id: true,
                userType: true,
                mobile: true,
                email: true,
                status: true,
              },
            },
          },
        });

      return res.json({
        success: true,
        data,
      });
    } catch (error) {
      console.error(
        "ADMIN USERS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load admin users",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   CREATE ADMIN USER
   ========================================================= */

router.post(
  "/admins",
  async (req, res) => {
    const admin =
      await requirePermission(
        req,
        res,
        "admins",
        PermissionAction.MANAGE_ADMINS
      );

    if (!admin) return;

    try {
      const mobile =
        String(
          req.body?.mobile ??
            ""
        ).trim();

      const email =
        cleanString(
          req.body?.email
        );

      const name =
        String(
          req.body?.name ??
            ""
        ).trim();

      const roleName =
        String(
          req.body?.role ??
            ""
        )
          .trim()
          .toUpperCase();

      if (
        !mobile ||
        !name ||
        !roleName
      ) {
        return res.status(400).json({
          success: false,
          message:
            "name, mobile and role are required",
        });
      }

      if (
        !ADMIN_ROLES.includes(
          roleName as any
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid admin role",
          allowedRoles:
            ADMIN_ROLES,
        });
      }

      if (
        roleName ===
          SUPER_ADMIN_ROLE &&
        !admin.isSuperAdmin
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Only Super Admin can create another Super Admin",
        });
      }

      if (
        !requiresConfirmation(
          req,
          "CREATE ADMIN"
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'High-risk action requires confirmation: type "CREATE ADMIN"',
        });
      }

      const role =
        await prisma.role.findUnique({
          where: {
            name: roleName,
          },
        });

      if (!role) {
        return res.status(404).json({
          success: false,
          message:
            `Admin role "${roleName}" is not configured yet`,
        });
      }

      const existingUser =
        await prisma.user.findUnique({
          where: {
            mobile,
          },
        });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message:
            "Mobile number is already registered",
        });
      }

      const result =
        await prisma.$transaction(
          async (tx) => {
            const user =
              await tx.user.create({
                data: {
                  mobile,
                  email,
                  userType:
                    UserType.ADMIN,
                  status:
                    "ACTIVE",
                },
              });

            const createdAdmin =
              await tx.adminUser.create({
                data: {
                  userId:
                    user.id,
                  name,
                  roleId:
                    role.id,
                  approvalStatus:
                    AdminApprovalStatus.PENDING,
                  createdByAdminId:
                    admin.adminId,
                },
                include: {
                  role: true,
                  user: true,
                },
              });

            return {
              user,
              admin:
                createdAdmin,
            };
          }
        );

      await writeAudit(
        req,
        {
          adminId:
            admin.adminId,
          action:
            AuditAction.CREATE,
          module:
            "admins",
          entityType:
            "AdminUser",
          entityId:
            result.admin.id,
          afterData:
            safeJsonValue({
              name,
              role:
                roleName,
              approvalStatus:
                AdminApprovalStatus.PENDING,
              userId:
                result.user.id,
            }),
        }
      );

      return res.status(201).json({
        success: true,
        message:
          "Admin account created and placed in Pending Approval",
        data: result.admin,
      });
    } catch (error) {
      console.error(
        "CREATE ADMIN ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to create admin",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   APPROVE ADMIN
   ========================================================= */

router.patch(
  "/admins/:adminId/approve",
  async (req, res) => {
    const admin =
      await requireAdmin(
        req,
        res
      );

    if (!admin) return;

    if (
      !admin.isSuperAdmin
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Only Super Admin can approve admin access",
      });
    }

    if (
      !requiresConfirmation(
        req,
        "APPROVE ADMIN"
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          'High-risk action requires confirmation: type "APPROVE ADMIN"',
      });
    }

    try {
      const adminId =
        String(
          req.params.adminId ||
            ""
        ).trim();

      const existing =
        await prisma.adminUser.findUnique({
          where: {
            id: adminId,
          },
          include: {
            role: true,
          },
        });

      if (!existing) {
        return res.status(404).json({
          success: false,
          message:
            "Admin not found",
        });
      }

      const updated =
        await prisma.adminUser.update({
          where: {
            id: adminId,
          },
          data: {
            approvalStatus:
              AdminApprovalStatus.APPROVED,
            approvedByAdminId:
              admin.adminId,
            approvedAt:
              new Date(),
            rejectedAt:
              null,
            suspendedAt:
              null,
          },
          include: {
            role: true,
          },
        });

      await writeAudit(
        req,
        {
          adminId:
            admin.adminId,
          action:
            AuditAction.ADMIN_APPROVAL,
          module:
            "admins",
          entityType:
            "AdminUser",
          entityId:
            adminId,
          beforeData:
            safeJsonValue({
              approvalStatus:
                existing.approvalStatus,
            }),
          afterData:
            safeJsonValue({
              approvalStatus:
                updated.approvalStatus,
              approvedByAdminId:
                updated.approvedByAdminId,
            }),
        }
      );

      return res.json({
        success: true,
        message:
          "Admin approved successfully",
        data: updated,
      });
    } catch (error) {
      console.error(
        "APPROVE ADMIN ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to approve admin",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   REJECT ADMIN
   ========================================================= */

router.patch(
  "/admins/:adminId/reject",
  async (req, res) => {
    const admin =
      await requireAdmin(
        req,
        res
      );

    if (!admin) return;

    if (
      !admin.isSuperAdmin
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Only Super Admin can reject admin access",
      });
    }

    if (
      !requiresConfirmation(
        req,
        "REJECT ADMIN"
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          'High-risk action requires confirmation: type "REJECT ADMIN"',
      });
    }

    try {
      const adminId =
        String(
          req.params.adminId ||
            ""
        ).trim();

      const existing =
        await prisma.adminUser.findUnique({
          where: {
            id: adminId,
          },
        });

      if (!existing) {
        return res.status(404).json({
          success: false,
          message:
            "Admin not found",
        });
      }

      const updated =
        await prisma.adminUser.update({
          where: {
            id: adminId,
          },
          data: {
            approvalStatus:
              AdminApprovalStatus.REJECTED,
            rejectedAt:
              new Date(),
          },
        });

      await writeAudit(
        req,
        {
          adminId:
            admin.adminId,
          action:
            AuditAction.REJECT,
          module:
            "admins",
          entityType:
            "AdminUser",
          entityId:
            adminId,
          beforeData:
            safeJsonValue({
              approvalStatus:
                existing.approvalStatus,
            }),
          afterData:
            safeJsonValue({
              approvalStatus:
                updated.approvalStatus,
            }),
        }
      );

      return res.json({
        success: true,
        message:
          "Admin rejected",
        data: updated,
      });
    } catch (error) {
      console.error(
        "REJECT ADMIN ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to reject admin",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   SUSPEND ADMIN
   ========================================================= */

router.patch(
  "/admins/:adminId/suspend",
  async (req, res) => {
    const admin =
      await requireAdmin(
        req,
        res
      );

    if (!admin) return;

    if (
      !hasPermission(
        admin,
        "admins",
        PermissionAction.SUSPEND
      )
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Permission denied: admins:SUSPEND",
      });
    }

    if (
      !requiresConfirmation(
        req,
        "SUSPEND ADMIN"
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          'High-risk action requires confirmation: type "SUSPEND ADMIN"',
      });
    }

    try {
      const adminId =
        String(
          req.params.adminId ||
            ""
        ).trim();

      const existing =
        await prisma.adminUser.findUnique({
          where: {
            id: adminId,
          },
        });

      if (!existing) {
        return res.status(404).json({
          success: false,
          message:
            "Admin not found",
        });
      }

      if (
        existing.id ===
        admin.adminId
      ) {
        return res.status(400).json({
          success: false,
          message:
            "An admin cannot suspend their own account",
        });
      }

      const updated =
        await prisma.adminUser.update({
          where: {
            id: adminId,
          },
          data: {
            approvalStatus:
              AdminApprovalStatus.SUSPENDED,
            suspendedAt:
              new Date(),
          },
        });

      await writeAudit(
        req,
        {
          adminId:
            admin.adminId,
          action:
            AuditAction.SUSPEND,
          module:
            "admins",
          entityType:
            "AdminUser",
          entityId:
            adminId,
          beforeData:
            safeJsonValue({
              approvalStatus:
                existing.approvalStatus,
            }),
          afterData:
            safeJsonValue({
              approvalStatus:
                updated.approvalStatus,
            }),
        }
      );

      return res.json({
        success: true,
        message:
          "Admin suspended",
        data: updated,
      });
    } catch (error) {
      console.error(
        "SUSPEND ADMIN ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to suspend admin",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   REACTIVATE ADMIN
   ========================================================= */

router.patch(
  "/admins/:adminId/reactivate",
  async (req, res) => {
    const admin =
      await requireAdmin(
        req,
        res
      );

    if (!admin) return;

    if (
      !hasPermission(
        admin,
        "admins",
        PermissionAction.SUSPEND
      )
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Permission denied: admins:SUSPEND",
      });
    }

    try {
      const adminId =
        String(
          req.params.adminId ||
            ""
        ).trim();

      const existing =
        await prisma.adminUser.findUnique({
          where: {
            id: adminId,
          },
        });

      if (!existing) {
        return res.status(404).json({
          success: false,
          message:
            "Admin not found",
        });
      }

      const updated =
        await prisma.adminUser.update({
          where: {
            id: adminId,
          },
          data: {
            approvalStatus:
              AdminApprovalStatus.APPROVED,
            suspendedAt:
              null,
          },
        });

      await writeAudit(
        req,
        {
          adminId:
            admin.adminId,
          action:
            AuditAction.UPDATE,
          module:
            "admins",
          entityType:
            "AdminUser",
          entityId:
            adminId,
          beforeData:
            safeJsonValue({
              approvalStatus:
                existing.approvalStatus,
            }),
          afterData:
            safeJsonValue({
              approvalStatus:
                updated.approvalStatus,
            }),
        }
      );

      return res.json({
        success: true,
        message:
          "Admin reactivated",
        data: updated,
      });
    } catch (error) {
      console.error(
        "REACTIVATE ADMIN ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to reactivate admin",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   ROLES
   ========================================================= */

router.get(
  "/roles",
  async (req, res) => {
    const admin =
      await requirePermission(
        req,
        res,
        "admins",
        PermissionAction.VIEW
      );

    if (!admin) return;

    try {
      const roles =
        await prisma.role.findMany({
          orderBy: {
            name:
              "asc",
          },
          include: {
            admins: {
              select: {
                id: true,
                name: true,
                approvalStatus:
                  true,
              },
            },
            permissionLinks: {
              include: {
                permission: true,
              },
            },
          },
        });

      return res.json({
        success: true,
        data: roles,
      });
    } catch (error) {
      console.error(
        "ADMIN ROLES ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load roles",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   PERMISSIONS
   ========================================================= */

router.get(
  "/permissions",
  async (req, res) => {
    const admin =
      await requirePermission(
        req,
        res,
        "admins",
        PermissionAction.VIEW
      );

    if (!admin) return;

    try {
      const permissions =
        await prisma.permission.findMany({
          orderBy: [
            {
              module:
                "asc",
            },
            {
              action:
                "asc",
            },
          ],
        });

      return res.json({
        success: true,
        data: permissions,
      });
    } catch (error) {
      console.error(
        "ADMIN PERMISSIONS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load permissions",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   ROLE PERMISSION ASSIGNMENT
   ========================================================= */

router.post(
  "/roles/:roleId/permissions",
  async (req, res) => {
    const admin =
      await requirePermission(
        req,
        res,
        "admins",
        PermissionAction.MANAGE_PERMISSIONS
      );

    if (!admin) return;

    if (
      !requiresConfirmation(
        req,
        "CHANGE PERMISSIONS"
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          'High-risk action requires confirmation: type "CHANGE PERMISSIONS"',
      });
    }

    try {
      const roleId =
        String(
          req.params.roleId ||
            ""
        ).trim();

      const permissionIds =
        Array.isArray(
          req.body?.permissionIds
        )
          ? req.body.permissionIds
              .map(
                (value: unknown) =>
                  String(
                    value
                  ).trim()
              )
              .filter(
                Boolean
              )
          : [];

      if (
        !roleId ||
        permissionIds.length ===
          0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "roleId and permissionIds are required",
        });
      }

      const role =
        await prisma.role.findUnique({
          where: {
            id: roleId,
          },
          include: {
            permissionLinks: {
              include: {
                permission:
                  true,
              },
            },
          },
        });

      if (!role) {
        return res.status(404).json({
          success: false,
          message:
            "Role not found",
        });
      }

      if (
        role.isSystem &&
        !admin.isSuperAdmin
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Only Super Admin can modify system-role permissions",
        });
      }

      const permissions =
        await prisma.permission.findMany({
          where: {
            id: {
              in: permissionIds,
            },
          },
        });

      if (
        permissions.length !==
        permissionIds.length
      ) {
        return res.status(400).json({
          success: false,
          message:
            "One or more permission IDs are invalid",
        });
      }

      const before =
        role.permissionLinks.map(
          (link) => ({
            id:
              link.permission.id,
            module:
              link.permission
                .module,
            action:
              link.permission
                .action,
          })
        );

      const result =
        await prisma.$transaction(
          async (tx) => {
            await tx.rolePermission.deleteMany(
              {
                where: {
                  roleId,
                },
              }
            );

            await tx.rolePermission.createMany(
              {
                data:
                  permissionIds.map((permissionId: string) => ({
                    roleId,
                    permissionId,
                  })),
                skipDuplicates:
                  true,
              }
            );

            return tx.role.findUnique({
              where: {
                id: roleId,
              },
              include: {
                permissionLinks: {
                  include: {
                    permission:
                      true,
                  },
                },
              },
            });
          }
        );

      await writeAudit(
        req,
        {
          adminId:
            admin.adminId,
          action:
            AuditAction.PERMISSION_CHANGE,
          module:
            "admins",
          entityType:
            "Role",
          entityId:
            roleId,
          beforeData:
            safeJsonValue(
              before
            ),
          afterData:
            safeJsonValue(
              result?.permissionLinks
                .map(
                  (link) => ({
                    id:
                      link.permission
                        .id,
                    module:
                      link.permission
                        .module,
                    action:
                      link.permission
                        .action,
                  })
                )
            ),
        }
      );

      return res.json({
        success: true,
        message:
          "Role permissions updated",
        data: result,
      });
    } catch (error) {
      console.error(
        "ROLE PERMISSION UPDATE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to update role permissions",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   AUDIT LOGS
   ========================================================= */

router.get(
  "/audit-logs",
  async (req, res) => {
    const admin =
      await requirePermission(
        req,
        res,
        "security",
        PermissionAction.VIEW
      );

    if (!admin) return;

    try {
      const moduleFilter =
        typeof req.query.module ===
        "string"
          ? req.query.module.trim()
          : "";

      const entityType =
        typeof req.query.entityType ===
        "string"
          ? req.query.entityType.trim()
          : "";

      const entityId =
        typeof req.query.entityId ===
        "string"
          ? req.query.entityId.trim()
          : "";

      const data =
        await prisma.auditLog.findMany({
          where: {
            ...(moduleFilter
              ? {
                  module:
                    moduleFilter,
                }
              : {}),
            ...(entityType
              ? {
                  entityType:
                    entityType,
                }
              : {}),
            ...(entityId
              ? {
                  entityId:
                    entityId,
                }
              : {}),
          },
          orderBy: {
            createdAt:
              "desc",
          },
          take: 300,
          include: {
            admin: {
              select: {
                id: true,
                name: true,
                role: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        });

      return res.json({
        success: true,
        data,
      });
    } catch (error) {
      console.error(
        "ADMIN AUDIT LOGS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load audit logs",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   TEST ONLY:
   SETUP PICKUP TRUCK DRIVER
   ========================================================= */

router.post(
  "/setup-test-pickup",
  async (req, res) => {
    if (String(process.env.RIDEX_TEST_MODE).toLowerCase() !== "true") {
      return res.status(404).json({ success: false, message: "Test endpoint is disabled" });
    }
    const admin =
      await requirePermission(
        req,
        res,
        "operations",
        PermissionAction.CONFIGURE
      );

    if (!admin) return;

    if (
      !requiresConfirmation(
        req,
        "SETUP TEST PICKUP"
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Test setup requires confirmation: type "SETUP TEST PICKUP"',
      });
    }

    try {
      const pickupUserId =
        "test-pickup-user";

      const pickupDriverId =
        "test-pickup";

      const pickupVehicleId =
        "test-pickup-vehicle";

      const pickupLocationId =
        "test-pickup-location";

      const pickupMobile =
        "9999999001";

      const mobileUser =
        await prisma.user.findUnique({
          where: {
            mobile:
              pickupMobile,
          },
        });

      if (
        mobileUser &&
        mobileUser.id !==
          pickupUserId
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Test mobile ${pickupMobile} is already used by another user: ${mobileUser.id}`,
        });
      }

      const user =
        await prisma.user.upsert({
          where: {
            id:
              pickupUserId,
          },
          update: {
            userType:
              UserType.DRIVER,
            mobile:
              pickupMobile,
            status:
              "ACTIVE",
          },
          create: {
            id:
              pickupUserId,
            userType:
              UserType.DRIVER,
            mobile:
              pickupMobile,
            status:
              "ACTIVE",
          },
        });

      const driver =
        await prisma.driver.upsert({
          where: {
            id:
              pickupDriverId,
          },
          update: {
            userId:
              user.id,
            fullName:
              "RideX Pickup Driver",
            verificationStatus:
              "APPROVED",
            driverStatus:
              "ONLINE",
            dailyServiceMode:
              "GOODS",
          },
          create: {
            id:
              pickupDriverId,
            userId:
              user.id,
            fullName:
              "RideX Pickup Driver",
            verificationStatus:
              "APPROVED",
            driverStatus:
              "ONLINE",
            dailyServiceMode:
              "GOODS",
            rating: 5,
            totalRides: 0,
          },
        });

      const vehicle =
        await prisma.vehicle.upsert({
          where: {
            id:
              pickupVehicleId,
          },
          update: {
            driverId:
              driver.id,
            vehicleType:
              "PICKUP_TRUCK",
            vehicleNumber:
              "BR11PICKUP01",
            capacity:
              1000,
            goodsEligible:
              true,
            status:
              "ACTIVE",
          },
          create: {
            id:
              pickupVehicleId,
            driverId:
              driver.id,
            vehicleType:
              "PICKUP_TRUCK",
            vehicleNumber:
              "BR11PICKUP01",
            capacity:
              1000,
            goodsEligible:
              true,
            status:
              "ACTIVE",
          },
        });

      const now =
        new Date();

      const location =
        await prisma.driverLocation.upsert({
          where: {
            driverId:
              driver.id,
          },
          update: {
            latitude:
              25.5392,
            longitude:
              87.5717,
            isOnline:
              true,
            recordedAt:
              now,
          },
          create: {
            id:
              pickupLocationId,
            driverId:
              driver.id,
            latitude:
              25.5392,
            longitude:
              87.5717,
            isOnline:
              true,
            recordedAt:
              now,
          },
        });

      await writeAudit(
        req,
        {
          adminId:
            admin.adminId,
          action:
            AuditAction.CONFIG_CHANGE,
          module:
            "operations",
          entityType:
            "TestDriver",
          entityId:
            pickupDriverId,
          afterData:
            safeJsonValue({
              userId:
                user.id,
              driverId:
                driver.id,
              vehicleId:
                vehicle.id,
            }),
        }
      );

      return res.json({
        success: true,
        message:
          "Pickup Truck test driver setup successfully",
        data: {
          user,
          driver,
          vehicle,
          location,
        },
      });
    } catch (error) {
      console.error(
        "SETUP TEST PICKUP ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to setup Pickup Truck test driver",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);


/* =========================================================
   TEST ONLY:
   SETUP PASSENGER E-RICKSHAW DRIVER
   ========================================================= */
router.post(
  "/setup-test-passenger",
  async (req, res) => {
    if (String(process.env.RIDEX_TEST_MODE).toLowerCase() !== "true") {
      return res.status(404).json({ success: false, message: "Test endpoint is disabled" });
    }
    const admin =
      await requirePermission(
        req,
        res,
        "operations",
        PermissionAction.CONFIGURE
      );

    if (!admin) return;

    if (
      !requiresConfirmation(
        req,
        "SETUP TEST PASSENGER"
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Test setup requires confirmation: type "SETUP TEST PASSENGER"',
      });
    }

    try {
      const passengerUserId =
        "test-passenger-user";

      const passengerDriverId =
        "test-passenger";

      const passengerVehicleId =
        "test-passenger-vehicle";

      const passengerLocationId =
        "test-passenger-location";

      const passengerMobile =
        "9999999002";

      const mobileUser =
        await prisma.user.findUnique({
          where: {
            mobile:
              passengerMobile,
          },
        });

      if (
        mobileUser &&
        mobileUser.id !==
          passengerUserId
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Test mobile ${passengerMobile} is already used by another user: ${mobileUser.id}`,
        });
      }

      const user =
        await prisma.user.upsert({
          where: {
            id:
              passengerUserId,
          },
          update: {
            userType:
              UserType.DRIVER,
            mobile:
              passengerMobile,
            status:
              "ACTIVE",
          },
          create: {
            id:
              passengerUserId,
            userType:
              UserType.DRIVER,
            mobile:
              passengerMobile,
            status:
              "ACTIVE",
          },
        });

      const driver =
        await prisma.driver.upsert({
          where: {
            id:
              passengerDriverId,
          },
          update: {
            userId:
              user.id,
            fullName:
              "RideX Passenger E-Rickshaw Driver",
            verificationStatus:
              "APPROVED",
            driverStatus:
              "ONLINE",
            /*
             * Intentionally GOODS mode so the E-Rickshaw
             * passenger capability rule is exercised:
             * Passenger Ride + E-Rickshaw + GOODS mode => MATCH.
             */
            dailyServiceMode:
              "GOODS",
          },
          create: {
            id:
              passengerDriverId,
            userId:
              user.id,
            fullName:
              "RideX Passenger E-Rickshaw Driver",
            verificationStatus:
              "APPROVED",
            driverStatus:
              "ONLINE",
            dailyServiceMode:
              "GOODS",
            rating: 5,
            totalRides: 0,
          },
        });

      const vehicle =
        await prisma.vehicle.upsert({
          where: {
            id:
              passengerVehicleId,
          },
          update: {
            driverId:
              driver.id,
            vehicleType:
              "E_RICKSHAW",
            vehicleNumber:
              "BR11ERICK01",
            capacity:
              4,
            goodsEligible:
              true,
            status:
              "ACTIVE",
          },
          create: {
            id:
              passengerVehicleId,
            driverId:
              driver.id,
            vehicleType:
              "E_RICKSHAW",
            vehicleNumber:
              "BR11ERICK01",
            capacity:
              4,
            goodsEligible:
              true,
            status:
              "ACTIVE",
          },
        });

      const now =
        new Date();

      const location =
        await prisma.driverLocation.upsert({
          where: {
            driverId:
              driver.id,
          },
          update: {
            latitude:
              25.5392,
            longitude:
              87.5717,
            isOnline:
              true,
            recordedAt:
              now,
          },
          create: {
            id:
              passengerLocationId,
            driverId:
              driver.id,
            latitude:
              25.5392,
            longitude:
              87.5717,
            isOnline:
              true,
            recordedAt:
              now,
          },
        });

      await writeAudit(
        req,
        {
          adminId:
            admin.adminId,
          action:
            AuditAction.CONFIG_CHANGE,
          module:
            "operations",
          entityType:
            "TestDriver",
          entityId:
            passengerDriverId,
          afterData:
            safeJsonValue({
              userId:
                user.id,
              driverId:
                driver.id,
              vehicleId:
                vehicle.id,
            }),
        }
      );

      return res.json({
        success: true,
        message:
          "Passenger E-Rickshaw test driver setup successfully",
        data: {
          user,
          driver,
          vehicle,
          location,
        },
      });
    } catch (error) {
      console.error(
        "SETUP TEST PASSENGER ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to setup Passenger E-Rickshaw test driver",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   PAYMENTS / SETTLEMENT DATA
   ========================================================= */
router.get('/payments', async (req, res) => {
  const admin = await requirePermission(req, res, 'payments', PermissionAction.VIEW);
  if (!admin) return;
  try {
    const status = cleanString(req.query.status);
    const rows = await prisma.payment.findMany({
      where: status ? { status: status as any } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { booking: { select: { id: true, status: true, customerId: true, assignedDriverId: true } }, customer: { select: { id: true, user: { select: { mobile: true } } } }, refunds: true },
    });
    return res.json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to load payments', error: error instanceof Error ? error.message : String(error) });
  }
});

/* =========================================================
   COUPON / PROMOTION MANAGEMENT
   ========================================================= */
router.get('/promotions', async (req, res) => {
  const admin = await requirePermission(req, res, 'promotions', PermissionAction.VIEW);
  if (!admin) return;
  try {
    const rows = await prisma.coupon.findMany({ orderBy: { createdAt: 'desc' }, take: 300, include: { usages: { select: { id: true } } } });
    return res.json({ success: true, data: rows.map((row) => ({ ...row, usageCount: row.usages.length })) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to load promotions', error: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/promotions', async (req, res) => {
  const admin = await requirePermission(req, res, 'promotions', PermissionAction.CREATE);
  if (!admin) return;
  try {
    const code = String(req.body?.code ?? '').trim().toUpperCase();
    const description = cleanString(req.body?.description);
    const discountType = String(req.body?.discountType ?? 'FIXED').toUpperCase();
    const discountValue = Number(req.body?.discountValue);
    const maxDiscount = req.body?.maxDiscount === '' || req.body?.maxDiscount == null ? null : Number(req.body.maxDiscount);
    const minFare = req.body?.minFare === '' || req.body?.minFare == null ? null : Number(req.body.minFare);
    const validFrom = new Date(String(req.body?.validFrom ?? ''));
    const validUntil = new Date(String(req.body?.validUntil ?? ''));
    const rideScope = String(req.body?.rideScope ?? 'ALL').toUpperCase();
    if (!code || !['FIXED','PERCENTAGE'].includes(discountType) || !Number.isFinite(discountValue) || discountValue <= 0 || Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime()) || validUntil <= validFrom) {
      return res.status(400).json({ success: false, message: 'Invalid promotion payload' });
    }
    const row = await prisma.coupon.create({ data: { code, description, discountType: discountType as any, discountValue, maxDiscount: Number.isFinite(maxDiscount) ? maxDiscount : null, minFare: Number.isFinite(minFare) ? minFare : null, validFrom, validUntil, rideScope: rideScope as any, isActive: true } });
    await writeAudit(req, { adminId: admin.adminId, action: AuditAction.CREATE, module: 'promotions', entityType: 'Coupon', entityId: row.id, afterData: safeJsonValue(row) });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    return res.status(400).json({ success: false, message: 'Unable to create promotion', error: error instanceof Error ? error.message : String(error) });
  }
});

router.patch('/promotions/:promotionId', async (req, res) => {
  const admin = await requirePermission(req, res, 'promotions', PermissionAction.EDIT);
  if (!admin) return;
  try {
    const id = String(req.params.promotionId ?? '').trim();
    const before = await prisma.coupon.findUnique({ where: { id } });
    if (!before) return res.status(404).json({ success: false, message: 'Promotion not found' });
    const data: any = {};
    if (req.body?.isActive !== undefined) data.isActive = Boolean(req.body.isActive);
    if (req.body?.description !== undefined) data.description = cleanString(req.body.description);
    const row = await prisma.coupon.update({ where: { id }, data });
    await writeAudit(req, { adminId: admin.adminId, action: AuditAction.UPDATE, module: 'promotions', entityType: 'Coupon', entityId: id, beforeData: safeJsonValue(before), afterData: safeJsonValue(row) });
    return res.json({ success: true, data: row });
  } catch (error) {
    return res.status(400).json({ success: false, message: 'Unable to update promotion', error: error instanceof Error ? error.message : String(error) });
  }
});

/* =========================================================
   SUPPORT OPERATIONS
   ========================================================= */
router.get('/support/cases', async (req, res) => {
  const admin = await requirePermission(req, res, 'support', PermissionAction.VIEW);
  if (!admin) return;
  try {
    const status = cleanString(req.query.status);
    const rows = await prisma.supportCase.findMany({ where: status ? { status: status as any } : undefined, orderBy: { updatedAt: 'desc' }, take: 500, include: { customer: { select: { id: true, fullName: true, user: { select: { mobile: true } } } }, driver: { select: { id: true, fullName: true, user: { select: { mobile: true } } } }, booking: { select: { id: true, status: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 3 } } });
    return res.json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to load support cases', error: error instanceof Error ? error.message : String(error) });
  }
});

router.patch('/support/cases/:caseId', async (req, res) => {
  const admin = await requirePermission(req, res, 'support', PermissionAction.EDIT);
  if (!admin) return;
  try {
    const id = String(req.params.caseId ?? '').trim();
    const before = await prisma.supportCase.findUnique({ where: { id } });
    if (!before) return res.status(404).json({ success: false, message: 'Support case not found' });
    const data: any = {};
    if (req.body?.status !== undefined) data.status = String(req.body.status).toUpperCase() as any;
    if (req.body?.priority !== undefined) data.priority = String(req.body.priority).toUpperCase() as any;
    if (req.body?.assignedAdminId !== undefined) data.assignedAdminId = cleanString(req.body.assignedAdminId);
    const row = await prisma.supportCase.update({ where: { id }, data });
    await writeAudit(req, { adminId: admin.adminId, action: AuditAction.UPDATE, module: 'support', entityType: 'SupportCase', entityId: id, beforeData: safeJsonValue(before), afterData: safeJsonValue(row) });
    return res.json({ success: true, data: row });
  } catch (error) {
    return res.status(400).json({ success: false, message: 'Unable to update support case', error: error instanceof Error ? error.message : String(error) });
  }
});

/* =========================================================
   OPERATIONAL NOTIFICATION BROADCAST (IN-APP)
   ========================================================= */
router.post('/notifications/broadcast', async (req, res) => {
  const admin = await requirePermission(req, res, 'notifications', PermissionAction.CREATE);
  if (!admin) return;
  try {
    const audience = String(req.body?.audience ?? 'ALL').toUpperCase();
    const title = String(req.body?.title ?? '').trim();
    const body = String(req.body?.body ?? '').trim();
    if (!title || !body || !['ALL','CUSTOMERS','DRIVERS'].includes(audience)) return res.status(400).json({ success: false, message: 'audience, title and body are required' });
    const users = await prisma.user.findMany({ where: audience === 'CUSTOMERS' ? { userType: UserType.CUSTOMER, status: 'ACTIVE' } : audience === 'DRIVERS' ? { userType: UserType.DRIVER, status: 'ACTIVE' } : { status: 'ACTIVE' }, select: { id: true } });
    const result = await prisma.notification.createMany({ data: users.map((u) => ({ userId: u.id, channel: 'IN_APP', title, body, sentAt: new Date() })) });
    await writeAudit(req, { adminId: admin.adminId, action: AuditAction.CREATE, module: 'notifications', entityType: 'Broadcast', afterData: safeJsonValue({ audience, title, count: result.count }) });
    return res.json({ success: true, data: { audience, count: result.count } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to send notification broadcast', error: error instanceof Error ? error.message : String(error) });
  }
});


/* =========================================================
   RIDEX v3.5 TEST DATA LAB
   ========================================================= */

function requireTestMode(res: any) {
  if (process.env.RIDEX_TEST_MODE !== "true") {
    res.status(404).json({ success: false, message: "Test data is disabled" });
    return false;
  }
  return true;
}

router.get("/test-data/records", async (req, res) => {
  if (!requireTestMode(res)) return;
  const admin = await requirePermission(req, res, "operations", PermissionAction.VIEW);
  if (!admin) return;
  try {
    return res.json({ success: true, data: await getRideXTestDataRecords() });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to load test data records", error: error instanceof Error ? error.message : String(error) });
  }
});

router.get("/test-data/summary", async (req, res) => {
  if (!requireTestMode(res)) return;
  const admin = await requirePermission(req, res, "operations", PermissionAction.VIEW);
  if (!admin) return;
  try {
    return res.json({ success: true, data: await getRideXTestDataSummary() });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to load test data summary", error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/test-data/seed", async (req, res) => {
  if (!requireTestMode(res)) return;
  const admin = await requirePermission(req, res, "operations", PermissionAction.CONFIGURE);
  if (!admin) return;
  if (!requiresConfirmation(req, "SEED RIDEX V3.5 TEST DATA")) {
    return res.status(400).json({ success: false, message: 'Test data seeding requires confirmation: type "SEED RIDEX V3.5 TEST DATA"' });
  }
  try {
    const result = await seedRideXTestData();
    return res.json({ success: true, message: result.message, data: await getRideXTestDataSummary() });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to seed test data", error: error instanceof Error ? error.message : String(error) });
  }
});

router.delete("/test-data", async (req, res) => {
  if (!requireTestMode(res)) return;
  const admin = await requirePermission(req, res, "operations", PermissionAction.CONFIGURE);
  if (!admin) return;
  if (!requiresConfirmation(req, "DELETE RIDEX V3.5 TEST DATA")) {
    return res.status(400).json({ success: false, message: 'Test data deletion requires confirmation: type "DELETE RIDEX V3.5 TEST DATA"' });
  }
  try {
    const result = await resetRideXTestData();
    return res.json({ success: true, message: result.message, data: await getRideXTestDataSummary() });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to delete test data", error: error instanceof Error ? error.message : String(error) });
  }
});

router.patch("/test-data/:entity/:id", async (req, res) => {
  if (!requireTestMode(res)) return;
  const admin = await requirePermission(req, res, "operations", PermissionAction.EDIT);
  if (!admin) return;
  const entity = String(req.params.entity ?? "").toLowerCase();
  const id = String(req.params.id ?? "").trim();
  if (!id.startsWith("v35-test-")) return res.status(403).json({ success: false, message: "Only v3.5 test records can be edited" });

  const allowed: Record<string, string[]> = {
    customers: ["fullName", "photoUrl", "rating"],
    drivers: ["fullName", "verificationStatus", "driverStatus", "dailyServiceMode", "rating"],
    vehicles: ["vehicleType", "vehicleNumber", "capacity", "goodsEligible", "status"],
    bookings: ["status", "pickupAddress", "dropAddress", "estimatedFare", "finalFare", "specialInstructions"],
    "quick-locations": ["name", "category", "address", "city", "latitude", "longitude", "active"],
    promotions: ["description", "isActive", "discountValue", "maxDiscount", "minFare"],
    support: ["subject", "description", "status", "priority"],
    notifications: ["title", "body", "channel", "readAt", "sentAt"],
  };
  if (!allowed[entity]) return res.status(400).json({ success: false, message: "Unsupported test-data entity" });
  const data: Record<string, unknown> = {};
  for (const key of allowed[entity]) if (req.body?.[key] !== undefined) data[key] = req.body[key];
  if (!Object.keys(data).length) return res.status(400).json({ success: false, message: "No editable fields supplied" });

  try {
    let row: unknown;
    if (entity === "customers") row = await prisma.customer.update({ where: { id }, data: data as any });
    else if (entity === "drivers") row = await prisma.driver.update({ where: { id }, data: data as any });
    else if (entity === "vehicles") row = await prisma.vehicle.update({ where: { id }, data: data as any });
    else if (entity === "bookings") row = await prisma.booking.update({ where: { id }, data: data as any });
    else if (entity === "quick-locations") row = await prisma.quickLocation.update({ where: { id }, data: data as any });
    else if (entity === "promotions") row = await prisma.coupon.update({ where: { id }, data: data as any });
    else if (entity === "support") row = await prisma.supportCase.update({ where: { id }, data: data as any });
    else row = await prisma.notification.update({ where: { id }, data: data as any });
    await writeAudit(req, { adminId: admin.adminId, action: AuditAction.UPDATE, module: "test-data", entityType: entity, entityId: id, afterData: safeJsonValue(row) });
    return res.json({ success: true, data: row });
  } catch (error) {
    return res.status(404).json({ success: false, message: "Test record not found or update failed", error: error instanceof Error ? error.message : String(error) });
  }
});

async function deleteTestEntity(entity: string, id: string) {
  switch (entity) {
    case "notifications": return prisma.notification.delete({ where: { id } });
    case "quick-locations": return prisma.quickLocation.delete({ where: { id } });
    case "support":
      await prisma.supportMessage.deleteMany({ where: { caseId: id } });
      return prisma.supportCase.delete({ where: { id } });
    case "promotions":
      await prisma.couponUsage.deleteMany({ where: { couponId: id } });
      return prisma.coupon.delete({ where: { id } });
    case "vehicles":
      await prisma.rideRequest.deleteMany({ where: { vehicleId: id } });
      await prisma.bookingLeg.updateMany({ where: { vehicleId: id }, data: { vehicleId: null } });
      await prisma.booking.updateMany({ where: { vehicleId: id }, data: { vehicleId: null } });
      return prisma.vehicle.delete({ where: { id } });
    case "bookings":
      await prisma.supportMessage.deleteMany({ where: { supportCase: { bookingId: id } } });
      await prisma.supportCase.deleteMany({ where: { bookingId: id } });
      const sosRows = await prisma.sosEvent.findMany({ where: { bookingId: id }, select: { id: true } });
      for (const sos of sosRows) {
        const incidentRows = await prisma.safetyIncident.findMany({ where: { sosEventId: sos.id }, select: { id: true } });
        for (const incident of incidentRows) await prisma.incidentAction.deleteMany({ where: { incidentId: incident.id } });
        await prisma.safetyIncident.deleteMany({ where: { sosEventId: sos.id } });
      }
      await prisma.routeDeviationEvent.deleteMany({ where: { bookingId: id } });
      await prisma.sosEvent.deleteMany({ where: { bookingId: id } });
      await prisma.couponUsage.deleteMany({ where: { bookingId: id } });
      await prisma.rating.deleteMany({ where: { bookingId: id } });
      await prisma.refund.deleteMany({ where: { bookingId: id } });
      await prisma.paymentTransaction.deleteMany({ where: { bookingId: id } });
      await prisma.paymentAttempt.deleteMany({ where: { bookingId: id } });
      await prisma.cashCollection.deleteMany({ where: { bookingId: id } });
      await prisma.financialAdjustment.deleteMany({ where: { bookingId: id } });
      await prisma.commissionEntry.deleteMany({ where: { bookingId: id } });
      await prisma.ledgerEntry.deleteMany({ where: { bookingId: id } });
      await prisma.driverEarning.deleteMany({ where: { bookingId: id } });
      await prisma.tripPassenger.deleteMany({ where: { bookingId: id } });
      await prisma.rideRequest.deleteMany({ where: { bookingId: id } });
      await prisma.route.deleteMany({ where: { bookingId: id } });
      const legs = await prisma.bookingLeg.findMany({ where: { bookingId: id }, select: { id: true, tripId: true } });
      for (const leg of legs) if (leg.tripId) await prisma.tripLocationEvent.deleteMany({ where: { tripId: leg.tripId } });
      await prisma.bookingLeg.deleteMany({ where: { bookingId: id } });
      for (const leg of legs) if (leg.tripId) await prisma.trip.deleteMany({ where: { id: leg.tripId } });
      await prisma.payment.deleteMany({ where: { bookingId: id } });
      return prisma.booking.delete({ where: { id } });
    case "customers":
      const customer = await prisma.customer.findUnique({
        where: { id },
        select: { userId: true },
      });
      if (!customer) throw new Error("Customer not found");
      await prisma.customerGalleryPhoto.deleteMany({ where: { customerId: id } });
      await prisma.emergencyContact.deleteMany({ where: { customerId: id } });
      await prisma.notification.deleteMany({ where: { user: { customer: { id } } } });
      const customerSupportCases = await prisma.supportCase.findMany({ where: { customerId: id, id: { startsWith: "v35-test-" } }, select: { id: true } });
      for (const supportCase of customerSupportCases) await prisma.supportMessage.deleteMany({ where: { caseId: supportCase.id } });
      await prisma.supportCase.deleteMany({ where: { customerId: id, id: { startsWith: "v35-test-" } } });
      await prisma.rating.deleteMany({ where: { customerId: id, id: { startsWith: "v35-test-" } } });
      const customerBookings = await prisma.booking.findMany({ where: { customerId: id, id: { startsWith: "v35-test-" } }, select: { id: true } });
      for (const booking of customerBookings) await deleteTestEntity("bookings", booking.id);
      await prisma.customer.delete({ where: { id } });
      return prisma.user.delete({ where: { id: customer.userId } });
    case "drivers":
      await prisma.rideRequest.deleteMany({ where: { driverId: id } });
      await prisma.driverLocation.deleteMany({ where: { driverId: id } });
      await prisma.driverDocument.deleteMany({ where: { driverId: id } });
      await prisma.driverEarning.deleteMany({ where: { driverId: id } });
      await prisma.driverSettlement.deleteMany({ where: { driverId: id } });
      await prisma.commissionEntry.deleteMany({ where: { driverId: id } });
      await prisma.cashCollection.deleteMany({ where: { driverId: id } });
      await prisma.ledgerEntry.deleteMany({ where: { driverId: id } });
      await prisma.financialAdjustment.deleteMany({ where: { driverId: id } });
      await prisma.rating.deleteMany({ where: { driverId: id } });
      const driverSosRows = await prisma.sosEvent.findMany({ where: { driverId: id }, select: { id: true } });
      for (const sos of driverSosRows) {
        const driverIncidentRows = await prisma.safetyIncident.findMany({ where: { sosEventId: sos.id }, select: { id: true } });
        for (const incident of driverIncidentRows) await prisma.incidentAction.deleteMany({ where: { incidentId: incident.id } });
        await prisma.safetyIncident.deleteMany({ where: { sosEventId: sos.id } });
      }
      await prisma.safetyIncident.deleteMany({ where: { driverId: id } });
      await prisma.sosEvent.deleteMany({ where: { driverId: id } });
      await prisma.supportMessage.deleteMany({ where: { supportCase: { driverId: id } } });
      await prisma.supportCase.deleteMany({ where: { driverId: id } });
      await prisma.bookingLeg.updateMany({ where: { driverId: id }, data: { driverId: null } });
      await prisma.booking.updateMany({ where: { assignedDriverId: id }, data: { assignedDriverId: null } });
      await prisma.vehicle.deleteMany({ where: { driverId: id } });
      const d = await prisma.driver.findUnique({ where: { id }, select: { userId: true } });
      await prisma.driver.delete({ where: { id } });
      if (d?.userId) return prisma.user.delete({ where: { id: d.userId } });
      return null;
    default: throw new Error("Unsupported test-data entity");
  }
}

router.delete("/test-data/:entity/:id", async (req, res) => {
  if (!requireTestMode(res)) return;
  const admin = await requirePermission(req, res, "operations", PermissionAction.DELETE);
  if (!admin) return;
  const entity = String(req.params.entity ?? "").toLowerCase();
  const id = String(req.params.id ?? "").trim();
  if (!id.startsWith("v35-test-")) return res.status(403).json({ success: false, message: "Only v3.5 test records can be deleted" });
  try {
    const row = await deleteTestEntity(entity, id);
    await writeAudit(req, { adminId: admin.adminId, action: AuditAction.DELETE, module: "test-data", entityType: entity, entityId: id, beforeData: safeJsonValue(row) });
    return res.json({ success: true, message: "Test record deleted" });
  } catch (error) {
    return res.status(400).json({ success: false, message: "Unable to delete test record", error: error instanceof Error ? error.message : String(error) });
  }
});


export { router as adminRouter };

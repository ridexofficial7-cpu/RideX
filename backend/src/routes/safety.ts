import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

type IncidentType =
  | "ACCIDENT"
  | "UNSAFE_DRIVING"
  | "HARASSMENT"
  | "PASSENGER_ISSUE"
  | "MEDICAL_EMERGENCY"
  | "VEHICLE_BREAKDOWN"
  | "THEFT_SECURITY"
  | "OTHER";

function mapReasonToIncidentType(reason: unknown): IncidentType {
  const value = String(reason || "").trim().toLowerCase();

  if (value === "accident") {
    return "ACCIDENT";
  }

  if (
    value === "unsafe situation" ||
    value === "unsafe driving"
  ) {
    return "UNSAFE_DRIVING";
  }

  if (value === "harassment") {
    return "HARASSMENT";
  }

  if (value === "passenger issue") {
    return "PASSENGER_ISSUE";
  }

  if (value === "medical emergency") {
    return "MEDICAL_EMERGENCY";
  }

  if (value === "vehicle breakdown") {
    return "VEHICLE_BREAKDOWN";
  }

  if (
    value === "theft" ||
    value === "security" ||
    value === "theft/security"
  ) {
    return "THEFT_SECURITY";
  }

  return "OTHER";
}

function finiteOptionalNumber(value: unknown) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

/**
 * =========================================================
 * CUSTOMER / DRIVER SOS
 * =========================================================
 *
 * POST /api/v1/sos
 *
 * Creates:
 * 1. SosEvent
 * 2. SafetyIncident
 *
 * Both are created in one database transaction.
 *
 * Security/ownership:
 * - Customer SOS must belong to the booking customer.
 * - Driver SOS must belong to the booking's assigned driver
 *   OR to a driver assigned to any Connection Ride leg.
 */
router.post("/", async (req, res) => {
  try {
    const {
      bookingId,
      customerId,
      driverId,
      latitude,
      longitude,
      reason,
    } = req.body;

    const cleanReason = String(reason || "").trim();

    if (!cleanReason) {
      return res.status(400).json({
        success: false,
        message: "SOS reason is required",
      });
    }

    const cleanCustomerId = customerId
      ? String(customerId).trim()
      : null;

    const cleanDriverId = driverId
      ? String(driverId).trim()
      : null;

    const cleanBookingId = bookingId
      ? String(bookingId).trim()
      : null;

    if (!cleanCustomerId && !cleanDriverId) {
      return res.status(400).json({
        success: false,
        message:
          "customerId or driverId is required for SOS",
      });
    }

    if (
      cleanCustomerId &&
      cleanDriverId
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Send either customerId or driverId, not both",
      });
    }

    const lat =
      finiteOptionalNumber(latitude);
    const lng =
      finiteOptionalNumber(longitude);

    if (
      (latitude !== undefined &&
        latitude !== null &&
        lat === null) ||
      (longitude !== undefined &&
        longitude !== null &&
        lng === null)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid SOS location",
      });
    }

    /**
     * ---------------------------------------------------------
     * Validate actor and booking
     * ---------------------------------------------------------
     */
    const [customer, driver, booking] =
      await Promise.all([
        cleanCustomerId
          ? prisma.customer.findUnique({
              where: {
                id: cleanCustomerId,
              },
              select: {
                id: true,
              },
            })
          : null,

        cleanDriverId
          ? prisma.driver.findUnique({
              where: {
                id: cleanDriverId,
              },
              select: {
                id: true,
              },
            })
          : null,

        cleanBookingId
          ? prisma.booking.findUnique({
              where: {
                id: cleanBookingId,
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
            })
          : null,
      ]);

    if (
      cleanCustomerId &&
      !customer
    ) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    if (
      cleanDriverId &&
      !driver
    ) {
      return res.status(404).json({
        success: false,
        message: "Driver not found",
      });
    }

    if (
      cleanBookingId &&
      !booking
    ) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    /**
     * ---------------------------------------------------------
     * Booking ownership / driver assignment
     * ---------------------------------------------------------
     *
     * Connection Ride has multiple automatic legs and may have
     * different drivers on different legs. Therefore a driver
     * is considered authorized when assigned at booking level
     * OR assigned to any leg of this booking.
     */
    if (
      booking &&
      cleanCustomerId &&
      booking.customerId !==
        cleanCustomerId
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Booking does not belong to this customer",
      });
    }

    if (booking && cleanDriverId) {
      const driverAssignedToBooking =
        booking.assignedDriverId ===
        cleanDriverId;

      const driverAssignedToAnyLeg =
        booking.legs.some(
          (leg) =>
            leg.driverId ===
            cleanDriverId
        );

      if (
        !driverAssignedToBooking &&
        !driverAssignedToAnyLeg
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Driver is not assigned to this booking or any of its active legs",
        });
      }
    }

    /**
     * ---------------------------------------------------------
     * Active-booking rule
     * ---------------------------------------------------------
     *
     * SOS may be raised for an active/operational booking.
     *
     * Customer/driver can also raise SOS without a booking,
     * for example from a dedicated safety entry point.
     */
    const activeStatuses = new Set([
      "MATCHING",
      "DRIVER_ASSIGNED",
      "DRIVER_ARRIVING",
      "DRIVER_ARRIVED",
      "STARTED",
      "IN_PROGRESS",
      "AT_RISK",
    ]);

    if (
      booking &&
      !activeStatuses.has(
        booking.status
      )
    ) {
      return res.status(409).json({
        success: false,
        message:
          "SOS is available only during an active booking",
      });
    }

    const incidentType =
      mapReasonToIncidentType(
        cleanReason
      );

    /**
     * ---------------------------------------------------------
     * Idempotency / duplicate protection
     * ---------------------------------------------------------
     *
     * Avoid creating many identical SOS events if the actor
     * taps the SOS button repeatedly.
     */
    const recentSince =
      new Date(Date.now() - 30_000);

    const recent =
      await prisma.sosEvent.findFirst({
        where: {
          ...(cleanBookingId
            ? {
                bookingId:
                  cleanBookingId,
              }
            : {}),
          ...(cleanCustomerId
            ? {
                customerId:
                  cleanCustomerId,
              }
            : {}),
          ...(cleanDriverId
            ? {
                driverId:
                  cleanDriverId,
              }
            : {}),
          createdAt: {
            gte: recentSince,
          },
        },

        orderBy: {
          createdAt: "desc",
        },

        include: {
          incident: true,
        },
      });

    if (recent) {
      return res.status(200).json({
        success: true,
        message:
          "Recent SOS already exists",
        data: {
          sosEvent: recent,
          safetyIncident:
            recent.incident,
          duplicate: true,
        },
      });
    }

    /**
     * ---------------------------------------------------------
     * Create SOS + Safety Incident atomically
     * ---------------------------------------------------------
     */
    const result =
      await prisma.$transaction(
        async (tx) => {
          const sosEvent =
            await tx.sosEvent.create({
              data: {
                bookingId:
                  cleanBookingId,
                customerId:
                  cleanCustomerId,
                driverId:
                  cleanDriverId,
                latitude: lat,
                longitude: lng,
                reason: cleanReason,
                status: "CREATED",
              },
            });

          const safetyIncident =
            await tx.safetyIncident.create({
              data: {
                sosEventId:
                  sosEvent.id,
                bookingId:
                  cleanBookingId,
                customerId:
                  cleanCustomerId,
                driverId:
                  cleanDriverId,
                type: incidentType,
                description:
                  cleanReason,
                locationLat: lat,
                locationLng: lng,
                status: "CREATED",
              },
            });

          return {
            sosEvent,
            safetyIncident,
          };
        }
      );

    return res.status(201).json({
      success: true,
      message:
        "SOS created successfully",
      data: result,
    });
  } catch (error) {
    console.error(
      "CREATE SOS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to create SOS",
      error:
        error instanceof Error
          ? error.message
          : String(error),
    });
  }
});

/**
 * =========================================================
 * GET SOS BY CUSTOMER
 * =========================================================
 *
 * Development/helper endpoint.
 *
 * Production should be protected by customer authentication
 * before exposing arbitrary customerId history.
 */
router.get(
  "/customer/:customerId",
  async (req, res) => {
    try {
      const customerId =
        String(
          req.params.customerId ??
            ""
        ).trim();

      if (!customerId) {
        return res.status(400).json({
          success: false,
          message:
            "customerId is required",
        });
      }

      const rows =
        await prisma.sosEvent.findMany({
          where: {
            customerId,
          },
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
          orderBy: {
            createdAt: "desc",
          },
          take: 50,
        });

      return res.json({
        success: true,
        data: rows,
      });
    } catch (error) {
      console.error(
        "GET CUSTOMER SOS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load SOS history",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

export {
  router as safetyRouter,
};

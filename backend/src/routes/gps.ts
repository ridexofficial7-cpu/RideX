import { Router } from "express";
import { prisma } from "../lib/prisma";
import { findAndAssignDriver } from "../services/matching";

const router = Router();

/**
 * =========================================================
 * RIDEX GPS / LIVE LOCATION
 * =========================================================
 *
 * MVP GPS responsibilities:
 * - Driver location upsert
 * - GPS freshness check
 * - Driver online/offline GPS state
 * - Active-trip location event storage
 * - Customer access to the assigned driver's current location
 * - Connection Ride support across multiple BookingLegs
 * - Connection Ride next-leg pre-matching trigger while the
 *   customer is still travelling on the previous leg
 *
 * Backend/PostgreSQL is the source of truth.
 *
 * Production security:
 * actor identity must later come from verified session/JWT
 * instead of trusting raw driverId/customerId request fields.
 */

/**
 * =========================================================
 * GPS CONFIG
 * =========================================================
 */

const GPS_FRESH_MS = 60_000;
const MIN_LATITUDE = -90;
const MAX_LATITUDE = 90;
const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;

/**
 * Connection pre-match is intentionally debounced in-process.
 * The real matching state remains in PostgreSQL, so this only
 * prevents a burst of GPS updates from launching duplicate
 * matching jobs at the same time on one API instance.
 */
const DEFAULT_CONNECTION_PREMATCH_COOLDOWN_MS = 10_000;
const connectionPrematchInFlight = new Set<string>();
const connectionPrematchLastRun = new Map<string, number>();

/**
 * =========================================================
 * HELPERS
 * =========================================================
 */

function numberOrNull(value: unknown) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function requiredFiniteNumber(
  value: unknown,
  fieldName: string
) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(
      `${fieldName} must be a valid number`
    );
  }

  return parsed;
}

function validateCoordinates(
  latitude: number,
  longitude: number
) {
  return (
    latitude >= MIN_LATITUDE &&
    latitude <= MAX_LATITUDE &&
    longitude >= MIN_LONGITUDE &&
    longitude <= MAX_LONGITUDE
  );
}

function isFresh(
  recordedAt: Date | string | null | undefined
) {
  if (!recordedAt) {
    return false;
  }

  const timestamp =
    new Date(recordedAt).getTime();

  if (!Number.isFinite(timestamp)) {
    return false;
  }

  return (
    Date.now() - timestamp <=
    GPS_FRESH_MS
  );
}

function positiveEnvNumber(
  key: string,
  fallback: number
) {
  const parsed = Number(process.env[key]);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

/**
 * Fire next-leg Connection matching without blocking the GPS
 * response. Matching itself has database-side duplicate/winner
 * protection, while this debounce prevents excessive repeated
 * calls from high-frequency GPS updates.
 */
async function triggerConnectionPrematch(
  driverId: string
) {
  const now = Date.now();
  const cooldownMs = positiveEnvNumber(
    "CONNECTION_PREMATCH_COOLDOWN_MS",
    DEFAULT_CONNECTION_PREMATCH_COOLDOWN_MS
  );

  if (connectionPrematchInFlight.has(driverId)) {
    return;
  }

  const lastRun =
    connectionPrematchLastRun.get(driverId) ??
    0;

  if (now - lastRun < cooldownMs) {
    return;
  }

  connectionPrematchInFlight.add(driverId);
  connectionPrematchLastRun.set(
    driverId,
    now
  );

  try {
    /**
     * Find the exact Connection Ride leg currently being driven.
     * The driver can have only one active trip under the existing
     * matching/lifecycle rules.
     */
    const activeLeg =
      await prisma.bookingLeg.findFirst({
        where: {
          driverId,
          status: {
            in: [
              "STARTED",
              "IN_PROGRESS",
            ],
          },
          booking: {
            bookingType: "RIDE",
            rideType: "CONNECTION_RIDE",
            status: {
              in: [
                "STARTED",
                "IN_PROGRESS",
              ],
            },
          },
        },
        orderBy: {
          sequence: "asc",
        },
        select: {
          id: true,
          bookingId: true,
          sequence: true,
          booking: {
            select: {
              id: true,
              status: true,
              rideType: true,
              bookingType: true,
              legs: {
                orderBy: {
                  sequence: "asc",
                },
                select: {
                  id: true,
                  sequence: true,
                  status: true,
                  driverId: true,
                  tripId: true,
                },
              },
            },
          },
        },
      });

    if (!activeLeg) {
      return;
    }

    const nextLeg =
      activeLeg.booking.legs.find(
        (leg) =>
          leg.sequence ===
            activeLeg.sequence + 1 &&
          leg.status !== "COMPLETED" &&
          leg.status !== "CANCELLED"
      ) ?? null;

    if (!nextLeg) {
      return;
    }

    /**
     * If another matcher has already assigned/offered this next
     * leg, do nothing. This is an optimisation only; matching.ts
     * still performs its own authoritative transaction checks.
     */
    if (nextLeg.driverId) {
      return;
    }

    const existingOffer =
      await prisma.rideRequest.findFirst({
        where: {
          bookingId:
            activeLeg.bookingId,
          legId: nextLeg.id,
          status: {
            in: [
              "OFFERED",
              "ACCEPTED",
            ],
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
        },
      });

    if (existingOffer) {
      return;
    }

    const result =
      await findAndAssignDriver(
        activeLeg.bookingId,
        nextLeg.id
      );

    /**
     * Keep operational visibility in server logs without making
     * GPS responses depend on matcher success/failure.
     */
    if (
      result &&
      typeof result === "object" &&
      "matched" in result
    ) {
      console.log(
        "CONNECTION PREMATCH:",
        {
          bookingId:
            activeLeg.bookingId,
          activeLegId:
            activeLeg.id,
          activeLegSequence:
            activeLeg.sequence,
          nextLegId:
            nextLeg.id,
          nextLegSequence:
            nextLeg.sequence,
          result,
        }
      );
    }
  } catch (error) {
    /**
     * GPS ingestion must remain healthy even if pre-matching has
     * a transient error. The next GPS update can retry it.
     */
    console.error(
      "CONNECTION PREMATCH ERROR:",
      error
    );
  } finally {
    connectionPrematchInFlight.delete(
      driverId
    );
  }
}

/**
 * =========================================================
 * DRIVER GPS UPDATE
 * =========================================================
 *
 * POST /api/v1/gps/location
 *
 * Body:
 * {
 *   driverId: string,
 *   latitude: number,
 *   longitude: number,
 *   accuracy?: number,
 *   heading?: number,
 *   speed?: number,
 *   isOnline?: boolean,
 *   recordedAt?: ISO date
 * }
 *
 * The Driver App can call this endpoint periodically.
 */
router.post(
  "/location",
  async (req, res) => {
    try {
      const driverId =
        String(
          req.body?.driverId ??
            ""
        ).trim();

      if (!driverId) {
        return res.status(400).json({
          success: false,
          message:
            "driverId is required",
        });
      }

      const latitude =
        requiredFiniteNumber(
          req.body?.latitude,
          "latitude"
        );

      const longitude =
        requiredFiniteNumber(
          req.body?.longitude,
          "longitude"
        );

      if (
        !validateCoordinates(
          latitude,
          longitude
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid GPS coordinates",
        });
      }

      const accuracy =
        numberOrNull(
          req.body?.accuracy
        );

      const heading =
        numberOrNull(
          req.body?.heading
        );

      const speed =
        numberOrNull(
          req.body?.speed
        );

      if (
        accuracy !== null &&
        accuracy < 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "accuracy cannot be negative",
        });
      }

      if (
        speed !== null &&
        speed < 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "speed cannot be negative",
        });
      }

      const requestedRecordedAt =
        req.body?.recordedAt
          ? new Date(
              req.body.recordedAt
            )
          : new Date();

      if (
        Number.isNaN(
          requestedRecordedAt.getTime()
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid recordedAt",
        });
      }

      const driver =
        await prisma.driver.findUnique({
          where: {
            id: driverId,
          },
          select: {
            id: true,
            driverStatus: true,
          },
        });

      if (!driver) {
        return res.status(404).json({
          success: false,
          message:
            "Driver not found",
        });
      }

      /**
       * GPS record isOnline defaults to the actual current
       * driver state unless explicitly supplied.
       */
      const isOnline =
        req.body?.isOnline !==
        undefined
          ? Boolean(
              req.body.isOnline
            )
          : driver.driverStatus !==
            "OFFLINE";

      const location =
        await prisma.driverLocation.upsert(
          {
            where: {
              driverId,
            },
            update: {
              latitude,
              longitude,
              accuracy,
              heading,
              speed,
              isOnline,
              recordedAt:
                requestedRecordedAt,
            },
            create: {
              driverId,
              latitude,
              longitude,
              accuracy,
              heading,
              speed,
              isOnline,
              recordedAt:
                requestedRecordedAt,
            },
          }
        );

      /**
       * When the driver has an active assigned trip, also
       * persist a trip-location event.
       *
       * For Connection Ride, this resolves through the current
       * leg assigned to this driver.
       */
      const activeLeg =
        await prisma.bookingLeg.findFirst({
          where: {
            driverId,
            status: {
              in: [
                "STARTED",
                "IN_PROGRESS",
              ],
            },
          },
          orderBy: {
            sequence:
              "asc",
          },
          select: {
            tripId: true,
          },
        });

      let tripLocation = null;

      if (activeLeg?.tripId) {
        tripLocation =
          await prisma.tripLocationEvent.create(
            {
              data: {
                tripId:
                  activeLeg.tripId,
                latitude,
                longitude,
                accuracy,
                heading,
                speed,
                recordedAt:
                  requestedRecordedAt,
              },
            }
          );
      }

      /**
       * For an active Connection Ride leg, start looking for the
       * next leg's driver while the customer is still travelling.
       * This uses the exact next BookingLeg and lets matching.ts
       * calculate route corridor, direction, driver ETA and
       * customer ETA against the previous leg's progress.
       */
      if (
        isOnline &&
        activeLeg?.tripId
      ) {
        void triggerConnectionPrematch(
          driverId
        );
      }

      return res.json({
        success: true,
        data: {
          location,
          tripLocation,
          fresh: isFresh(
            location.recordedAt
          ),
        },
      });
    } catch (error) {
      console.error(
        "GPS LOCATION UPDATE ERROR:",
        error
      );

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      if (
        message.includes(
          "must be a valid number"
        )
      ) {
        return res.status(400).json({
          success: false,
          message,
        });
      }

      return res.status(500).json({
        success: false,
        message:
          "Unable to update driver GPS",
        error: message,
      });
    }
  }
);

/**
 * =========================================================
 * GET DRIVER CURRENT LOCATION
 * =========================================================
 *
 * GET /api/v1/gps/driver/:driverId
 */
router.get(
  "/driver/:driverId",
  async (req, res) => {
    try {
      const driverId =
        String(
          req.params.driverId ??
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
          select: {
            id: true,
            fullName: true,
            driverStatus: true,
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

      const location =
        driver.location;

      return res.json({
        success: true,
        data: {
          driverId:
            driver.id,
          driverStatus:
            driver.driverStatus,
          location,
          fresh: isFresh(
            location?.recordedAt
          ),
        },
      });
    } catch (error) {
      console.error(
        "GET DRIVER GPS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load driver GPS",
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
 * GET BOOKING LIVE LOCATION
 * =========================================================
 *
 * GET /api/v1/gps/booking/:bookingId
 *
 * Customer-facing helper endpoint.
 *
 * For a normal ride:
 * - booking assigned driver is used.
 *
 * For Connection Ride:
 * - current STARTED/IN_PROGRESS leg is preferred.
 * - otherwise the first active assigned leg is used.
 * - if there is no current driver, location is null.
 */
router.get(
  "/booking/:bookingId",
  async (req, res) => {
    try {
      const bookingId =
        String(
          req.params.bookingId ??
            ""
        ).trim();

      const customerId =
        String(
          req.query?.customerId ??
            ""
        ).trim();

      if (!bookingId || !customerId) {
        return res.status(400).json({
          success: false,
          message:
            "bookingId and customerId are required",
        });
      }

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
              orderBy: {
                sequence:
                  "asc",
              },
              select: {
                id: true,
                sequence: true,
                status: true,
                driverId: true,
                tripId: true,
              },
            },
          },
        });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message:
            "Booking not found",
        });
      }

      /**
       * Customer ownership is mandatory for this
       * customer-facing booking location endpoint.
       */
      if (
        booking.customerId !==
        customerId
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Customer is not allowed to access this booking location",
        });
      }

      /**
       * Prefer current Connection leg in progress.
       */
      const currentLeg =
        booking.legs.find(
          (leg) =>
            leg.status ===
              "IN_PROGRESS" ||
            leg.status ===
              "STARTED"
        ) ??
        booking.legs.find(
          (leg) =>
            leg.driverId &&
            leg.status !==
              "COMPLETED" &&
            leg.status !==
              "CANCELLED"
        );

      const driverId =
        currentLeg?.driverId ??
        booking.assignedDriverId ??
        null;

      if (!driverId) {
        return res.json({
          success: true,
          data: {
            bookingId,
            legId:
              currentLeg?.id ??
              null,
            legSequence:
              currentLeg?.sequence ??
              null,
            driverId: null,
            location: null,
            fresh: false,
          },
        });
      }

      const location =
        await prisma.driverLocation.findUnique(
          {
            where: {
              driverId,
            },
          }
        );

      return res.json({
        success: true,
        data: {
          bookingId,
          legId:
            currentLeg?.id ??
            null,
          legSequence:
            currentLeg?.sequence ??
            null,
          driverId,
          location,
          fresh: isFresh(
            location?.recordedAt
          ),
        },
      });
    } catch (error) {
      console.error(
        "GET BOOKING GPS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load booking live location",
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
 * GET ACTIVE TRIP LOCATION HISTORY
 * =========================================================
 *
 * GET /api/v1/gps/trip/:tripId
 *
 * Development/operations helper.
 */
router.get(
  "/trip/:tripId",
  async (req, res) => {
    try {
      const tripId =
        String(
          req.params.tripId ??
            ""
        ).trim();

      if (!tripId) {
        return res.status(400).json({
          success: false,
          message:
            "tripId is required",
        });
      }

      const trip =
        await prisma.trip.findUnique({
          where: {
            id: tripId,
          },
          select: {
            id: true,
            status: true,
            startedAt: true,
            completedAt: true,
            locations: {
              orderBy: {
                recordedAt:
                  "asc",
              },
              take: 1000,
            },
            bookingLeg: {
              select: {
                id: true,
                bookingId: true,
                sequence: true,
                driverId: true,
              },
            },
          },
        });

      if (!trip) {
        return res.status(404).json({
          success: false,
          message:
            "Trip not found",
        });
      }

      return res.json({
        success: true,
        data: trip,
      });
    } catch (error) {
      console.error(
        "GET TRIP GPS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load trip GPS history",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

export {
  router as gpsRouter,
};

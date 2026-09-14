import {
  Booking,
  Driver,
  Vehicle,
} from "@prisma/client";

import { prisma } from "../lib/prisma";

const envNum = (
  key: string,
  fallback: number
) => {
  const value = Number(
    process.env[key]
  );

  return Number.isFinite(value)
    ? value
    : fallback;
};

const toRad = (value: number) =>
  (value * Math.PI) / 180;

/* =========================================================
   HAVERSINE
   ========================================================= */

function airKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
) {
  const R = 6371;

  const dLat = toRad(
    bLat - aLat
  );

  const dLng = toRad(
    bLng - aLng
  );

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) *
      Math.cos(toRad(bLat)) *
      Math.sin(dLng / 2) ** 2;

  return (
    2 *
    R *
    Math.asin(
      Math.sqrt(x)
    )
  );
}

/* =========================================================
   TYPES
   ========================================================= */

type Candidate = Driver & {
  vehicles: Vehicle[];

  location: {
    latitude: number;
    longitude: number;
    isOnline: boolean;
    recordedAt: Date;
  } | null;
};

/* =========================================================
   CONSTANTS
   ========================================================= */

const DEFAULT_MAX_STALE_MS =
  120_000;

const DEFAULT_MAX_PICKUP_DISTANCE_KM =
  5;

const DEFAULT_MAX_PICKUP_ETA_MIN =
  20;

const DEFAULT_OFFER_SECONDS =
  30;

const MAX_SHARED_PASSENGERS =
  4;

/* =========================================================
   ACTIVE BOOKING CHECK
   ========================================================= */

async function hasActiveTrip(
  driverId: string,
  excludeBookingId?: string
) {
  const active =
    await prisma.bookingLeg.findFirst({
      where: {
        driverId,

        status: {
          in: [
            "DRIVER_ASSIGNED",
            "DRIVER_ARRIVING",
            "DRIVER_ARRIVED",
            "STARTED",
            "IN_PROGRESS",
          ],
        },

        booking: excludeBookingId
          ? {
              id: {
                not: excludeBookingId,
              },
            }
          : undefined,
      },

      select: {
        id: true,
        bookingId: true,
        sequence: true,
        status: true,
      },
    });

  return Boolean(active);
}

/* =========================================================
   FIND & ASSIGN DRIVER
   ========================================================= */

export async function findAndAssignDriver(
  bookingId: string,
  legId?: string
) {
  /* ---------------------------------------------------------
     LOAD BOOKING
     --------------------------------------------------------- */

  const booking =
    await prisma.booking.findUnique({
      where: {
        id: bookingId,
      },

      include: {
        legs: {
          orderBy: {
            sequence: "asc",
          },
        },
      },
    });

  if (!booking) {
    throw new Error(
      "Booking not found"
    );
  }

  /* ---------------------------------------------------------
     CLOSED BOOKING
     --------------------------------------------------------- */

  if (
    booking.status === "COMPLETED" ||
    booking.status === "CANCELLED"
  ) {
    return {
      matched: false,
      reason: "BOOKING_CLOSED",
    };
  }

  /* ---------------------------------------------------------
     ALREADY ASSIGNED
     --------------------------------------------------------- */

  if (
    !legId &&
    booking.assignedDriverId &&
    booking.status ===
      "DRIVER_ASSIGNED"
  ) {
    const existingRequest =
      await prisma.rideRequest.findFirst({
        where: {
          bookingId:
            booking.id,

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
      });

    /*
     * A booking-level driver assignment is only considered
     * reusable when a live OFFERED/ACCEPTED request still exists.
     * If an old offer was rejected/expired/cancelled, continue
     * matching instead of getting stuck on the old driver.
     */
    if (existingRequest) {
      return {
        matched: true,

        driverId:
          booking.assignedDriverId,

        vehicleId:
          booking.vehicleId,

        requestId:
          existingRequest.id,

        alreadyAssigned: true,
      };
    }
  }

  /* =========================================================
     REQUIRED MODE
     ========================================================= */

  let targetLeg =
    legId
      ? booking.legs.find((leg) => leg.id === legId)
      : booking.legs.find((leg) => leg.sequence === 1);

  if (legId && !targetLeg) {
    return {
      matched: false,
      reason: "TARGET_LEG_NOT_FOUND",
    };
  }

  if (!targetLeg) {
    targetLeg =
      booking.legs.find(
        (leg) =>
          leg.status !== "COMPLETED" &&
          leg.status !== "CANCELLED"
      );
  }

  if (!targetLeg) {
    return { matched: false, reason: "NO_ACTIVE_LEG" };
  }

  if (
    targetLeg.status === "COMPLETED" ||
    targetLeg.status === "CANCELLED"
  ) {
    return {
      matched: false,
      reason: "LEG_NOT_MATCHABLE",
    };
  }

  /*
   * Connection Ride:
   * each leg is matched independently. A later leg must never
   * reuse a driver/vehicle from an already completed leg.
   *
   * The same driver may continue onto a later leg when they are
   * genuinely available; the key rule is that a completed leg
   * itself is never treated as the active matching target.
   */

  /* =========================================================
     REQUIRED VEHICLE
     ========================================================= */

  const requiredVehicle =
    booking.bookingType === "GOODS"
      ? booking.goodsVehicleType
      : "E_RICKSHAW";

  if (
    booking.bookingType === "GOODS" &&
    !requiredVehicle
  ) {
    await prisma.booking.update({
      where: {
        id: booking.id,
      },

      data: {
        status: "MATCHING",
      },
    });

    return {
      matched: false,
      reason:
        "GOODS_VEHICLE_TYPE_REQUIRED",
    };
  }

  /* =========================================================
     PASSENGER COUNT
     ========================================================= */

  const passengerCount =
    booking.bookingType === "RIDE" &&
    (
      booking.rideType ===
        "SHARED_RIDE" ||
      booking.rideType ===
        "CONNECTION_RIDE"
    )
      ? Math.max(
          1,
          Math.min(
            MAX_SHARED_PASSENGERS,
            Number(
              booking.passengerCount
            ) || 1
          )
        )
      : 1;

  /* =========================================================
     CONFIG
     ========================================================= */

  const maxStaleMs =
    envNum(
      "MATCHING_MAX_STALE_MS",
      DEFAULT_MAX_STALE_MS
    );

  const maxPickupDistanceKm =
    envNum(
      "MATCHING_MAX_PICKUP_DISTANCE_KM",
      DEFAULT_MAX_PICKUP_DISTANCE_KM
    );

  const maxPickupEtaMinutes =
    envNum(
      "MATCHING_MAX_PICKUP_ETA_MIN",
      DEFAULT_MAX_PICKUP_ETA_MIN
    );

  const offerSeconds =
    envNum(
      "MATCHING_OFFER_SECONDS",
      DEFAULT_OFFER_SECONDS
    );

  const now =
    Date.now();

  /* =========================================================
     DRIVER CANDIDATES
     ========================================================= */

  const candidates =
    (await prisma.driver.findMany({
      where: {
        verificationStatus:
          "APPROVED",

        driverStatus:
          "ONLINE",
      },

      include: {
        vehicles: true,
        location: true,
      },
    })) as Candidate[];

  /* =========================================================
     NO ONLINE DRIVERS
     ========================================================= */

  if (
    candidates.length === 0
  ) {
    await prisma.booking.update({
      where: {
        id: booking.id,
      },

      data: {
        status: "MATCHING",
      },
    });

    return {
      matched: false,

      reason:
        "NO_ONLINE_APPROVED_DRIVER",

      diagnostics: {
        candidates: 0,
      },
    };
  }

  /* =========================================================
     SCORE CANDIDATES
     ========================================================= */

  const rejected: Array<{
    driverId: string;
    reason: string;
  }> = [];

  const scored =
    await Promise.all(
      candidates.map(
        async (driver) => {
          /* -----------------------------------------------
             SERVICE MODE
             -----------------------------------------------
             Final RideX matching rules:
             - Passenger Ride: E-Rickshaw only; PASSENGER/BOTH service modes.
             - Parcel: Passenger E-Rickshaw only; PASSENGER/BOTH modes.
             - Goods: Battery/electric Pickup Truck only; GOODS/BOTH modes.
             Vehicle type and booking type are therefore evaluated
             together instead of using one global required mode.
          */

          /* -----------------------------------------------
             LOCATION
             ----------------------------------------------- */

          if (!driver.location) {
            rejected.push({
              driverId:
                driver.id,
              reason:
                "NO_DRIVER_LOCATION",
            });

            return null;
          }

          if (
            !driver.location.isOnline
          ) {
            rejected.push({
              driverId:
                driver.id,
              reason:
                "DRIVER_LOCATION_OFFLINE",
            });

            return null;
          }

          const locationAgeMs =
            now -
            driver.location.recordedAt.getTime();

          if (
            locationAgeMs >
            maxStaleMs
          ) {
            rejected.push({
              driverId:
                driver.id,
              reason:
                "STALE_GPS",
            });

            return null;
          }

          /* -----------------------------------------------
             ACTIVE TRIP
             ----------------------------------------------- */

          const conflict =
            await hasActiveTrip(
              driver.id,
              booking.id
            );

          if (conflict) {
            rejected.push({
              driverId:
                driver.id,
              reason:
                "ACTIVE_TRIP_CONFLICT",
            });

            return null;
          }

          /* -----------------------------------------------
             VEHICLE FILTER
             ----------------------------------------------- */

          const eligibleVehicles =
            driver.vehicles.filter(
              (vehicle) => {
                const vehicleActive =
                  vehicle.status ===
                    "ACTIVE" ||
                  vehicle.status ===
                    "VERIFIED";

                if (!vehicleActive) {
                  return false;
                }

                /* -----------------------------------------
                   GOODS
                   ----------------------------------------- */

                if (
                  booking.bookingType ===
                  "GOODS"
                ) {
                  const subtype = String(booking.serviceSubtype || "GOODS").toUpperCase();

                  // Parcel is a goods-service subtype carried only by the
                  // passenger E-Rickshaw. Goods is carried only by the
                  // battery/electric Pickup Truck.
                  if (subtype === "PARCEL") {
                    if (vehicle.vehicleType !== "E_RICKSHAW") return false;
                    if (vehicle.capacity <= 0) return false;
                    if ((driver as any).parcelServiceEnabled === false) return false;
                    return driver.dailyServiceMode === "PASSENGER" || driver.dailyServiceMode === "BOTH";
                  }

                  if (subtype === "GOODS") {
                    if (vehicle.vehicleType !== "PICKUP_TRUCK") return false;
                    if (!vehicle.goodsEligible) return false;
                    return driver.dailyServiceMode === "GOODS" || driver.dailyServiceMode === "BOTH";
                  }

                  return false;
                }

                /* -----------------------------------------
                   PASSENGER
                   ----------------------------------------- */

                if (
                  booking.bookingType ===
                  "RIDE"
                ) {
                  if (
                    vehicle.vehicleType !==
                    "E_RICKSHAW"
                  ) {
                    return false;
                  }

                  if (
                    vehicle.capacity <
                    passengerCount
                  ) {
                    return false;
                  }

                  const passengerModeOK =
                    driver.dailyServiceMode ===
                      "PASSENGER" ||
                    driver.dailyServiceMode ===
                      "BOTH";

                  return passengerModeOK;
                }

                return false;
              }
            );

          if (
            eligibleVehicles.length ===
            0
          ) {
            rejected.push({
              driverId:
                driver.id,
              reason:
                booking.bookingType ===
                "GOODS"
                  ? "NO_ELIGIBLE_GOODS_VEHICLE"
                  : "NO_ELIGIBLE_PASSENGER_VEHICLE",
            });

            return null;
          }

          /* -----------------------------------------------
             PICKUP DISTANCE
             ----------------------------------------------- */

          const distanceKm =
            airKm(
              driver.location.latitude,
              driver.location.longitude,
              targetLeg.pickupLat,
              targetLeg.pickupLng
            );

          if (
            distanceKm >
            maxPickupDistanceKm
          ) {
            rejected.push({
              driverId:
                driver.id,
              reason:
                "PICKUP_TOO_FAR",
            });

            return null;
          }

          /* -----------------------------------------------
             PICKUP ETA
             ----------------------------------------------- */

          const etaMinutes =
            Math.max(
              1,
              Math.ceil(
                (distanceKm /
                  20) *
                  60
              )
            );

          if (
            etaMinutes >
            maxPickupEtaMinutes
          ) {
            rejected.push({
              driverId:
                driver.id,
              reason:
                "PICKUP_ETA_TOO_HIGH",
            });

            return null;
          }

          /* -----------------------------------------------
             SHARED RIDE
             ----------------------------------------------- */

          let routePenalty = 0;

          if (
            booking.bookingType ===
              "RIDE" &&
            booking.rideType ===
              "SHARED_RIDE"
          ) {
            const maxDetourKm =
              envNum(
                "SHARED_MAX_DETOUR_KM",
                2
              );

            routePenalty =
              Math.min(
                maxDetourKm,
                distanceKm * 0.25
              );
          }

          /* -----------------------------------------------
             CONNECTION
             ----------------------------------------------- */

          if (
            booking.bookingType === "RIDE" &&
            booking.rideType === "CONNECTION_RIDE"
          ) {
            /*
             * Connection matching is leg-specific.
             * The target leg pickup is the connection point for
             * later legs, so normal pickup distance/ETA ranking
             * is applied to that exact point.
             *
             * Keep only a small configurable preference rather
             * than penalising a later leg based on total journey
             * distance.
             */
            const connectionPreference =
              envNum(
                "CONNECTION_MATCHING_PREFERENCE",
                0.1
              );

            routePenalty =
              distanceKm *
              connectionPreference;
          }

          /* -----------------------------------------------
             SCORE
             ----------------------------------------------- */

          const score =
            distanceKm +
            routePenalty;

          return {
            driver,
            vehicle:
              eligibleVehicles[0],
            distanceKm,
            etaMinutes,
            score,
          };
        }
      )
    );

  /* =========================================================
     VALID CANDIDATES
     ========================================================= */

  const validCandidates =
    scored.filter(
      (
        item
      ): item is NonNullable<
        (typeof scored)[number]
      > =>
        Boolean(item)
    );

  validCandidates.sort(
    (a, b) =>
      a.score - b.score
  );

  const winner =
    validCandidates[0];

  /* =========================================================
     NO ELIGIBLE DRIVER
     ========================================================= */

  if (!winner) {
    await prisma.booking.update({
      where: {
        id: booking.id,
      },

      data: {
        status: "MATCHING",
      },
    });

    /**
     * Diagnostics are intentionally returned so the
     * current Demo Test can immediately tell us why
     * a driver was rejected.
     */

    const reasonCounts =
      rejected.reduce<
        Record<string, number>
      >(
        (
          result,
          item
        ) => {
          result[
            item.reason
          ] =
            (result[
              item.reason
            ] || 0) + 1;

          return result;
        },
        {}
      );

    return {
      matched: false,

      reason:
        "NO_ELIGIBLE_DRIVER",

      diagnostics: {
        candidates:
          candidates.length,

        rejected:
          rejected.length,

        reasonCounts,

        legId:
          targetLeg.id,

        legSequence:
          targetLeg.sequence,
      },
    };
  }

  /* =========================================================
     TARGET LEG
     ========================================================= */

  const selectedLeg = targetLeg;

  /*
   * For a later Connection Ride leg, the booking is expected to
   * be in MATCHING state after the previous leg completes.
   * For the first leg, NEW/MATCHING are both valid.
   *
   * The RideRequest is always linked to selectedLeg.id so the
   * Driver App can display and act on the exact connection leg.
   */

  /* =========================================================
     OFFER EXPIRY
     ========================================================= */

  const expiresAt =
    new Date(
      Date.now() +
        offerSeconds *
          1000
    );

  /* =========================================================
     TRANSACTION
     ========================================================= */

  try {
    const result =
      await prisma.$transaction(
        async (tx) => {
          /* -----------------------------------------------
             RE-CHECK BOOKING
             ----------------------------------------------- */

          const current =
            await tx.booking.findUnique(
              {
                where: {
                  id: booking.id,
                },
              }
            );

          if (!current) {
            throw new Error(
              "Booking disappeared during matching"
            );
          }

          if (
            current.status ===
              "COMPLETED" ||
            current.status ===
              "CANCELLED"
          ) {
            return {
              matched: false,

              reason:
                "BOOKING_CLOSED",
            };
          }

          const currentLeg =
            await tx.bookingLeg.findUnique({
              where: { id: selectedLeg.id },
            });

          if (!currentLeg) {
            throw new Error("Target booking leg not found");
          }

          if (
            currentLeg.status === "COMPLETED" ||
            currentLeg.status === "CANCELLED"
          ) {
            return {
              matched: false,
              reason: "LEG_NOT_MATCHABLE",
            };
          }

          /* -----------------------------------------------
             FINAL WINNER AVAILABILITY RE-CHECK
             -----------------------------------------------
             The candidate list was calculated before the
             transaction. Another booking may have consumed
             the winner in the meantime. Re-check the driver's
             approval/online state and active-leg conflict while
             we are inside the transaction.
          */

          const winnerDriver =
            await tx.driver.findUnique({
              where: {
                id: winner.driver.id,
              },
              select: {
                id: true,
                verificationStatus: true,
                driverStatus: true,
              },
            });

          if (
            !winnerDriver ||
            winnerDriver.verificationStatus !== "APPROVED" ||
            winnerDriver.driverStatus !== "ONLINE"
          ) {
            return {
              matched: false,
              reason: "WINNER_NO_LONGER_AVAILABLE",
            };
          }

          const winnerConflict =
            await tx.bookingLeg.findFirst({
              where: {
                driverId: winner.driver.id,
                bookingId: {
                  not: booking.id,
                },
                status: {
                  in: [
                    "DRIVER_ASSIGNED",
                    "DRIVER_ARRIVING",
                    "DRIVER_ARRIVED",
                    "STARTED",
                    "IN_PROGRESS",
                  ],
                },
              },
              select: {
                id: true,
              },
            });

          if (winnerConflict) {
            return {
              matched: false,
              reason: "WINNER_ACTIVE_TRIP_CONFLICT",
            };
          }

          if (currentLeg.driverId) {
            const existingRequest =
              await tx.rideRequest.findFirst({
                where: {
                  bookingId: booking.id,
                  legId: currentLeg.id,
                  status: { in: ["OFFERED", "ACCEPTED"] },
                },
                orderBy: { createdAt: "desc" },
              });

            return {
              matched: true,
              driverId: currentLeg.driverId,
              vehicleId: currentLeg.vehicleId,
              requestId: existingRequest?.id ?? null,
              alreadyAssigned: true,
            };
          }

          /* -----------------------------------------------
             PREVENT DUPLICATE OFFER
             ----------------------------------------------- */

          const existingOffer =
            await tx.rideRequest.findFirst(
              {
                where: {
                  bookingId:
                    booking.id,

                  legId:
                    selectedLeg.id,

                  status: "OFFERED",

                  OR: [
                    {
                      expiresAt:
                        null,
                    },
                    {
                      expiresAt: {
                        gt: new Date(),
                      },
                    },
                  ],
                },

                orderBy: {
                  createdAt:
                    "desc",
                },
              }
            );

          if (
            existingOffer
          ) {
            return {
              matched: true,

              driverId:
                existingOffer.driverId,

              vehicleId:
                existingOffer.vehicleId,

              requestId:
                existingOffer.id,

              alreadyOffered:
                true,
            };
          }

          /* -----------------------------------------------
             ASSIGN BOOKING
             ----------------------------------------------- */

          const updatedBooking =
            await tx.booking.update(
              {
                where: {
                  id: booking.id,
                },

                data: {
                  status:
                    "DRIVER_ASSIGNED",

                  assignedDriverId:
                    winner.driver.id,

                  vehicleId:
                    winner.vehicle.id,
                },
              }
            );

          /* -----------------------------------------------
             UPDATE FIRST LEG
             ----------------------------------------------- */

          if (selectedLeg) {
            await tx.bookingLeg.update(
              {
                where: {
                  id:
                    selectedLeg.id,
                },

                data: {
                  status:
                    "DRIVER_ASSIGNED",

                  driverId:
                    winner.driver.id,

                  vehicleId:
                    winner.vehicle.id,
                },
              }
            );
          }

          /* -----------------------------------------------
             CREATE OFFER
             ----------------------------------------------- */

          const rideRequest =
            await tx.rideRequest.create(
              {
                data: {
                  bookingId:
                    booking.id,

                  legId:
                    selectedLeg.id,

                  driverId:
                    winner.driver.id,

                  vehicleId:
                    winner.vehicle.id,

                  status:
                    "OFFERED",

                  distanceKm:
                    winner.distanceKm,

                  etaMinutes:
                    winner.etaMinutes,

                  score:
                    winner.score,

                  offeredAt:
                    new Date(),

                  expiresAt,
                },
              }
            );

          return {
            matched: true,

            driverId:
              winner.driver.id,

            vehicleId:
              winner.vehicle.id,

            requestId:
              rideRequest.id,

            distanceKm:
              winner.distanceKm,

            etaMinutes:
              winner.etaMinutes,

            bookingStatus:
              updatedBooking.status,

            legId:
              selectedLeg.id,

            legSequence:
              selectedLeg.sequence,
          };
        }
      );

    return result;
  } catch (error) {
    console.error(
      "MATCHING TRANSACTION ERROR:",
      error
    );

    throw error;
  }
}
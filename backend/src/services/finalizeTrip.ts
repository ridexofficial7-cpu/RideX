import { prisma } from "../lib/prisma";
import { findAndAssignDriver } from "./matching";

import {
  commission,
  distanceFare,
  driverEarning,
  fullRideFare,
  goodsFare,
  sharedFare,
  DEFAULT_RIDEX_COMMISSION_RATE,
} from "./pricing";

type FinalizeSource =
  | "DRIVER"
  | "CUSTOMER";

type FinalizeTripInput = {
  bookingId: string;
  source: FinalizeSource;
  reason?: string;
};

/* =========================================================
   HELPERS
   ========================================================= */

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function distanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
) {
  const R = 6371;

  const dLat = toRad(
    lat2 - lat1
  );

  const dLng = toRad(
    lng2 - lng1
  );

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;

  return (
    2 *
    R *
    Math.asin(Math.sqrt(a))
  );
}

function calculateTripDistance(
  locations: {
    latitude: number;
    longitude: number;
  }[]
) {
  if (locations.length < 2) {
    return 0;
  }

  let total = 0;

  for (
    let i = 1;
    i < locations.length;
    i++
  ) {
    total += distanceKm(
      locations[i - 1].latitude,
      locations[i - 1].longitude,
      locations[i].latitude,
      locations[i].longitude
    );
  }

  return (
    Math.round(total * 100) / 100
  );
}

function envCommissionRate() {
  const raw = Number(
    process.env.RIDEX_COMMISSION_RATE
  );

  if (
    Number.isFinite(raw) &&
    raw >= 0 &&
    raw <= 1
  ) {
    return raw;
  }

  return DEFAULT_RIDEX_COMMISSION_RATE;
}

/* =========================================================
   FINALIZE TRIP
   ========================================================= */

export async function finalizeTrip({
  bookingId,
  source,
  reason,
}: FinalizeTripInput) {
  /**
   * ---------------------------------------------------------
   * LOAD BOOKING
   * ---------------------------------------------------------
   */

  const booking =
    await prisma.booking.findUnique({
      where: {
        id: bookingId,
      },

      include: {
        rideRequests: {
          where: {
            status: "ACCEPTED",
          },
          orderBy: {
            respondedAt: "desc",
          },
        },

        payment: true,

        coupon: true,

        legs: {
          include: {
            trip: {
              include: {
                locations: {
                  orderBy: {
                    recordedAt: "asc",
                  },
                },
              },
            },
          },

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

  /* =========================================================
     IDEMPOTENCY
     ========================================================= */

  if (
    booking.status === "COMPLETED"
  ) {
    const storedRate =
      Number(
        booking.commissionRate ??
          envCommissionRate()
      );

    const storedGross =
      Number(
        booking.finalFare ?? 0
      );

    const storedCommission =
      commission(
        storedGross,
        storedRate
      );

    let storedDriverEarning:
      | number
      | null = null;

    if (booking.assignedDriverId) {
      const existing =
        await prisma.driverEarning.findFirst({
          where: {
            bookingId: booking.id,
            driverId:
              booking.assignedDriverId,
          },
        });

      storedDriverEarning =
        existing
          ? Number(existing.netEarning)
          : null;
    }

    const completedLeg =
      booking.legs.find(
        (leg) =>
          leg.status === "COMPLETED"
      );

    return {
      alreadyCompleted: true,

      bookingId:
        booking.id,

      bookingStatus:
        booking.status,

      grossFare:
        storedGross,

      commission:
        storedCommission,

      commissionRate:
        `${storedRate * 100}%`,

      driverEarning:
        storedDriverEarning,

      actualDistanceKm:
        null,

      actualDurationMinutes:
        null,

      tripId:
        completedLeg?.tripId ??
        undefined,

      payment:
        booking.payment,

      driverId:
        booking.assignedDriverId,

      source,
    };
  }

  /* =========================================================
     STATUS
     ========================================================= */

  if (
    booking.status !==
    "IN_PROGRESS"
  ) {
    throw new Error(
      `Cannot complete ride from status ${booking.status}`
    );
  }

  /* =========================================================
     ACTIVE LEG
     ========================================================= */

  const leg =
    booking.legs.find(
      (item) =>
        item.status ===
          "IN_PROGRESS" ||
        item.status === "STARTED"
    ) ??
    booking.legs.find(
      (item) =>
        item.status !== "COMPLETED" &&
        item.status !== "CANCELLED"
    );

  if (!leg) {
    throw new Error(
      "Active booking leg not found"
    );
  }

  if (!leg.trip) {
    throw new Error(
      "Active trip not found"
    );
  }

  /* =========================================================
     ACCEPTED DRIVER FOR THIS LEG
     =========================================================
     Connection Ride can have multiple accepted RideRequests,
     one for each completed/active leg. Always prefer the
     request linked to the leg being finalized.
   */

  const request =
    booking.rideRequests.find(
      (item) =>
        item.legId === leg.id
    ) ??
    booking.rideRequests[0];

  if (!request) {
    throw new Error(
      "Accepted driver request not found for active leg"
    );
  }

  const completedAt =
    new Date();

  const startedAt =
    leg.trip.startedAt ??
    completedAt;

  /* =========================================================
     ACTUAL DURATION
     ========================================================= */

  const durationMinutes =
    Math.max(
      0,
      Math.ceil(
        (
          completedAt.getTime() -
          startedAt.getTime()
        ) / 60000
      )
    );

  /* =========================================================
     FINAL CURRENT DRIVER LOCATION
     ========================================================= */

  const currentDriverId =
    leg.driverId ??
    request.driverId;

  const currentDriverLocation =
    await prisma.driverLocation.findUnique({
      where: {
        driverId:
          currentDriverId,
      },
    });

  /**
   * Build GPS sequence locally.
   *
   * The current DriverLocation is appended as the final
   * point when available.
   */

  const gpsLocations =
    leg.trip.locations.map(
      (item) => ({
        latitude:
          item.latitude,

        longitude:
          item.longitude,
      })
    );

  if (
    currentDriverLocation
  ) {
    const last =
      gpsLocations[
        gpsLocations.length - 1
      ];

    const changed =
      !last ||
      last.latitude !==
        currentDriverLocation.latitude ||
      last.longitude !==
        currentDriverLocation.longitude;

    if (changed) {
      gpsLocations.push({
        latitude:
          currentDriverLocation.latitude,

        longitude:
          currentDriverLocation.longitude,
      });
    }
  }

  const actualDistanceKm =
    calculateTripDistance(
      gpsLocations
    );

  /* =========================================================
     FINAL FARE
     ========================================================= */

  let gross = 0;

  /* ---------------------------------------------------------
     FULL RIDE
     ---------------------------------------------------------
     Latest pricing is distance-based:
     first 1.2 km = ₹80
     every additional 200 m = ₹2
     */

  if (
    booking.bookingType ===
      "RIDE" &&
    booking.rideType ===
      "FULL_RIDE"
  ) {
    gross =
      fullRideFare(
        actualDistanceKm
      );
  }

  /* ---------------------------------------------------------
     SHARED RIDE
     --------------------------------------------------------- */

  else if (
    booking.bookingType ===
      "RIDE" &&
    booking.rideType ===
      "SHARED_RIDE"
  ) {
    gross =
      sharedFare(
        booking.passengerCount
      );
  }

  /* ---------------------------------------------------------
     CONNECTION RIDE
     ---------------------------------------------------------
     The total connection fare is calculated once for the full
     OSRM route at booking creation. Each leg receives an
     allocated share so the first-kilometre base is not charged
     again at every connection point.
     */

  else if (
    booking.bookingType ===
      "RIDE" &&
    booking.rideType ===
      "CONNECTION_RIDE"
  ) {
    gross = Number(leg.estimatedFare ?? 0);
  }

  /* ---------------------------------------------------------
     GOODS
     --------------------------------------------------------- */

  else if (
    booking.bookingType ===
    "GOODS"
  ) {
    if (
      !booking.goodsVehicleType
    ) {
      throw new Error(
        "Goods vehicle type is missing"
      );
    }

    gross =
      goodsFare({
        km: Math.max(
          1,
          actualDistanceKm
        ),

        vehicleType:
          booking.goodsVehicleType,

        weightKg:
          Number(
            booking.goodsWeightKg ??
              0
          ),

        size:
          booking.goodsSize ??
          "SMALL",

        waitingMinutes:
          Number(
            booking.waitingMinutes ??
              0
          ),
      });
  }

  else {
    throw new Error(
      "Unsupported booking pricing configuration"
    );
  }

  if (
    !Number.isFinite(gross) ||
    gross < 0
  ) {
    throw new Error(
      "Unable to calculate final fare"
    );
  }

  /* =========================================================
     COUPON DISCOUNT
     =========================================================
     Connection Ride leg fares were allocated from the already
     discounted whole-booking fare at booking creation, so the
     coupon must never be applied again to individual legs.
     For other booking types, recalculate the discount against
     the actual final fare so the financial source of truth is
     based on the completed trip.
     */

  if (booking.rideType !== "CONNECTION_RIDE" && booking.coupon) {
    const coupon = booking.coupon;
    let discount = coupon.discountType === "PERCENTAGE"
      ? gross * Number(coupon.discountValue) / 100
      : Number(coupon.discountValue);
    if (coupon.maxDiscount !== null) discount = Math.min(discount, Number(coupon.maxDiscount));
    gross = Math.max(0, Math.round((gross - Math.min(gross, Math.max(0, discount))) * 100) / 100);
  }

  /* =========================================================
     COMMISSION
     =========================================================
     Latest default = 25%
     */

  const rate =
    Number(
      booking.commissionRate ??
        envCommissionRate()
    );

  const commissionAmount =
    commission(
      gross,
      rate
    );

  const earning =
    driverEarning(
      gross,
      rate
    );

  /* =========================================================
     PAYMENT
     ========================================================= */

  const method =
    booking.paymentPreference ??
    "CASH";

  /* =========================================================
     CUSTOMER END REASON
     ========================================================= */

  const customerEndReason =
    String(
      reason ?? ""
    ).trim();

  const isMultiLegJourney =
    booking.bookingType === "RIDE" &&
    (booking.rideType === "CONNECTION_RIDE" || booking.rideType === "FULL_RIDE") &&
    booking.legs.length > 1;

  const nextConnectionLeg =
    isMultiLegJourney
      ? booking.legs.find(
          (item) =>
            item.sequence > leg.sequence &&
            item.status !== "COMPLETED" &&
            item.status !== "CANCELLED"
        ) ?? null
      : null;

  const hasNextConnectionLeg =
    Boolean(nextConnectionLeg);

  /* =========================================================
     DATABASE TRANSACTION
     ========================================================= */

  const result =
    await prisma.$transaction(
      async (tx) => {
        /* ---------------------------------------------------
           RE-CHECK BOOKING
           --------------------------------------------------- */

        const currentBooking =
          await tx.booking.findUnique({
            where: {
              id: bookingId,
            },
          });

        if (!currentBooking) {
          throw new Error(
            "Booking not found during finalization"
          );
        }

        /**
         * Another request completed the ride
         * while this request was processing.
         */

        if (
          currentBooking.status ===
          "COMPLETED"
        ) {
          return {
            alreadyCompleted: true,
            booking:
              currentBooking,
            payment: null,
            earningRecord: null,
            trip: null,
            updatedLeg: null,
            nextLegId: null,
          };
        }

        if (
          currentBooking.status !==
          "IN_PROGRESS"
        ) {
          throw new Error(
            `Booking changed to ${currentBooking.status}`
          );
        }

        /* ---------------------------------------------------
           RE-CHECK ACTIVE LEG / TRIP
           ---------------------------------------------------
           Prevent two concurrent finalize calls from settling the
           same leg twice. The outer booking snapshot is not enough
           because both requests can start from the same IN_PROGRESS
           state.
           --------------------------------------------------- */

        const currentLeg =
          await tx.bookingLeg.findUnique({
            where: {
              id: leg.id,
            },
            include: {
              trip: true,
            },
          });

        if (!currentLeg) {
          throw new Error(
            "Active booking leg not found during finalization"
          );
        }

        if (currentLeg.status === "COMPLETED") {
          return {
            alreadyCompleted: true,
            booking: currentBooking,
            payment: null,
            earningRecord: null,
            trip: currentLeg.trip,
            updatedLeg: currentLeg,
            nextLegId: null,
          };
        }

        if (currentLeg.status !== "IN_PROGRESS" && currentLeg.status !== "STARTED") {
          throw new Error(
            `Booking leg changed to ${currentLeg.status}`
          );
        }

        if (!currentLeg.trip || currentLeg.trip.status === "COMPLETED") {
          return {
            alreadyCompleted: true,
            booking: currentBooking,
            payment: null,
            earningRecord: null,
            trip: currentLeg.trip,
            updatedLeg: currentLeg,
            nextLegId: null,
          };
        }

        /* ---------------------------------------------------
           FINAL GPS EVENT
           --------------------------------------------------- */

        if (
          currentDriverLocation
        ) {
          await tx.tripLocationEvent.create({
            data: {
              tripId:
                currentLeg.trip!.id,

              latitude:
                currentDriverLocation.latitude,

              longitude:
                currentDriverLocation.longitude,

              accuracy:
                currentDriverLocation.accuracy,

              recordedAt:
                completedAt,
            },
          });
        }

        /* ---------------------------------------------------
           TRIP
           --------------------------------------------------- */

        const trip =
          await tx.trip.update({
            where: {
              id: currentLeg.trip!.id,
            },

            data: {
              status:
                "COMPLETED",

              completedAt,
            },
          });

        /* ---------------------------------------------------
           LEG
           --------------------------------------------------- */

        const updatedLeg =
          await tx.bookingLeg.update({
            where: {
              id: currentLeg.id,
            },

            data: {
              status:
                "COMPLETED",

              finalFare:
                gross,
            },
          });

        /* ---------------------------------------------------
           BOOKING / CONNECTION ORCHESTRATION
           --------------------------------------------------- */

        const completeWholeBooking =
          !isMultiLegJourney ||
          !hasNextConnectionLeg ||
          source === "CUSTOMER";

        // For Connection Ride, the booking final fare is the sum of
        // completed/consumed leg fares. When the customer ends early,
        // future unused legs remain CANCELLED and contribute ₹0.
        const connectionBookingFinalFare =
          isMultiLegJourney
            ? booking.legs.reduce(
                (sum, item) =>
                  sum +
                  (item.id === leg.id
                    ? gross
                    : Number(item.finalFare ?? 0)),
                0
              )
            : gross;

        const updatedBooking =
          await tx.booking.update({
            where: {
              id: booking.id,
            },
            data: {
              status:
                completeWholeBooking
                  ? "COMPLETED"
                  : "MATCHING",
              finalFare:
                completeWholeBooking
                  ? connectionBookingFinalFare
                  : null,
              assignedDriverId:
                completeWholeBooking
                  ? booking.assignedDriverId
                  : null,
              vehicleId:
                completeWholeBooking
                  ? booking.vehicleId
                  : null,
              commissionRate: rate,
              ...(source === "CUSTOMER"
                ? {
                    cancelReason:
                      `CUSTOMER_ENDED_RIDE: ${
                        customerEndReason ||
                        "No reason provided"
                      }`,
                  }
                : {}),
            },
          });

        if (
          !completeWholeBooking &&
          nextConnectionLeg
        ) {
          await tx.bookingLeg.update({
            where: {
              id: nextConnectionLeg.id,
            },
            data: {
              status: "NEW",
              driverId: null,
              vehicleId: null,
            },
          });
        }

        if (
          completeWholeBooking &&
          isMultiLegJourney &&
          source === "CUSTOMER"
        ) {
          await tx.bookingLeg.updateMany({
            where: {
              bookingId: booking.id,
              status: {
                notIn: ["COMPLETED"],
              },
            },
            data: {
              status: "CANCELLED",
            },
          });
        }

        /* ---------------------------------------------------
           DRIVER AVAILABLE
           --------------------------------------------------- */

        await tx.driver.update({
          where: {
            id: request.driverId,
          },

          data: {
            driverStatus:
              "ONLINE",

            totalRides: {
              increment: 1,
            },
          },
        });

        /* ---------------------------------------------------
           PAYMENT STATE
           ---------------------------------------------------
           Final payment/ledger creation is handled once below,
           after driver earning aggregation is complete.
           --------------------------------------------------- */

        let payment = await tx.payment.findUnique({
          where: { bookingId: booking.id },
        });

        /* ---------------------------------------------------
           DRIVER EARNING
           ---------------------------------------------------
           Keep one aggregate earning row per booking + driver.
           A Connection Ride driver may complete more than one leg,
           so later legs must ADD to the driver's existing booking
           earning instead of overwriting the earlier leg amount.
           --------------------------------------------------- */

        const earningRecord =
          await tx.driverEarning.upsert({
            where: {
              bookingId_driverId: {
                bookingId: booking.id,
                driverId: request.driverId,
              },
            },

            create: {
              bookingId: booking.id,
              driverId: request.driverId,
              grossFare: gross,
              commission: commissionAmount,
              netEarning: earning,
              status: "AVAILABLE",
            },

            update: {
              grossFare: {
                increment: gross,
              },
              commission: {
                increment: commissionAmount,
              },
              netEarning: {
                increment: earning,
              },
              status: "AVAILABLE",
            },
          });

        /* ---------------------------------------------------
           COMMISSION ENTRY
           ---------------------------------------------------
           Keep one aggregate commission record per booking +
           driver. A driver doing multiple Connection legs must
           accumulate grossFare/amount across those legs.
           --------------------------------------------------- */

        const existingCommission =
          await tx.commissionEntry.findFirst({
            where: {
              bookingId: booking.id,
              driverId: request.driverId,
            },
          });

        if (!existingCommission) {
          await tx.commissionEntry.create({
            data: {
              bookingId: booking.id,
              driverId: request.driverId,
              grossFare: gross,
              rate,
              amount: commissionAmount,
            },
          });
        } else {
          await tx.commissionEntry.update({
            where: {
              id: existingCommission.id,
            },
            data: {
              grossFare: {
                increment: gross,
              },
              amount: {
                increment: commissionAmount,
              },
              rate,
            },
          });
        }

        /* ---------------------------------------------------
           FINAL CUSTOMER PAYMENT / CASH / LEDGER
           ---------------------------------------------------
           IMPORTANT: Connection Ride does NOT create the final
           booking payment/ledger until the whole booking is done
           (or the customer explicitly ends the ride). This avoids
           touching payment.id while payment is still null on an
           intermediate leg.
           --------------------------------------------------- */

        if (completeWholeBooking) {
          const bookingGross =
            isMultiLegJourney
              ? connectionBookingFinalFare
              : gross;

          const paymentStatus =
            method === "CASH"
              ? "SUCCESS"
              : payment?.status === "SUCCESS"
                ? "SUCCESS"
                : "PENDING";

          payment =
            await tx.payment.upsert({
              where: {
                bookingId: booking.id,
              },
              create: {
                bookingId: booking.id,
                customerId: booking.customerId,
                amount: bookingGross,
                method,
                status: paymentStatus,
                paidAt:
                  paymentStatus === "SUCCESS"
                    ? completedAt
                    : null,
              },
              update: {
                amount: bookingGross,
                method,
                status: paymentStatus,
                paidAt:
                  paymentStatus === "SUCCESS"
                    ? completedAt
                    : payment?.paidAt ?? null,
              },
            });

          if (method === "CASH") {
            const existingCash =
              await tx.cashCollection.findFirst({
                where: {
                  bookingId: booking.id,
                },
              });

            if (!existingCash) {
              await tx.cashCollection.create({
                data: {
                  bookingId: booking.id,
                  driverId: request.driverId,
                  amount: bookingGross,
                  collectedAt: completedAt,
                  verified: false,
                },
              });
            }
          }

          const ledgerExists =
            await tx.ledgerEntry.findFirst({
              where: {
                bookingId: booking.id,
                type: "PAYMENT",
              },
            });

          if (!ledgerExists) {
            const totalCommission =
              commission(bookingGross, rate);

            const bookingEarnings =
              isMultiLegJourney
                ? await tx.driverEarning.findMany({
                    where: {
                      bookingId: booking.id,
                    },
                  })
                : [];

            const ledgerRows: any[] = [
              {
                bookingId: booking.id,
                paymentId: payment.id,
                type: "PAYMENT",
                direction: "CREDIT",
                amount: bookingGross,
                description: `Payment ${method}`,
              },
              {
                bookingId: booking.id,
                driverId: isMultiLegJourney
                  ? undefined
                  : request.driverId,
                type: "COMMISSION",
                direction: "DEBIT",
                amount: totalCommission,
                description: "RideX commission",
              },
            ];

            if (isMultiLegJourney) {
              for (const earningRow of bookingEarnings) {
                ledgerRows.push({
                  bookingId: booking.id,
                  driverId: earningRow.driverId,
                  type: "DRIVER_EARNING",
                  direction: "DEBIT",
                  amount: earningRow.netEarning,
                  description: "Driver earning",
                });
              }
            } else {
              ledgerRows.push({
                bookingId: booking.id,
                driverId: request.driverId,
                type: "DRIVER_EARNING",
                direction: "DEBIT",
                amount: driverEarning(
                  bookingGross,
                  rate
                ),
                description: "Driver earning",
              });
            }

            await tx.ledgerEntry.createMany({
              data: ledgerRows,
            });
          }
        }

        /* ---------------------------------------------------
           RETURN
           --------------------------------------------------- */

        return {
          alreadyCompleted:
            false,

          booking:
            updatedBooking,

          payment,

          earningRecord,

          trip,

          updatedLeg,

          nextLegId:
            completeWholeBooking
              ? null
              : nextConnectionLeg?.id ?? null,
        };
      }
    );

  let nextMatching: unknown = null;

  if (
    result.nextLegId &&
    isMultiLegJourney &&
    source === "DRIVER"
  ) {
    nextMatching =
      await findAndAssignDriver(
        booking.id,
        result.nextLegId
      );
  }

  /* =========================================================
     RESPONSE
     ========================================================= */

  if (
    result.alreadyCompleted
  ) {
    const storedRate =
      Number(
        booking.commissionRate ??
          envCommissionRate()
      );

    const storedGross =
      Number(
        booking.finalFare ?? 0
      );

    return {
      alreadyCompleted: true,

      bookingId:
        booking.id,

      bookingStatus:
        "COMPLETED",

      grossFare:
        storedGross,

      commission:
        commission(
          storedGross,
          storedRate
        ),

      commissionRate:
        `${storedRate * 100}%`,

      driverEarning:
        null,

      actualDistanceKm:
        null,

      actualDurationMinutes:
        null,

      tripId:
        leg.trip?.id,

      driverId:
        currentDriverId,

      source,
    };
  }

  return {
    bookingId:
      booking.id,

    bookingStatus:
      result.booking.status,

    grossFare:
      gross,

    commission:
      commissionAmount,

    commissionRate:
      `${rate * 100}%`,

    driverEarning:
      earning,

    actualDistanceKm,

    actualDurationMinutes:
      durationMinutes,

    tripId:
      result.trip?.id ??
      leg.trip!.id,

    payment:
      result.payment,

    earning:
      result.earningRecord,

    driverId:
      request.driverId,

    source,

    nextLegId:
      result.nextLegId ?? null,

    nextMatching,

    alreadyCompleted:
      false,

    reason:
      source === "CUSTOMER"
        ? customerEndReason ||
          null
        : null,
  };
}
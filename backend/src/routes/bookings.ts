import { Router } from "express";
import { randomInt } from "node:crypto";

import { prisma } from "../lib/prisma";

import { findAndAssignDriver } from "../services/matching";

import {
  DEFAULT_RIDEX_COMMISSION_RATE,
  distanceFare,
  fullRideFare,
  goodsFare,
  sharedFare,
} from "../services/pricing";

import { roadRoute } from "../services/routing";

import { finalizeTrip } from "../services/finalizeTrip";
import { buildConnectionPlan } from "../services/connectionRouting";
import { assertSameCityZone } from "../services/cityZones";
import { applySmartPricing } from "../services/smartPricing";
import { validateCoupon } from "../services/coupons";

const router = Router();

/* =========================================================
   HELPERS
   ========================================================= */

const pin = () =>
  String(randomInt(1000, 10000));

const RIDEX_PRICING_VERSION =
  "ridex-final-v1";

function normalizeStops(
  stops: unknown
): {
  address?: string;
  lat: number;
  lng: number;
}[] {
  if (!Array.isArray(stops)) {
    return [];
  }

  return stops
    .filter((stop: any) => {
      if (!stop) {
        return false;
      }

      const lat = Number(stop.lat);
      const lng = Number(stop.lng);

      return (
        Number.isFinite(lat) &&
        Number.isFinite(lng)
      );
    })
    .map((stop: any) => ({
      address: stop.address
        ? String(stop.address)
        : undefined,

      lat: Number(stop.lat),

      lng: Number(stop.lng),
    }));
}

async function calculateRoadRoute(
  input: {
    pickupLat: number;
    pickupLng: number;
    dropLat: number;
    dropLng: number;
    stops?: unknown;
  }
) {
  const routeStops =
    normalizeStops(
      input.stops
    );

  return roadRoute(
    {
      lat: input.pickupLat,
      lng: input.pickupLng,
    },

    {
      lat: input.dropLat,
      lng: input.dropLng,
    },

    routeStops.map(
      (stop) => ({
        lat: stop.lat,
        lng: stop.lng,
      })
    )
  );
}

function getCommissionRate() {
  const value = Number(
    process.env.RIDEX_COMMISSION_RATE
  );

  if (
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  ) {
    return value;
  }

  return 0.25;
}

/* =========================================================
   AUTO CANCEL PICKUP WAIT
   ========================================================= */

const autoCancelIfExpired =
  async (booking: any) => {
    if (
      booking.status !==
        "DRIVER_ARRIVED" ||
      !booking.pickupWaitExpiresAt ||
      new Date() <
        booking.pickupWaitExpiresAt
    ) {
      return booking;
    }

    const cancelledAt = new Date();

    await prisma.$transaction(
      async (tx) => {
        /*
         * Re-check inside the transaction so two simultaneous GETs
         * cannot perform the same pickup-wait cancellation twice.
         */
        const current =
          await tx.booking.findUnique({
            where: {
              id: booking.id,
            },

            select: {
              id: true,
              status: true,
              pickupWaitExpiresAt: true,
              assignedDriverId: true,
              vehicleId: true,
              legs: {
                select: {
                  id: true,
                  status: true,
                  driverId: true,
                },
              },
            },
          });

        if (
          !current ||
          current.status !==
            "DRIVER_ARRIVED" ||
          !current.pickupWaitExpiresAt ||
          new Date() <
            current.pickupWaitExpiresAt
        ) {
          return;
        }

        const releasableLegs =
          current.legs.filter(
            (leg) =>
              leg.status !==
                "COMPLETED" &&
              leg.status !==
                "CANCELLED" &&
              leg.status !==
                "STARTED" &&
              leg.status !==
                "IN_PROGRESS"
          );

        const releasableLegIds =
          releasableLegs.map(
            (leg) => leg.id
          );

        const driverIds = Array.from(
          new Set(
            releasableLegs
              .map(
                (leg) =>
                  leg.driverId
              )
              .filter(
                (
                  driverId
                ): driverId is string =>
                  Boolean(driverId)
              )
          )
        );

        await tx.booking.update({
          where: {
            id: current.id,
          },

          data: {
            status:
              "CANCELLED",

            autoCancelledAt:
              cancelledAt,

            cancelReason:
              "CUSTOMER_DID_NOT_ARRIVE_WITHIN_WAIT_TIME",

            assignedDriverId:
              null,

            vehicleId:
              null,
          },
        });

        if (
          releasableLegIds.length > 0
        ) {
          await tx.bookingLeg.updateMany({
            where: {
              id: {
                in: releasableLegIds,
              },

              status: {
                notIn: [
                  "COMPLETED",
                  "CANCELLED",
                  "STARTED",
                  "IN_PROGRESS",
                ],
              },
            },

            data: {
              status:
                "CANCELLED",
              driverId: null,
              vehicleId: null,
            },
          });

          /*
           * Any pending/accepted offer for the cancelled legs must
           * also stop being actionable by the Driver App.
           */
          await tx.rideRequest.updateMany({
            where: {
              legId: {
                in: releasableLegIds,
              },

              status: {
                in: [
                  "OFFERED",
                  "ACCEPTED",
                ],
              },
            },

            data: {
              status:
                "CANCELLED",
              respondedAt:
                cancelledAt,
            },
          });
        }

        /*
         * Release every driver that belonged to the cancelled
         * pre-start legs, but do not overwrite a driver that is
         * currently active on another booking or suspended.
         */
        for (
          const driverId of driverIds
        ) {
          const otherActiveLeg =
            await tx.bookingLeg.findFirst({
              where: {
                driverId,
                bookingId: {
                  not: current.id,
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

          if (!otherActiveLeg) {
            await tx.driver.updateMany({
              where: {
                id: driverId,
                driverStatus: {
                  not: "SUSPENDED",
                },
              },

              data: {
                driverStatus:
                  "ONLINE",
              },
            });
          }
        }
      }
    );

    /*
     * Keep the shape expected by GET /booking/:bookingId while
     * reflecting the cancellation immediately in the already
     * loaded response object.
     */
    booking.status =
      "CANCELLED";
    booking.autoCancelledAt =
      cancelledAt;
    booking.cancelReason =
      "CUSTOMER_DID_NOT_ARRIVE_WITHIN_WAIT_TIME";
    booking.assignedDriverId =
      null;
    booking.vehicleId =
      null;

    if (Array.isArray(booking.legs)) {
      booking.legs =
        booking.legs.map(
          (leg: any) => {
            const cancellable =
              leg.status !==
                "COMPLETED" &&
              leg.status !==
                "CANCELLED" &&
              leg.status !==
                "STARTED" &&
              leg.status !==
                "IN_PROGRESS";

            if (!cancellable) {
              return leg;
            }

            return {
              ...leg,
              status:
                "CANCELLED",
              driverId: null,
              vehicleId: null,
              driver: null,
              vehicle: null,
            };
          }
        );
    }

    if (
      Array.isArray(
        booking.rideRequests
      )
    ) {
      booking.rideRequests =
        booking.rideRequests.map(
          (request: any) =>
            request.status ===
              "OFFERED" ||
            request.status ===
              "ACCEPTED"
              ? {
                  ...request,
                  status:
                    "CANCELLED",
                  respondedAt:
                    cancelledAt,
                }
              : request
        );
    }

    if (booking.assignedDriver) {
      booking.assignedDriver =
        null;
    }

    if (booking.vehicle) {
      booking.vehicle =
        null;
    }

    return booking;
  };

/* =========================================================
   CREATE BOOKING
   ========================================================= */

router.post(
  "/",
  async (req, res) => {
    try {
      const {
        customerId,

        bookingType = "RIDE",
        rideType,

        pickupAddress,
        pickupLat,
        pickupLng,

        dropAddress,
        dropLat,
        dropLng,

        passengerCount = 1,

        pickupDatetime,
        timezone,

        isScheduled = false,

        paymentMethod,
        paymentPreference,

        goodsVehicleType,
        goodsType,
        goodsWeightKg,
        goodsSize,
        serviceSubtype,
        durationMinutes,
        parcelItems,

        receiverName,
        receiverMobile,

        loadingInstructions,
        unloadingInstructions,

        waitingMinutes = 0,

        specialInstructions,
        stops,

        rebookOfId,
        couponCode,
      } = req.body;

      /* =====================================================
         BASIC VALIDATION
         ===================================================== */

      if (
        !customerId ||
        !pickupAddress ||
        !dropAddress ||
        pickupLat === undefined ||
        pickupLng === undefined ||
        dropLat === undefined ||
        dropLng === undefined
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Customer and pickup/drop details are required",
        });
      }

      /* =====================================================
         CUSTOMER EXISTS
         ===================================================== */

      const customer =
        await prisma.customer.findUnique({
          where: {
            id: String(customerId),
          },
        });

      if (!customer) {
        return res.status(404).json({
          success: false,
          message:
            "Customer not found",
        });
      }

      /* =====================================================
         COORDINATES
         ===================================================== */

      const pickupLatitude =
        Number(pickupLat);

      const pickupLongitude =
        Number(pickupLng);

      const dropLatitude =
        Number(dropLat);

      const dropLongitude =
        Number(dropLng);

      if (
        !Number.isFinite(
          pickupLatitude
        ) ||
        !Number.isFinite(
          pickupLongitude
        ) ||
        !Number.isFinite(
          dropLatitude
        ) ||
        !Number.isFinite(
          dropLongitude
        )
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Invalid pickup or drop coordinates",
        });
      }

      /* =====================================================
         BOOKING TYPE
         ===================================================== */

      if (
        ![
          "RIDE",
          "GOODS",
        ].includes(
          String(bookingType)
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid booking type",
        });
      }

      /* =====================================================
         RIDE TYPE
         ===================================================== */

      if (
        bookingType === "RIDE" &&
        ![
          "FULL_RIDE",
          "SHARED_RIDE",
          "CONNECTION_RIDE",
        ].includes(
          String(rideType)
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid ride type",
        });
      }

      /* =====================================================
         SCHEDULED BOOKING
         ===================================================== */

      const scheduled =
        Boolean(
          isScheduled
        );

      if (
        scheduled &&
        (
          bookingType !==
          "RIDE" ||
          rideType !==
          "FULL_RIDE"
        )
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Only Full Ride can be scheduled",
        });
      }

      let normalizedPickupDatetime:
        Date | null = null;

      if (
        scheduled
      ) {
        if (!pickupDatetime) {
          return res.status(400).json({
            success: false,

            message:
              "Scheduled pickup date and time are required",
          });
        }

        const parsed =
          new Date(
            pickupDatetime
          );

        if (
          Number.isNaN(
            parsed.getTime()
          )
        ) {
          return res.status(400).json({
            success: false,

            message:
              "Invalid scheduled pickup date/time",
          });
        }

        if (
          parsed.getTime() <=
          Date.now()
        ) {
          return res.status(400).json({
            success: false,

            message:
              "Scheduled pickup time must be in the future",
          });
        }

        normalizedPickupDatetime =
          parsed;
      }

      /* =====================================================
         PASSENGER RULES
         ===================================================== */

      const requestedPassengers =
        Number(
          passengerCount
        );

      if (
        !Number.isFinite(
          requestedPassengers
        )
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Invalid passenger count",
        });
      }

      let normalizedPassengerCount =
        1;

      if (
        bookingType ===
        "RIDE"
      ) {
        if (
          rideType ===
            "SHARED_RIDE" ||
          rideType ===
            "CONNECTION_RIDE"
        ) {
          if (
            requestedPassengers <
              1 ||
            requestedPassengers >
              4 ||
            !Number.isInteger(
              requestedPassengers
            )
          ) {
            return res.status(400).json({
              success: false,

              message:
                "Shared/Connection Ride supports 1 to 4 passengers",
            });
          }

          normalizedPassengerCount =
            requestedPassengers;
        } else {
          /**
           * FULL RIDE
           *
           * Passenger count is not a business input.
           */
          normalizedPassengerCount =
            1;
        }
      } else {
        /**
         * GOODS
         *
         * Passenger count is not used.
         */
        normalizedPassengerCount =
          1;
      }

      /* =====================================================
         GOODS VEHICLE
         ===================================================== */

      if (
        bookingType ===
        "GOODS"
      ) {
        const subtype = String(serviceSubtype || "GOODS").trim().toUpperCase();
        if (!['PARCEL','GOODS'].includes(subtype)) {
          return res.status(400).json({ success: false, message: "serviceSubtype must be PARCEL or GOODS" });
        }

        const requestedVehicle = String(goodsVehicleType || "").toUpperCase();
        if (subtype === "PARCEL" && requestedVehicle !== "E_RICKSHAW") {
          return res.status(400).json({ success:false, message:"Parcel can only be booked with a Passenger E-Rickshaw" });
        }
        if (subtype === "GOODS" && requestedVehicle !== "PICKUP_TRUCK") {
          return res.status(400).json({ success:false, message:"Goods can only be booked with the Battery Pickup Truck" });
        }

        if (
          !String(
            goodsType || ""
          ).trim()
        ) {
          return res.status(400).json({
            success: false,

            message:
              "Goods type is required",
          });
        }
      }

      /* =====================================================
         GOODS WEIGHT
         ===================================================== */

      const normalizedWeight =
        Number(
          goodsWeightKg || 0
        );

      if (
        !Number.isFinite(
          normalizedWeight
        ) ||
        normalizedWeight < 0
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Invalid goods weight",
        });
      }


      /* =====================================================
         WAITING
         ===================================================== */

      const normalizedWaiting =
        Number(
          waitingMinutes || 0
        );

      if (
        !Number.isFinite(
          normalizedWaiting
        ) ||
        normalizedWaiting < 0
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Invalid waiting minutes",
        });
      }

      const normalizedDurationMinutes = Number(durationMinutes || 0);
      if (!Number.isFinite(normalizedDurationMinutes) || normalizedDurationMinutes < 0) {
        return res.status(400).json({ success: false, message: "Invalid booking duration" });
      }

      const normalizedServiceSubtype = String(serviceSubtype || (bookingType === "GOODS" ? "GOODS" : "PASSENGER")).trim().toUpperCase();
      if (bookingType === "GOODS" && !["PARCEL", "GOODS"].includes(normalizedServiceSubtype)) {
        return res.status(400).json({ success: false, message: "Goods serviceSubtype must be PARCEL or GOODS" });
      }
      if (bookingType === "GOODS") {
        const selectedVehicle = String(goodsVehicleType || "").toUpperCase();
        if (normalizedServiceSubtype === "PARCEL" && selectedVehicle !== "E_RICKSHAW") return res.status(400).json({success:false,message:"Parcel requires Passenger E-Rickshaw"});
        if (normalizedServiceSubtype === "GOODS" && selectedVehicle !== "PICKUP_TRUCK") return res.status(400).json({success:false,message:"Goods requires Battery Pickup Truck"});
      }
      if (bookingType === "GOODS" && normalizedServiceSubtype === "PARCEL" && (normalizedWeight < 1 || normalizedWeight > 300)) {
        return res.status(400).json({ success:false, message:"Parcel weight must be between 1 kg and 300 kg" });
      }
      if (bookingType === "GOODS" && normalizedServiceSubtype === "PARCEL") {
        if (normalizedWeight < 1 || normalizedWeight > 300) {
          return res.status(400).json({ success: false, message: "Parcel weight must be between 1 kg and 300 kg" });
        }
        if (goodsVehicleType === "PICKUP_TRUCK") {
          return res.status(400).json({ success: false, message: "Parcel service uses the eligible E-Rickshaw parcel vehicle, not the Goods Pickup Truck" });
        }
      }

      if (bookingType === "RIDE" && rideType === "SHARED_RIDE") {
        const zoneCheck = await assertSameCityZone([
          { lat: pickupLatitude, lng: pickupLongitude },
          { lat: dropLatitude, lng: dropLongitude },
        ]);
        // Zones are enforced when at least one configured zone matches;
        // this keeps legacy/test installations working before zones are seeded.
        if (zoneCheck.zones.some(Boolean) && !zoneCheck.same) {
          return res.status(400).json({ success: false, message: "Shared Ride pickup and destination must remain inside the same city service zone" });
        }
      }

      /* =====================================================
         ROAD ROUTE
         ===================================================== */

      let routeDistanceKm = 0;

      let routeDurationMinutes =
        0;

      let connectionPlan:
        | Awaited<
            ReturnType<
              typeof buildConnectionPlan
            >
          >
        | null = null;

      try {
        if (
          bookingType === "RIDE" &&
          (rideType === "CONNECTION_RIDE" || rideType === "FULL_RIDE")
        ) {
          connectionPlan =
            await buildConnectionPlan({
              pickupLat: pickupLatitude,
              pickupLng: pickupLongitude,
              dropLat: dropLatitude,
              dropLng: dropLongitude,
            });

          routeDistanceKm =
            connectionPlan.distanceKm;

          routeDurationMinutes =
            connectionPlan.durationMinutes;
        } else {
          const route =
            await calculateRoadRoute({
              pickupLat:
                pickupLatitude,

              pickupLng:
                pickupLongitude,

              dropLat:
                dropLatitude,

              dropLng:
                dropLongitude,

              stops,
            });

          routeDistanceKm =
            route.distanceKm;

          routeDurationMinutes =
            route.durationMinutes;
        }
      } catch (routingError) {
        console.error(
          "BOOKING ROUTING ERROR:",
          routingError
        );

        return res.status(503).json({
          success: false,

          message:
            "Unable to calculate road route right now",
        });
      }

      /* =====================================================
         BACKEND PRICING
         ===================================================== */

      let fare = 0;

      /* -----------------------------------------------------
         FULL RIDE
         ----------------------------------------------------- */

      if (
        bookingType ===
          "RIDE" &&
        rideType ===
          "FULL_RIDE"
      ) {
        fare =
          fullRideFare(
            routeDistanceKm
          );
      }

      /* -----------------------------------------------------
         SHARED RIDE
         ----------------------------------------------------- */

      else if (
        bookingType ===
          "RIDE" &&
        rideType ===
          "SHARED_RIDE"
      ) {
        fare =
          sharedFare(
            normalizedPassengerCount
          );
      }

      /* -----------------------------------------------------
         CONNECTION RIDE
         ----------------------------------------------------- */

      else if (
        bookingType ===
          "RIDE" &&
        rideType ===
          "CONNECTION_RIDE"
      ) {
        fare =
          distanceFare(
            Math.max(
              1,
              routeDistanceKm
            ),

            normalizedPassengerCount
          );
      }

      /* -----------------------------------------------------
         GOODS
         ----------------------------------------------------- */

      else if (
        bookingType ===
        "GOODS"
      ) {
        fare =
          goodsFare({
            km: Math.max(
              1,
              routeDistanceKm
            ),

            vehicleType:
              goodsVehicleType,

            weightKg:
              normalizedWeight,

            size:
              goodsSize,

            waitingMinutes:
              normalizedWaiting,
          });
      }

      const smartPrice = await applySmartPricing({
        baseFare: fare,
        distanceKm: routeDistanceKm,
        durationMinutes: normalizedDurationMinutes || routeDurationMinutes,
        bookingType: bookingType as any,
        rideType: bookingType === "RIDE" ? (rideType as any) : null,
        vehicleType: bookingType === "GOODS" ? (goodsVehicleType as any) : "E_RICKSHAW" as any,
        weightKg: bookingType === "GOODS" ? normalizedWeight : undefined,
      });
      fare = smartPrice.fare;

      if (
        !Number.isFinite(
          fare
        ) ||
        fare < 0
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Unable to calculate booking fare",
        });
      }

      /* =====================================================
         COUPON VALIDATION
         ===================================================== */

      let couponResult: Awaited<ReturnType<typeof validateCoupon>> | null = null;
      if (String(couponCode ?? "").trim()) {
        try {
          couponResult = await validateCoupon({
            code: String(couponCode),
            customerId: String(customerId),
            bookingType: bookingType as "RIDE" | "GOODS",
            rideType: bookingType === "RIDE" ? String(rideType) : null,
            fare,
          });
          fare = couponResult.payableFare;
        } catch (couponError) {
          return res.status(400).json({
            success: false,
            message: couponError instanceof Error ? couponError.message : String(couponError),
          });
        }
      }

      /* =====================================================
         COMMISSION SNAPSHOT
         ===================================================== */

      const commissionRate =
        getCommissionRate();

      /* =====================================================
         INITIAL STATUS
         ===================================================== */

      /*
       * The Prisma BookingStatus enum has no separate UPCOMING
       * value. Scheduled state is represented by NEW + isScheduled.
       */
      const initialStatus =
        "NEW";

      /* =====================================================
         CONNECTION LEG FARE ALLOCATION
         ===================================================== */

      const connectionLegFare =
        (legDistanceKm: number, index: number) => {
          if (
            !connectionPlan ||
            connectionPlan.legs.length <= 1
          ) {
            return fare;
          }

          const isLast =
            index ===
            connectionPlan.legs.length - 1;

          if (isLast) {
            const allocatedBefore =
              connectionPlan.legs
                .slice(0, index)
                .reduce(
                  (sum, legItem) =>
                    sum +
                    fare *
                      (legItem.distanceKm /
                        connectionPlan!.distanceKm),
                  0
                );

            return Math.max(
              0,
              fare - allocatedBefore
            );
          }

          return (
            fare *
            (legDistanceKm /
              connectionPlan.distanceKm)
          );
        };

      /* =====================================================
         CREATE BOOKING
         ===================================================== */

      const booking =
        await prisma.booking.create({
          data: {
            customerId:
              String(
                customerId
              ),

            bookingType:
              bookingType as any,

            rideType:
              bookingType ===
              "RIDE"
                ? (rideType as any)
                : null,

            status:
              initialStatus,

            pickupAddress:
              String(
                pickupAddress
              ),

            pickupLat:
              pickupLatitude,

            pickupLng:
              pickupLongitude,

            dropAddress:
              String(
                dropAddress
              ),

            dropLat:
              dropLatitude,

            dropLng:
              dropLongitude,

            passengerCount:
              normalizedPassengerCount,

            pickupDatetime:
              normalizedPickupDatetime,

            timezone:
              timezone
                ? String(
                    timezone
                  )
                : scheduled
                  ? "Asia/Kolkata"
                  : null,

            isScheduled:
              scheduled,

            estimatedFare:
              fare,

            couponId:
              couponResult?.couponId ?? null,
            couponCode:
              couponResult?.code ?? null,
            couponDiscount:
              couponResult?.discount ?? 0,

            pricingVersion:
              RIDEX_PRICING_VERSION,

            commissionRate:
              commissionRate,

            paymentPreference:
              (
                paymentPreference ||
                paymentMethod ||
                "CASH"
              ) as any,

            /* ------------------------------------------------
               GOODS
               ------------------------------------------------ */

            goodsVehicleType:
              bookingType ===
              "GOODS"
                ? (goodsVehicleType as any)
                : null,

            goodsType:
              bookingType ===
              "GOODS"
                ? String(
                    goodsType
                  ).trim()
                : null,

            goodsWeightKg:
              bookingType ===
              "GOODS"
                ? normalizedWeight
                : null,

            goodsSize:
              bookingType ===
              "GOODS"
                ? (goodsSize as any)
                : null,

            receiverName:
              bookingType ===
              "GOODS"
                ? String(
                    receiverName ||
                      ""
                  ).trim()
                : null,

            receiverMobile:
              bookingType ===
              "GOODS"
                ? String(
                    receiverMobile ||
                      ""
                  ).trim()
                : null,

            loadingInstructions:
              bookingType ===
              "GOODS"
                ? loadingInstructions
                : null,

            unloadingInstructions:
              bookingType ===
              "GOODS"
                ? unloadingInstructions
                : null,

            waitingMinutes:
              bookingType ===
              "GOODS"
                ? normalizedWaiting
                : 0,

            requestedDurationMinutes:
              normalizedDurationMinutes > 0 ? normalizedDurationMinutes : null,

            serviceSubtype:
              normalizedServiceSubtype,

            environment:
              String(process.env.RIDEX_ENVIRONMENT || "TEST").toUpperCase() === "LIVE" ? "LIVE" : "TEST",

            specialInstructions:
              specialInstructions
                ? String(
                    specialInstructions
                  )
                : null,

            stops:
              stops !== undefined
                ? stops
                : undefined,

            rebookOfId:
              rebookOfId ||
              null,

            /* ------------------------------------------------
               FIRST LEG
               ------------------------------------------------ */

            legs: {
              create: {
                sequence: 1,

                status:
                  initialStatus,

                pickupAddress:
                  connectionPlan
                    ? connectionPlan.legs[0].pickup.address
                    : String(pickupAddress),

                pickupLat:
                  connectionPlan
                    ? connectionPlan.legs[0].pickup.lat
                    : pickupLatitude,

                pickupLng:
                  connectionPlan
                    ? connectionPlan.legs[0].pickup.lng
                    : pickupLongitude,

                dropAddress:
                  connectionPlan
                    ? connectionPlan.legs[0].drop.address
                    : String(dropAddress),

                dropLat:
                  connectionPlan
                    ? connectionPlan.legs[0].drop.lat
                    : dropLatitude,

                dropLng:
                  connectionPlan
                    ? connectionPlan.legs[0].drop.lng
                    : dropLongitude,

                estimatedFare:
                  connectionPlan
                    ? connectionLegFare(
                        connectionPlan.legs[0].distanceKm,
                        0
                      )
                    : fare,

                tripPin:
                  pin(),
                verificationMethod: "OTP",
                maxDistanceKm:
                  connectionPlan && connectionPlan.legs.length > 1 ? 15 : null,
              },
            },

            /* ------------------------------------------------
               ROUTE RECORD
               ------------------------------------------------ */

            routes: {
              create: {
                distanceKm:
                  routeDistanceKm,

                durationMinutes:
                  routeDurationMinutes,

                geometry:
                  connectionPlan?.geometry ??
                  undefined,

                provider:
                  "OSRM",

                calculatedAt:
                  new Date(),
              },
            },
          },
        });

      /* =====================================================
         CREATE CONNECTION LEGS + ROUTES
         ===================================================== */

      if (
        connectionPlan &&
        connectionPlan.legs.length > 1
      ) {
        await prisma.$transaction(
          async (tx) => {
            for (
              let index = 0;
              index <
                connectionPlan!.legs.length;
              index += 1
            ) {
              const planLeg =
                connectionPlan!.legs[index];

              if (index > 0) {
                await tx.bookingLeg.create({
                  data: {
                    bookingId: booking.id,
                    sequence: planLeg.sequence,
                    status: initialStatus,
                    pickupAddress:
                      planLeg.pickup.address,
                    pickupLat:
                      planLeg.pickup.lat,
                    pickupLng:
                      planLeg.pickup.lng,
                    dropAddress:
                      planLeg.drop.address,
                    dropLat:
                      planLeg.drop.lat,
                    dropLng:
                      planLeg.drop.lng,
                    estimatedFare:
                      connectionLegFare(
                        planLeg.distanceKm,
                        index
                      ),
                    tripPin: pin(),
                    verificationMethod: "OTP",
                    maxDistanceKm: 15,
                  },
                });
              }

              const persistedLeg =
                await tx.bookingLeg.findUnique({
                  where: {
                    bookingId_sequence: {
                      bookingId: booking.id,
                      sequence:
                        planLeg.sequence,
                    },
                  },
                  select: { id: true },
                });

              if (!persistedLeg) {
                throw new Error(
                  `Connection leg ${planLeg.sequence} was not created`
                );
              }

              await tx.route.create({
                data: {
                  bookingId: booking.id,
                  legId: persistedLeg.id,
                  distanceKm:
                    planLeg.distanceKm,
                  durationMinutes:
                    planLeg.durationMinutes,
                  geometry:
                    planLeg.geometry as any,
                  provider:
                    "OSRM_CONNECTION",
                  calculatedAt:
                    new Date(),
                },
              });
            }
          }
        );
      } else {
        /* Normal booking: keep the existing booking route only. */
      }

      if (bookingType === "GOODS" && normalizedServiceSubtype === "PARCEL" && Array.isArray(parcelItems)) {
        const items = parcelItems.map((item: any, index: number) => ({
          bookingId: booking.id, sequence: index + 1, weightKg: Number(item?.weightKg ?? normalizedWeight),
          description: item?.description ? String(item.description) : null,
          pickupAddress: String(item?.pickupAddress ?? pickupAddress), pickupLat: Number(item?.pickupLat ?? pickupLatitude), pickupLng: Number(item?.pickupLng ?? pickupLongitude),
          dropAddress: String(item?.dropAddress ?? dropAddress), dropLat: Number(item?.dropLat ?? dropLatitude), dropLng: Number(item?.dropLng ?? dropLongitude),
          status: "PENDING", receiverName: item?.receiverName ? String(item.receiverName) : null, receiverMobile: item?.receiverMobile ? String(item.receiverMobile) : null,
        })).filter((item: any) => Number.isFinite(item.weightKg) && item.weightKg >= 1 && item.weightKg <= 300);
        if (items.length > 0) await prisma.parcelItem.createMany({ data: items });
      }

      if (bookingType === "RIDE" && rideType === "SHARED_RIDE") {
        await prisma.bookingShareMember.create({ data: { bookingId: booking.id, customerId: String(customerId), seatCount: normalizedPassengerCount, status: "WAITING" } });
      }

      /* =====================================================
         COUPON USAGE
         ===================================================== */

      if (couponResult) {
        try {
          await prisma.$transaction(async (tx) => {
            const alreadyUsed = await tx.couponUsage.findUnique({ where: { bookingId: booking.id } });
            if (alreadyUsed) throw new Error("Coupon has already been recorded for this booking");
            if (couponResult!.couponId) {
              const totalUsed = await tx.couponUsage.count({ where: { couponId: couponResult!.couponId } });
              const coupon = await tx.coupon.findUnique({ where: { id: couponResult!.couponId } });
              if (!coupon) throw new Error("Coupon no longer exists");
              if (coupon.totalUsageLimit !== null && totalUsed >= coupon.totalUsageLimit) throw new Error("Coupon usage limit has been reached");
              if (coupon.perCustomerLimit !== null) {
                const customerUsed = await tx.couponUsage.count({ where: { couponId: coupon.id, customerId: String(customerId) } });
                if (customerUsed >= coupon.perCustomerLimit) throw new Error("You have reached the usage limit for this coupon");
              }
              await tx.couponUsage.create({
                data: { couponId: coupon.id, customerId: String(customerId), bookingId: booking.id, discount: couponResult!.discount },
              });
            }
          }, { isolationLevel: "Serializable" });
        } catch (couponUsageError) {
          await prisma.$transaction(async (tx) => {
            await tx.route.deleteMany({ where: { bookingId: booking.id } });
            await tx.bookingLeg.deleteMany({ where: { bookingId: booking.id } });
            await tx.booking.delete({ where: { id: booking.id } });
          }).catch(() => undefined);
          return res.status(409).json({ success: false, message: couponUsageError instanceof Error ? couponUsageError.message : String(couponUsageError) });
        }
      }

      /* =====================================================
         AUTOMATIC MATCHING
         ===================================================== */

      let matching:
        | any
        | null = null;

      if (
        !scheduled
      ) {
        matching =
          await findAndAssignDriver(
            booking.id
          );
      }

      /* =====================================================
         FRESH BOOKING
         ===================================================== */

      const fresh =
        await prisma.booking.findUnique({
          where: {
            id: booking.id,
          },

          include: {
            legs: true,
            rideRequests: true,
            routes: true,
            parcelItems: true,
            shareMembers: true,
          },
        });

      return res.status(201).json({
        success: true,

        data: {
          booking:
            fresh,

          matching,

          route: {
            distanceKm:
              routeDistanceKm,

            durationMinutes:
              routeDurationMinutes,

            stopCount:
              normalizeStops(
                stops
              ).length,
          },
        },
      });
    } catch (error) {
      console.error(
        "CREATE BOOKING ERROR:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Unable to create booking",

        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   COUPON VALIDATION
   ========================================================= */

router.post("/coupon/validate", async (req, res) => {
  try {
    const customerId = String(req.body?.customerId ?? "").trim();
    const code = String(req.body?.code ?? "").trim();
    const bookingType = String(req.body?.bookingType ?? "RIDE").toUpperCase();
    const rideType = req.body?.rideType ? String(req.body.rideType).toUpperCase() : null;
    const fare = Number(req.body?.fare);
    if (!customerId || !code || !Number.isFinite(fare) || fare < 0) return res.status(400).json({ success: false, message: "customerId, code and valid fare are required" });
    const result = await validateCoupon({ code, customerId, bookingType: bookingType as "RIDE" | "GOODS", rideType, fare });
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(400).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
});

/* =========================================================
   GET BOOKING
   ========================================================= */

router.get(
  "/:bookingId",
  async (req, res) => {
    try {
      let booking =
        await prisma.booking.findUnique({
          where: {
            id: req.params.bookingId,
          },

          include: {
            legs: {
              include: {
                driver: true,
                vehicle: true,
                trip: {
                  include: {
                    locations: {
                      orderBy: {
                        recordedAt:
                          "asc",
                      },
                    },
                  },
                },
              },

              orderBy: {
                sequence:
                  "asc",
              },
            },

            rideRequests: true,

            payment: true,
            paymentAttempts:
              true,
            paymentTransactions:
              true,
            refunds: true,

            driverEarnings:
              true,

            ledgerEntries:
              true,

            ratings: true,

            routes: true,

            tripPassengers:
              true,

            commissionEntries:
              true,

            financialAdjustments:
              true,

            cashCollections:
              true,

            assignedDriver: {
              include: {
                location:
                  true,
              },
            },

            vehicle:
              true,

            supportCases:
              true,

            sosEvents:
              true,
          },
        });

      if (!booking) {
        return res.status(404).json({
          success: false,

          message:
            "Booking not found",
        });
      }

      booking =
        await autoCancelIfExpired(
          booking
        );

      return res.json({
        success: true,

        data: booking,
      });
    } catch (error) {
      console.error(
        "GET BOOKING ERROR:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Unable to fetch booking",
      });
    }
  }
);

/* =========================================================
   CUSTOMER END RIDE
   ========================================================= */

router.post(
  "/:bookingId/customer-end",
  async (req, res) => {
    try {
      const {
        customerId,
        reason,
      } = req.body;

      if (!customerId) {
        return res.status(400).json({
          success: false,

          message:
            "Customer ID is required",
        });
      }

      const customerReason =
        String(
          reason || ""
        ).trim();

      if (!customerReason) {
        return res.status(400).json({
          success: false,

          message:
            "Please provide a reason for ending the ride early",
        });
      }

      const booking =
        await prisma.booking.findUnique({
          where: {
            id: req.params.bookingId,
          },
        });

      if (!booking) {
        return res.status(404).json({
          success: false,

          message:
            "Booking not found",
        });
      }

      if (
        booking.customerId !==
        String(customerId)
      ) {
        return res.status(403).json({
          success: false,

          message:
            "This booking does not belong to this customer",
        });
      }

      if (
        booking.status !==
        "IN_PROGRESS"
      ) {
        if (
          booking.status ===
          "COMPLETED"
        ) {
          return res.json({
            success: true,

            message:
              "Ride already completed",

            data: {
              bookingId:
                booking.id,

              bookingStatus:
                booking.status,

              alreadyCompleted:
                true,

              finalFare:
                booking.finalFare,
            },
          });
        }

        return res.status(400).json({
          success: false,

          message:
            "Ride can be ended by customer only after it has started",
        });
      }

      const result =
        await finalizeTrip({
          bookingId:
            booking.id,

          source:
            "CUSTOMER",

          reason:
            customerReason,
        });

      return res.json({
        success: true,

        message:
          result.alreadyCompleted
            ? "Ride already completed"
            : "Ride ended successfully",

        data: result,
      });
    } catch (error) {
      console.error(
        "CUSTOMER END RIDE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Unable to end ride",

        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

/* =========================================================
   REBOOK
   ========================================================= */

router.post(
  "/:bookingId/rebook",
  async (req, res) => {
    try {
      const customerId =
        String(
          req.body?.customerId ??
            ""
        ).trim();

      if (!customerId) {
        return res.status(400).json({
          success: false,

          message:
            "Customer ID is required",
        });
      }

      const old =
        await prisma.booking.findUnique({
          where: {
            id:
              req.params.bookingId,
          },
        });

      if (!old) {
        return res.status(404).json({
          success: false,

          message:
            "Booking not found",
        });
      }

      if (
        old.customerId !==
        customerId
      ) {
        return res.status(403).json({
          success: false,

          message:
            "This booking does not belong to this customer",
        });
      }

      if (
        old.status !==
        "CANCELLED"
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Rebook is available only after cancellation",
        });
      }

      /* =====================================================
         ROUTE / CONNECTION PLAN
         ===================================================== */

      let routeDistanceKm =
        0;

      let routeDurationMinutes =
        0;

      let connectionPlan:
        | Awaited<ReturnType<typeof buildConnectionPlan>>
        | null = null;

      try {
        if (old.rideType === "CONNECTION_RIDE" || old.rideType === "FULL_RIDE") {
          connectionPlan =
            await buildConnectionPlan({
              pickupLat: old.pickupLat,
              pickupLng: old.pickupLng,
              dropLat: old.dropLat,
              dropLng: old.dropLng,
            });

          routeDistanceKm =
            connectionPlan.distanceKm;

          routeDurationMinutes =
            connectionPlan.durationMinutes;
        } else {
          const route =
            await calculateRoadRoute({
              pickupLat: old.pickupLat,
              pickupLng: old.pickupLng,
              dropLat: old.dropLat,
              dropLng: old.dropLng,
              stops: old.stops,
            });

          routeDistanceKm =
            route.distanceKm;

          routeDurationMinutes =
            route.durationMinutes;
        }
      } catch (routingError) {
        console.error(
          "REBOOK ROUTING ERROR:",
          routingError
        );

        return res.status(503).json({
          success: false,
          message:
            "Unable to calculate route for rebooking",
        });
      }

      /* =====================================================
         FARE
         ===================================================== */

      let fare = 0;

      if (
        old.bookingType ===
        "GOODS"
      ) {
        if (
          !old.goodsVehicleType
        ) {
          return res.status(409).json({
            success: false,

            message:
              "Goods vehicle type is missing",
          });
        }

        fare =
          goodsFare({
            km: Math.max(
              1,
              routeDistanceKm
            ),

            vehicleType:
              old.goodsVehicleType,

            weightKg:
              Number(
                old.goodsWeightKg ??
                  0
              ),

            size:
              old.goodsSize ??
              "SMALL",

            waitingMinutes:
              Number(
                old.waitingMinutes ??
                  0
              ),
          });
      }

      else if (
        old.rideType ===
        "FULL_RIDE"
      ) {
        fare =
          fullRideFare(
            routeDistanceKm
          );
      }

      else if (
        old.rideType ===
        "SHARED_RIDE"
      ) {
        fare =
          sharedFare(
            Math.max(
              1,
              Math.min(
                4,
                old.passengerCount
              )
            )
          );
      }

      else if (
        old.rideType ===
        "CONNECTION_RIDE"
      ) {
        fare =
          distanceFare(
            Math.max(
              1,
              routeDistanceKm
            ),

            Math.max(
              1,
              Math.min(
                4,
                old.passengerCount
              )
            )
          );
      }

      else {
        return res.status(409).json({
          success: false,

          message:
            "Unsupported booking type for rebook",
        });
      }

      const commissionRate =
        getCommissionRate();

      /* =====================================================
         CONNECTION LEG FARE ALLOCATION
         ===================================================== */

      const connectionLegFare =
        (legDistanceKm: number, index: number) => {
          if (
            !connectionPlan ||
            connectionPlan.legs.length <= 1
          ) {
            return fare;
          }

          const isLast =
            index ===
            connectionPlan.legs.length - 1;

          if (isLast) {
            const allocatedBefore =
              connectionPlan.legs
                .slice(0, index)
                .reduce(
                  (sum, legItem) =>
                    sum +
                    fare *
                      (legItem.distanceKm /
                        connectionPlan!.distanceKm),
                  0
                );

            return Math.max(
              0,
              fare - allocatedBefore
            );
          }

          return (
            fare *
            (legDistanceKm /
              connectionPlan.distanceKm)
          );
        };

      /* =====================================================
         CREATE REBOOK
         ===================================================== */

      const b =
        await prisma.booking.create({
          data: {
            customerId: old.customerId,
            bookingType: old.bookingType,
            rideType: old.rideType,
            status: "NEW",

            pickupAddress: old.pickupAddress,
            pickupLat: old.pickupLat,
            pickupLng: old.pickupLng,

            dropAddress: old.dropAddress,
            dropLat: old.dropLat,
            dropLng: old.dropLng,

            passengerCount:
              (
                old.rideType === "SHARED_RIDE" ||
                old.rideType === "CONNECTION_RIDE"
              )
                ? Math.max(
                    1,
                    Math.min(
                      4,
                      old.passengerCount
                    )
                  )
                : 1,

            pickupDatetime: null,
            timezone: old.timezone,
            isScheduled: false,
            estimatedFare: fare,
            pricingVersion:
              RIDEX_PRICING_VERSION,
            commissionRate:
              commissionRate,
            paymentPreference:
              old.paymentPreference,

            goodsVehicleType:
              old.goodsVehicleType,
            goodsType: old.goodsType,
            goodsWeightKg:
              old.goodsWeightKg,
            goodsSize:
              old.goodsSize,
            receiverName:
              old.receiverName,
            receiverMobile:
              old.receiverMobile,
            loadingInstructions:
              old.loadingInstructions,
            unloadingInstructions:
              old.unloadingInstructions,
            waitingMinutes:
              old.waitingMinutes,
            specialInstructions:
              old.specialInstructions,

            stops:
              old.stops !== null
                ? old.stops
                : undefined,

            rebookOfId: old.id,

            legs: {
              create: {
                sequence: 1,
                status: "NEW",

                pickupAddress:
                  connectionPlan
                    ? connectionPlan.legs[0].pickup.address
                    : old.pickupAddress,
                pickupLat:
                  connectionPlan
                    ? connectionPlan.legs[0].pickup.lat
                    : old.pickupLat,
                pickupLng:
                  connectionPlan
                    ? connectionPlan.legs[0].pickup.lng
                    : old.pickupLng,

                dropAddress:
                  connectionPlan
                    ? connectionPlan.legs[0].drop.address
                    : old.dropAddress,
                dropLat:
                  connectionPlan
                    ? connectionPlan.legs[0].drop.lat
                    : old.dropLat,
                dropLng:
                  connectionPlan
                    ? connectionPlan.legs[0].drop.lng
                    : old.dropLng,

                estimatedFare:
                  connectionPlan
                    ? connectionLegFare(
                        connectionPlan.legs[0].distanceKm,
                        0
                      )
                    : fare,

                tripPin: pin(),
              },
            },

            routes: {
              create: {
                distanceKm:
                  routeDistanceKm,
                durationMinutes:
                  routeDurationMinutes,
                geometry:
                  connectionPlan?.geometry ??
                  undefined,
                provider: "OSRM",
                calculatedAt:
                  new Date(),
              },
            },
          },
        });

      /* =====================================================
         CREATE REBOOK CONNECTION LEGS + ROUTES
         ===================================================== */

      if (
        connectionPlan &&
        connectionPlan.legs.length > 1
      ) {
        await prisma.$transaction(
          async (tx) => {
            for (
              let index = 0;
              index <
                connectionPlan!.legs.length;
              index += 1
            ) {
              const planLeg =
                connectionPlan!.legs[index];

              if (index > 0) {
                await tx.bookingLeg.create({
                  data: {
                    bookingId: b.id,
                    sequence: planLeg.sequence,
                    status: "NEW",
                    pickupAddress:
                      planLeg.pickup.address,
                    pickupLat:
                      planLeg.pickup.lat,
                    pickupLng:
                      planLeg.pickup.lng,
                    dropAddress:
                      planLeg.drop.address,
                    dropLat:
                      planLeg.drop.lat,
                    dropLng:
                      planLeg.drop.lng,
                    estimatedFare:
                      connectionLegFare(
                        planLeg.distanceKm,
                        index
                      ),
                    tripPin: pin(),
                  },
                });
              }

              const persistedLeg =
                await tx.bookingLeg.findUnique({
                  where: {
                    bookingId_sequence: {
                      bookingId: b.id,
                      sequence:
                        planLeg.sequence,
                    },
                  },
                  select: { id: true },
                });

              if (!persistedLeg) {
                throw new Error(
                  `Rebook connection leg ${planLeg.sequence} was not created`
                );
              }

              await tx.route.create({
                data: {
                  bookingId: b.id,
                  legId: persistedLeg.id,
                  distanceKm:
                    planLeg.distanceKm,
                  durationMinutes:
                    planLeg.durationMinutes,
                  geometry:
                    planLeg.geometry as any,
                  provider:
                    "OSRM_CONNECTION",
                  calculatedAt:
                    new Date(),
                },
              });
            }
          }
        );
      }

      /* =====================================================
         MATCHING
         ===================================================== */

      const matching =
        await findAndAssignDriver(
          b.id
        );

      /* =====================================================
         FRESH RESPONSE
         ===================================================== */

      const fresh =
        await prisma.booking.findUnique({
          where: {
            id: b.id,
          },

          include: {
            legs: true,
            rideRequests: true,
            routes: true,
          },
        });

      return res.status(201).json({
        success: true,

        data: {
          booking:
            fresh,

          matching,

          route: {
            distanceKm:
              routeDistanceKm,

            durationMinutes:
              routeDurationMinutes,

            stopCount:
              normalizeStops(
                old.stops
              ).length,
          },
        },
      });
    } catch (error) {
      console.error(
        "REBOOK ERROR:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Unable to rebook",

        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

export {
  router as bookingRouter,
};
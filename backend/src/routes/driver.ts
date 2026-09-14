import { Router } from "express";

import { prisma } from "../lib/prisma";

import { finalizeTrip } from "../services/finalizeTrip";

const router = Router();

/* =========================================================
   HELPERS
   ========================================================= */

const isValidCoordinate = (
  latitude: number,
  longitude: number
) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= -90 &&
  latitude <= 90 &&
  longitude >= -180 &&
  longitude <= 180;


const findCurrentDriverLeg = (
  booking: any,
  driverId: string,
  allowedStatuses: string[]
) => {
  const legs = Array.isArray(booking?.legs)
    ? booking.legs
    : [];

  return (
    legs
      .filter(
        (leg: any) =>
          leg.driverId === driverId &&
          allowedStatuses.includes(String(leg.status))
      )
      .sort(
        (a: any, b: any) =>
          Number(a.sequence || 0) - Number(b.sequence || 0)
      )[0] || null
  );
};

/* =========================================================
   GET DRIVER
   ========================================================= */

router.get(
  "/:driverId",
  async (req, res) => {
    try {
      const driver =
        await prisma.driver.findUnique({
          where: {
            id: req.params.driverId,
          },

          include: {
            vehicles: true,
            location: true,
          },
        });

      if (!driver) {
        return res.status(404).json({
          success: false,
          message: "Driver not found",
        });
      }

      return res.json({
        success: true,
        data: driver,
      });
    } catch (error) {
      console.error(
        "GET DRIVER ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load driver",
      });
    }
  }
);

/* =========================================================
   CHANGE SERVICE MODE
   ========================================================= */

router.post(
  "/:driverId/service-mode",
  async (req, res) => {
    try {
      const mode = String(
        req.body.mode || ""
      ).toUpperCase();
      const parcelServiceEnabled=req.body.parcelServiceEnabled === undefined
      ? undefined
      :Boolean(req.body.parcelServiceEnabled);

      if (
        ![
          "PASSENGER",
          "GOODS",
          "BOTH",
        ].includes(mode)
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Mode must be PASSENGER, GOODS or BOTH",
        });
      }

      const driver =
        await prisma.driver.findUnique({
          where: {
            id: req.params.driverId,
          },
        });

      if (!driver) {
        return res.status(404).json({
          success: false,
          message: "Driver not found",
        });
      }

      if (
        driver.driverStatus ===
        "SUSPENDED"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Suspended driver cannot change service mode",
        });
      }

      const updated =
        await prisma.driver.update({
          where: {
            id:
              req.params.driverId,
          },

          data: {
            dailyServiceMode: mode as any,
            ...(parcelServiceEnabled === undefined ? {} : {parcelServiceEnabled}),
            serviceModeUpdatedAt: new Date(),
          },
        });

      return res.json({
        success: true,

        data: {
          driverId:
            updated.id,

          dailyServiceMode:
            updated.dailyServiceMode,

          parcelServiceEnabled: updated.parcelServiceEnabled,
          updatedAt: updated.serviceModeUpdatedAt,
        },
      });
    } catch (error) {
      console.error(
        "SERVICE MODE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Unable to update service mode",
      });
    }
  }
);

/* =========================================================
   GO ONLINE / OFFLINE
   ========================================================= */

router.post(
  "/:driverId/online",
  async (req, res) => {
    try {
      const driver =
        await prisma.driver.findUnique({
          where: {
            id:
              req.params.driverId,
          },

          include: {
            vehicles: true,
            location: true,
          },
        });

      if (!driver) {
        return res.status(404).json({
          success: false,
          message: "Driver not found",
        });
      }

      const online =
        Boolean(req.body.online);

      /* -----------------------------------------------------
         SUSPENDED DRIVER
         ----------------------------------------------------- */

      if (
        driver.driverStatus ===
        "SUSPENDED"
      ) {
        return res.status(403).json({
          success: false,

          message:
            "Suspended driver cannot change online status",
        });
      }

      /* =====================================================
         GO ONLINE
         ===================================================== */

      if (online) {
        if (
          driver.verificationStatus !==
          "APPROVED"
        ) {
          return res.status(403).json({
            success: false,

            message:
              "Driver verification is not approved",
          });
        }

        const activeVehicle =
          driver.vehicles.find(
            (vehicle) =>
              (
                vehicle.status ===
                  "ACTIVE" ||
                vehicle.status ===
                  "VERIFIED"
              )
          );

        if (!activeVehicle) {
          return res.status(403).json({
            success: false,

            message:
              "No active/verified vehicle available",
          });
        }

        const latitude =
          Number(
            req.body.latitude
          );

        const longitude =
          Number(
            req.body.longitude
          );

        if (
          !isValidCoordinate(
            latitude,
            longitude
          )
        ) {
          return res.status(400).json({
            success: false,

            message:
              "Valid latitude and longitude are required to go online",
          });
        }

        /* ---------------------------------------------------
           ACTIVE BOOKING CHECK
           --------------------------------------------------- */

        const activeBooking =
          await prisma.booking.findFirst({
            where: {
              assignedDriverId:
                driver.id,

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
              status: true,
            },
          });

        if (activeBooking) {
          return res.status(409).json({
            success: false,

            message:
              "Driver already has an active booking",
          });
        }

        const now =
          new Date();

        const updated =
          await prisma.driver.update({
            where: {
              id:
                driver.id,
            },

            data: {
              driverStatus:
                "ONLINE",

              location: {
                upsert: {
                  create: {
                    latitude,
                    longitude,

                    isOnline:
                      true,

                    recordedAt:
                      now,
                  },

                  update: {
                    latitude,
                    longitude,

                    isOnline:
                      true,

                    recordedAt:
                      now,
                  },
                },
              },
            },
          });

        return res.json({
          success: true,

          data: {
            driverId:
              updated.id,

            status:
              updated.driverStatus,

            latitude,
            longitude,

            recordedAt:
              now,
          },
        });
      }

      /* =====================================================
         GO OFFLINE
         ===================================================== */

      const activeBooking =
        await prisma.booking.findFirst({
          where: {
            assignedDriverId:
              driver.id,

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
            status: true,
          },
        });

      /**
       * An active trip must continue.
       * Going offline only prevents new matching.
       */

      if (
        activeBooking
      ) {
        return res.status(409).json({
          success: false,

          message:
            "Cannot go offline while an active ride is assigned",

          data: {
            activeBookingId:
              activeBooking.id,

            activeBookingStatus:
              activeBooking.status,
          },
        });
      }

      const now =
        new Date();

      const updated =
        await prisma.driver.update({
          where: {
            id:
              driver.id,
          },

          data: {
            driverStatus:
              "OFFLINE",

            location: {
              update: {
                isOnline:
                  false,

                recordedAt:
                  now,
              },
            },
          },
        });

      /**
       * Expired/offered requests are no longer active
       * when the driver goes offline.
       */

      await prisma.rideRequest.updateMany({
        where: {
          driverId:
            driver.id,

          status:
            "OFFERED",
        },

        data: {
          status:
            "CANCELLED",

          respondedAt:
            now,
        },
      });

      return res.json({
        success: true,

        data: {
          driverId:
            updated.id,

          status:
            updated.driverStatus,

          recordedAt:
            now,
        },
      });
    } catch (error) {
      console.error(
        "ONLINE STATUS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Unable to change online status",
      });
    }
  }
);

/* =========================================================
   UPDATE DRIVER LOCATION
   ========================================================= */

router.post(
  "/:driverId/location",
  async (req, res) => {
    try {
      const driver =
        await prisma.driver.findUnique({
          where: {
            id:
              req.params.driverId,
          },
        });

      if (!driver) {
        return res.status(404).json({
          success: false,
          message:
            "Driver not found",
        });
      }

      const latitude =
        Number(
          req.body.latitude
        );

      const longitude =
        Number(
          req.body.longitude
        );

      const accuracy =
        req.body.accuracy !==
        undefined
          ? Number(
              req.body.accuracy
            )
          : undefined;

      const heading =
        req.body.heading !==
        undefined
          ? Number(
              req.body.heading
            )
          : undefined;

      const speed =
        req.body.speed !==
        undefined
          ? Number(
              req.body.speed
            )
          : undefined;

      if (
        !isValidCoordinate(
          latitude,
          longitude
        )
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Valid latitude and longitude are required",
        });
      }

      const now =
        new Date();

      const location =
        await prisma.driverLocation.upsert(
          {
            where: {
              driverId:
                driver.id,
            },

            update: {
              latitude,
              longitude,

              ...(Number.isFinite(
                accuracy
              )
                ? { accuracy }
                : {}),

              ...(Number.isFinite(
                heading
              )
                ? { heading }
                : {}),

              ...(Number.isFinite(
                speed
              )
                ? { speed }
                : {}),

              isOnline:
                driver.driverStatus !==
                "OFFLINE",

              recordedAt:
                now,
            },

            create: {
              driverId:
                driver.id,

              latitude,
              longitude,

              ...(Number.isFinite(
                accuracy
              )
                ? { accuracy }
                : {}),

              ...(Number.isFinite(
                heading
              )
                ? { heading }
                : {}),

              ...(Number.isFinite(
                speed
              )
                ? { speed }
                : {}),

              isOnline:
                driver.driverStatus !==
                "OFFLINE",

              recordedAt:
                now,
            },
          }
        );

      /* -----------------------------------------------------
         ACTIVE TRIP LOCATION
         ----------------------------------------------------- */

      const activeLeg =
        await prisma.bookingLeg.findFirst({
          where: {
            driverId:
              driver.id,

            status: {
              in: [
                "STARTED",
                "IN_PROGRESS",
              ],
            },

            tripId: {
              not: null,
            },
          },

          orderBy: {
            updatedAt:
              "desc",
          },
        });

      if (
        activeLeg?.tripId
      ) {
        await prisma.tripLocationEvent.create({
          data: {
            tripId:
              activeLeg.tripId,

            latitude,
            longitude,

            accuracy:
              Number.isFinite(
                accuracy
              )
                ? accuracy
                : null,

            heading:
              Number.isFinite(
                heading
              )
                ? heading
                : null,

            speed:
              Number.isFinite(
                speed
              )
                ? speed
                : null,

            recordedAt:
              now,
          },
        });
      }

      return res.json({
        success: true,

        data: {
          driverId:
            driver.id,

          latitude:
            location.latitude,

          longitude:
            location.longitude,

          accuracy:
            location.accuracy,

          heading:
            location.heading,

          speed:
            location.speed,

          isOnline:
            location.isOnline,

          recordedAt:
            location.recordedAt,
        },
      });
    } catch (error) {
      console.error(
        "DRIVER LOCATION ERROR:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Unable to update driver location",
      });
    }
  }
);

/* =========================================================
   GET RIDE REQUESTS
   ========================================================= */

router.get(
  "/:driverId/ride-requests",
  async (req, res) => {
    try {
      const driver =
        await prisma.driver.findUnique({
          where: {
            id:
              req.params.driverId,
          },

          select: {
            id: true,
            driverStatus:
              true,
          },
        });

      if (!driver) {
        return res.status(404).json({
          success: false,
          message:
            "Driver not found",
        });
      }

      if (
        driver.driverStatus !==
        "ONLINE"
      ) {
        return res.json({
          success: true,
          data: [],
        });
      }

      const now =
        new Date();

      /**
       * Convert expired offers to EXPIRED
       * before returning active offers.
       */

      await prisma.rideRequest.updateMany({
        where: {
          driverId:
            driver.id,

          status:
            "OFFERED",

          expiresAt: {
            not: null,
            lte: now,
          },
        },

        data: {
          status:
            "EXPIRED",

          respondedAt:
            now,
        },
      });

      const rows =
        await prisma.rideRequest.findMany({
          where: {
            driverId:
              driver.id,

            status:
              "OFFERED",

            OR: [
              {
                expiresAt:
                  null,
              },

              {
                expiresAt: {
                  gt: now,
                },
              },
            ],
          },

          include: {
            booking: true,
            vehicle: true,
            leg: true,
          },

          orderBy: {
            offeredAt:
              "desc",
          },
        });

      return res.json({
        success: true,
        data: rows,
      });
    } catch (error) {
      console.error(
        "GET RIDE REQUESTS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Unable to load ride requests",
      });
    }
  }
);

/* =========================================================
   ACCEPT RIDE REQUEST
   ========================================================= */

router.post(
  "/ride-requests/:requestId/accept",
  async (req, res) => {
    try {
      const driverId =
        String(
          req.body.driverId ||
            ""
        ).trim();

      if (!driverId) {
        return res.status(400).json({
          success: false,

          message:
            "driverId is required",
        });
      }

      const request =
        await prisma.rideRequest.findUnique({
          where: {
            id:
              req.params.requestId,
          },

          include: {
            booking: true,
            leg: true,
            vehicle: true,
          },
        });

      if (!request) {
        return res.status(404).json({
          success: false,

          message:
            "Request not found",
        });
      }

      if (
        request.driverId !==
        driverId
      ) {
        return res.status(403).json({
          success: false,

          message:
            "Request is not assigned to this driver",
        });
      }

      if (
        request.status !==
        "OFFERED"
      ) {
        return res.status(409).json({
          success: false,

          message:
            "Request unavailable",
        });
      }

      if (
        request.expiresAt &&
        request.expiresAt.getTime() <=
          Date.now()
      ) {
        await prisma.rideRequest.update({
          where: {
            id:
              request.id,
          },

          data: {
            status:
              "EXPIRED",

            respondedAt:
              new Date(),
          },
        });

        return res.status(409).json({
          success: false,

          message:
            "Request expired",
        });
      }

      const result =
        await prisma.$transaction(
          async (tx) => {
            /* ---------------------------------------------
               LOCK / RECHECK DRIVER
               --------------------------------------------- */

            const driver =
              await tx.driver.findUnique({
                where: {
                  id:
                    driverId,
                },
              });

            if (!driver) {
              throw new Error(
                "Driver not found"
              );
            }

            if (
              driver.driverStatus !==
              "ONLINE"
            ) {
              throw new Error(
                "Driver is not online"
              );
            }

            /* ---------------------------------------------
               FRESH REQUEST RECHECK
               Prevent double-accept / stale OFFERED state.
               --------------------------------------------- */

            const currentRequest =
              await tx.rideRequest.findUnique({
                where: {
                  id:
                    request.id,
                },

                include: {
                  booking: true,
                  leg: true,
                  vehicle: true,
                },
              });

            if (!currentRequest) {
              throw new Error(
                "Request not found"
              );
            }

            if (
              currentRequest.driverId !==
              driverId
            ) {
              throw new Error(
                "Request is not assigned to this driver"
              );
            }

            if (
              currentRequest.status !==
              "OFFERED"
            ) {
              throw new Error(
                "Request unavailable"
              );
            }

            if (
              currentRequest.expiresAt &&
              currentRequest.expiresAt.getTime() <=
                Date.now()
            ) {
              throw new Error(
                "Request expired"
              );
            }

            /* ---------------------------------------------
               LOCK / RECHECK BOOKING
               --------------------------------------------- */

            const booking =
              currentRequest.booking;

            if (!booking) {
              throw new Error(
                "Booking not found"
              );
            }

            if (
              booking.status ===
                "COMPLETED" ||
              booking.status ===
                "CANCELLED"
            ) {
              throw new Error(
                "Booking is already closed"
              );
            }

            if (
              booking.assignedDriverId &&
              booking.assignedDriverId !==
                driverId
            ) {
              throw new Error(
                "Booking is already assigned to another driver"
              );
            }

            /* ---------------------------------------------
               ACTIVE BOOKING CONFLICT
               --------------------------------------------- */

            const conflict =
              await tx.booking.findFirst({
                where: {
                  assignedDriverId:
                    driverId,

                  id: {
                    not:
                      booking.id,
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

            if (conflict) {
              throw new Error(
                "Driver already has another active booking"
              );
            }

            const respondedAt =
              new Date();

            /* ---------------------------------------------
               ATOMIC REQUEST CLAIM
               Only one concurrent accept can win the OFFERED
               request. If this fails, the whole transaction rolls back.
               --------------------------------------------- */

            const claimed =
              await tx.rideRequest.updateMany({
                where: {
                  id:
                    currentRequest.id,

                  status:
                    "OFFERED",

                  driverId:
                    driverId,

                  OR: [
                    {
                      expiresAt:
                        null,
                    },
                    {
                      expiresAt: {
                        gt: respondedAt,
                      },
                    },
                  ],
                },

                data: {
                  status:
                    "ACCEPTED",

                  respondedAt,
                },
              });

            if (claimed.count !== 1) {
              throw new Error(
                "Request was already accepted or is no longer available"
              );
            }

            /* ---------------------------------------------
               ASSIGN / CONFIRM BOOKING
               Matching intentionally marks the booking
               DRIVER_ASSIGNED before the offer is accepted.
               Allow the already-assigned same driver, while
               rejecting a booking assigned to another driver.
               --------------------------------------------- */

            const assigned =
              await tx.booking.updateMany({
                where: {
                  id:
                    booking.id,

                  OR: [
                    {
                      assignedDriverId:
                        null,

                      status: {
                        in: ["NEW",
                        
                          "MATCHING",
                        ],
                      },
                    },
                    {
                      assignedDriverId:
                        driverId,
                    },
                  ],
                },

                data: {
                  status:
                    "DRIVER_ASSIGNED",

                  assignedDriverId:
                    driverId,

                  vehicleId:
                    currentRequest.vehicleId,
                },
              });

            if (assigned.count !== 1) {
              throw new Error(
                "Booking was already assigned or is no longer available"
              );
            }

            const updatedBooking =
              await tx.booking.findUnique({
                where: {
                  id:
                    booking.id,
                },
              });

            /* ---------------------------------------------
               ASSIGN LEG
               --------------------------------------------- */

            if (
              currentRequest.legId
            ) {
              await tx.bookingLeg.update({
                where: {
                  id:
                    currentRequest.legId,
                },

                data: {
                  status:
                    "DRIVER_ASSIGNED",

                  driverId:
                    driverId,

                  vehicleId:
                    currentRequest.vehicleId,
                },
              });
            }

            /* ---------------------------------------------
               CANCEL OTHER OFFERS FOR SAME BOOKING
               --------------------------------------------- */

            await tx.rideRequest.updateMany({
              where: {
                bookingId:
                  booking.id,

                id: {
                  not:
                    currentRequest.id,
                },

                status:
                  "OFFERED",
              },

              data: {
                status:
                  "CANCELLED",

                respondedAt:
                  respondedAt,
              },
            });

            /* ---------------------------------------------
               DRIVER ON TRIP / ASSIGNED WORK
               --------------------------------------------- */

            await tx.driver.update({
              where: {
                id:
                  driverId,
              },

              data: {
                driverStatus:
                  "ON_TRIP",
              },
            });

            const updatedRequest =
              await tx.rideRequest.findUnique({
                where: {
                  id:
                    currentRequest.id,
                },
              });

            return {
              request:
                updatedRequest,

              booking:
                updatedBooking,
            };
          }
        );

      return res.json({
        success: true,

        data: result,
      });
    } catch (error) {
      console.error(
        "ACCEPT RIDE ERROR:",
        error
      );

      return res.status(409).json({
        success: false,

        message:
          error instanceof Error
            ? error.message
            : "Unable to accept ride",
      });
    }
  }
);

/* =========================================================
   REJECT RIDE REQUEST
   ========================================================= */

router.post(
  "/ride-requests/:requestId/reject",
  async (req, res) => {
    try {
      const driverId =
        String(
          req.body.driverId ||
            ""
        ).trim();

      if (!driverId) {
        return res.status(400).json({
          success: false,

          message:
            "driverId is required",
        });
      }

      const request =
        await prisma.rideRequest.findUnique({
          where: {
            id:
              req.params.requestId,
          },
        });

      if (!request) {
        return res.status(404).json({
          success: false,

          message:
            "Request not found",
        });
      }

      if (
        request.driverId !==
        driverId
      ) {
        return res.status(403).json({
          success: false,

          message:
            "Request is not assigned to this driver",
        });
      }

      if (
        request.status !==
        "OFFERED"
      ) {
        return res.status(409).json({
          success: false,

          message:
            "Request unavailable",
        });
      }

      const updated =
        await prisma.rideRequest.update({
          where: {
            id:
              request.id,
          },

          data: {
            status:
              "REJECTED",

            respondedAt:
              new Date(),
          },
        });

      /**
       * Booking remains eligible for another driver.
       */
      return res.json({
        success: true,

        data: updated,
      });
    } catch (error) {
      console.error(
        "REJECT RIDE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Unable to reject ride",
      });
    }
  }
);

/* =========================================================
   DRIVER ARRIVED
   ========================================================= */

router.post(
  "/bookings/:bookingId/arrived",
  async (req, res) => {
    try {
      const booking =
        await prisma.booking.findUnique({
          where: {
            id:
              req.params.bookingId,
          },

          include: {
            legs: {
              orderBy: {
                sequence:
                  "asc",
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

      const driverId =
        String(
          req.body.driverId ||
            booking.assignedDriverId ||
            ""
        ).trim();

      if (!driverId) {
        return res.status(400).json({
          success: false,

          message:
            "Assigned driver is required",
        });
      }

      const currentLeg =
        findCurrentDriverLeg(
          booking,
          driverId,
          [
            "DRIVER_ASSIGNED",
            "DRIVER_ARRIVING",
          ]
        );

      if (
        booking.assignedDriverId !==
          driverId &&
        !currentLeg
      ) {
        return res.status(403).json({
          success: false,

          message:
            "This booking is not assigned to this driver",
        });
      }

      if (
        booking.status !==
          "DRIVER_ASSIGNED" &&
        booking.status !==
          "DRIVER_ARRIVING"
      ) {
        return res.status(409).json({
          success: false,

          message:
            `Cannot mark arrived from status ${booking.status}`,
        });
      }

      if (!currentLeg) {
        return res.status(409).json({
          success: false,

          message:
            "No active booking leg found for this driver",
        });
      }

      const waitMinutes =
        Math.max(
          0,
          Number(
            process.env
              .PICKUP_WAIT_MINUTES ||
              2
          )
        );

      const arrivedAt =
        new Date();

      const waitExpiresAt =
        new Date(
          arrivedAt.getTime() +
            waitMinutes *
              60 *
              1000
        );

      const result =
        await prisma.$transaction(
          async (tx) => {
            const updated =
              await tx.booking.update({
                where: {
                  id:
                    booking.id,
                },

                data: {
                  status:
                    "DRIVER_ARRIVED",

                  driverArrivedAt:
                    arrivedAt,

                  pickupWaitExpiresAt:
                    waitExpiresAt,
                },
              });

            const updatedLeg =
              await tx.bookingLeg.update({
                where: {
                  id:
                    currentLeg.id,
                },

                data: {
                  status:
                    "DRIVER_ARRIVED",
                },
              });

            return {
              updated,
              updatedLeg,
            };
          }
        );

      return res.json({
        success: true,

        data: {
          bookingId:
            result.updated.id,

          status:
            result.updated.status,

          driverArrivedAt:
            result.updated.driverArrivedAt,

          waitExpiresAt:
            result.updated.pickupWaitExpiresAt,

          leg:
            result.updatedLeg,
        },
      });
    } catch (error) {
      console.error(
        "DRIVER ARRIVED ERROR:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Unable to mark driver arrival",
      });
    }
  }
);

/* =========================================================
   START RIDE
   ========================================================= */

router.post(
  "/bookings/:bookingId/start",
  async (req, res) => {
    try {
      const pin = String(req.body.pin || "").trim();
      const verificationMethod = String(req.body.verificationMethod || "OTP").toUpperCase();
      const verificationCredential = String(req.body.verificationCredential || pin).trim();

      if (!['OTP','QR'].includes(verificationMethod)) {
        return res.status(400).json({success:false,message:'verificationMethod must be OTP or QR'});
      }
      if (verificationMethod === 'OTP' && !/^\d{4}$/.test(verificationCredential)) {
        return res.status(400).json({success:false,message:'A valid 4-digit OTP is required'});
      }
      if (verificationMethod === 'QR' && !verificationCredential) {
        return res.status(400).json({success:false,message:'QR verification credential is required'});
      }

      const booking =
        await prisma.booking.findUnique({
          where: {
            id:
              req.params.bookingId,
          },

          include: {
            legs: {
              orderBy: {
                sequence:
                  "asc",
              },
            },

            assignedDriver:
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

      if (
        !booking.assignedDriverId
      ) {
        return res.status(409).json({
          success: false,

          message:
            "No driver assigned to this booking",
        });
      }

      if (
        booking.status !==
          "DRIVER_ARRIVED"
      ) {
        return res.status(409).json({
          success: false,

          message:
            `Cannot start ride from status ${booking.status}`,
        });
      }

      const leg =
        findCurrentDriverLeg(
          booking,
          String(
            booking.assignedDriverId ||
              ""
          ),
          [
            "DRIVER_ARRIVED",
          ]
        );

      if (!leg) {
        return res.status(409).json({
          success: false,

          message:
            "No active booking leg found",
        });
      }

      if (
        leg.tripId
      ) {
        return res.status(409).json({
          success: false,

          message:
            "Trip has already been started",
        });
      }

      if (verificationMethod !== String(leg.verificationMethod || 'OTP').toUpperCase()) {
        return res.status(409).json({success:false,message:'Selected verification method does not match this leg'});
      }
      if (verificationMethod === 'OTP' && leg.tripPin && verificationCredential !== leg.tripPin) {
        return res.status(400).json({success:false,message:'Invalid OTP'});
      }
      if (verificationMethod === 'QR') {
        const crypto = await import('node:crypto');
        const hash = crypto.createHash('sha256').update(verificationCredential).digest('hex');
        if (!leg.verificationUsedAt) return res.status(409).json({success:false,message:'Customer must scan and verify the QR before trip start'});
        if (leg.verificationTokenHash !== hash) return res.status(400).json({success:false,message:'Invalid QR credential'});
        if (leg.verificationExpiresAt && leg.verificationExpiresAt < new Date()) return res.status(400).json({success:false,message:'QR credential expired'});
        if (leg.verificationCustomerId !== booking.customerId || leg.verificationDriverId !== booking.assignedDriverId) return res.status(403).json({success:false,message:'QR verification binding mismatch'});
      }

      const startedAt =
        new Date();

      const result =
        await prisma.$transaction(
          async (tx) => {
            const current =
              await tx.booking.findUnique({
                where: {
                  id:
                    booking.id,
                },
              });

            if (!current) {
              throw new Error(
                "Booking not found"
              );
            }

            if (
              current.status !==
                "DRIVER_ARRIVED"
            ) {
              throw new Error(
                `Booking changed to ${current.status}`
              );
            }

            const trip =
              await tx.trip.create({
                data: {
                  status:
                    "IN_PROGRESS",

                  tripPin:
                    leg.tripPin ||
                    pin,

                  startedAt,
                },
              });

            const updatedLeg =
              await tx.bookingLeg.update({
                where: {
                  id:
                    leg.id,
                },

                data: {
                  status:
                    "IN_PROGRESS",

                  driverId:
                    current.assignedDriverId,

                  vehicleId:
                    current.vehicleId,

                  tripId:
                    trip.id,
                },
              });

            const updatedBooking =
              await tx.booking.update({
                where: {
                  id:
                    current.id,
                },

                data: {
                  status:
                    "IN_PROGRESS",
                },
              });

            /* ---------------------------------------------
               FIRST GPS POINT
               --------------------------------------------- */

            if (
              current.assignedDriverId
            ) {
              const location =
                await tx.driverLocation.findUnique({
                  where: {
                    driverId:
                      current.assignedDriverId,
                  },
                });

              if (location) {
                await tx.tripLocationEvent.create({
                  data: {
                    tripId:
                      trip.id,

                    latitude:
                      location.latitude,

                    longitude:
                      location.longitude,

                    accuracy:
                      location.accuracy,

                    heading:
                      location.heading,

                    speed:
                      location.speed,

                    recordedAt:
                      startedAt,
                  },
                });
              }
            }

            return {
              trip,
              updatedLeg,
              updatedBooking,
            };
          }
        );

      return res.json({
        success: true,

        data: {
          booking:
            result.updatedBooking,

          leg:
            result.updatedLeg,

          trip:
            result.trip,
        },
      });
    } catch (error) {
      console.error(
        "START RIDE ERROR:",
        error
      );

      return res.status(409).json({
        success: false,

        message:
          error instanceof Error
            ? error.message
            : "Unable to start ride",
      });
    }
  }
);

/* =========================================================
   COMPLETE RIDE
   ========================================================= */

router.post(
  "/bookings/:bookingId/complete",
  async (req, res) => {
    try {
      const driverId =
        String(
          req.body.driverId ||
            ""
        ).trim();

      if (!driverId) {
        return res.status(400).json({
          success: false,

          message:
            "driverId is required",
        });
      }

      const booking =
        await prisma.booking.findUnique({
          where: {
            id:
              req.params.bookingId,
          },

          include: {
            legs: {
              orderBy: {
                sequence:
                  "asc",
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

      const activeLeg =
        findCurrentDriverLeg(
          booking,
          driverId,
          [
            "IN_PROGRESS",
            "STARTED",
          ]
        );

      if (!activeLeg) {
        return res.status(403).json({
          success: false,

          message:
            "This booking has no active trip for this driver",
        });
      }

      if (
        booking.status !==
        "IN_PROGRESS"
      ) {
        return res.status(409).json({
          success: false,

          message:
            `Cannot complete ride from status ${booking.status}`,
        });
      }

      const result =
        await finalizeTrip({
          bookingId:
            booking.id,

          source:
            "DRIVER",
        });

      return res.json({
        success: true,

        message:
          result.alreadyCompleted
            ? "Ride already completed"
            : "Ride completed successfully",

        data: result,
      });
    } catch (error) {
      console.error(
        "COMPLETE RIDE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Unable to complete ride",

        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

export {
  router as driverRouter,
};

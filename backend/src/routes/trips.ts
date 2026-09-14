import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import { finalizeTrip } from "../services/finalizeTrip";

const router = Router();

/**
 * =========================================================
 * RIDEX TRIP ROUTES
 * =========================================================
 *
 * Trip lifecycle:
 *
 * Booking/Leg DRIVER_ARRIVED
 *        ↓
 * POST /trips/start
 *        ↓
 * Trip created + leg IN_PROGRESS
 *        ↓
 * POST /gps/location
 *        ↓
 * TripLocationEvent records
 *        ↓
 * POST /trips/:tripId/complete
 *        ↓
 * finalizeTrip()
 *
 * Connection Ride:
 * - Each BookingLeg has its own Trip + PIN.
 * - Completing one leg lets the finalize service activate/
 *   match the next leg automatically.
 *
 * IMPORTANT:
 * - Backend validates state and Trip PIN.
 * - Driver identity must match the current leg/booking.
 * - Customer-end flow should use the existing booking
 *   customer-end endpoint; it is not duplicated here.
 *
 * Current MVP authentication:
 * - driverId is supplied by the client.
 * - Production must replace this with verified session/JWT.
 * =========================================================
 */

/**
 * =========================================================
 * HELPERS
 * =========================================================
 */

function cleanString(value: unknown) {
  const text =
    String(value ?? "").trim();

  return text || null;
}

/**
 * Find the operational leg for a booking.
 *
 * Priority:
 * 1. Explicit legId when supplied.
 * 2. STARTED / IN_PROGRESS leg.
 * 3. First non-completed/non-cancelled leg.
 */
async function findOperationalLeg(
  bookingId: string,
  legId?: string | null
) {
  const booking =
    await prisma.booking.findUnique({
      where: {
        id: bookingId,
      },
      include: {
        legs: {
          include: {
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
      },
    });

  if (!booking) {
    return {
      booking: null,
      leg: null,
    };
  }

  if (legId) {
    const explicitLeg =
      booking.legs.find(
        (leg) =>
          leg.id === legId
      );

    if (explicitLeg) {
      return {
        booking,
        leg: explicitLeg,
      };
    }

    return {
      booking,
      leg: null,
    };
  }

  const activeLeg =
    booking.legs.find(
      (leg) =>
        leg.status ===
          "IN_PROGRESS" ||
        leg.status ===
          "STARTED"
    ) ??
    booking.legs.find(
      (leg) =>
        leg.status !==
          "COMPLETED" &&
        leg.status !==
          "CANCELLED"
    ) ??
    null;

  return {
    booking,
    leg: activeLeg,
  };
}

function driverOwnsLeg(
  leg: any,
  driverId: string
) {
  return (
    leg?.driverId ===
    driverId
  );
}

function isConnectionBooking(booking: any) {
  return (
    booking?.bookingType === "RIDE" &&
    booking?.rideType === "CONNECTION_RIDE"
  );
}

router.post("/verification", async (req, res) => {
  try {
    const bookingId = String(req.body?.bookingId || "").trim();
    const legId = String(req.body?.legId || "").trim();
    const method = String(req.body?.method || "").toUpperCase();
    if (!bookingId || !legId || !["OTP", "QR"].includes(method)) {
      return res.status(400).json({ success:false, message:"bookingId, legId and method (OTP|QR) are required" });
    }
    const leg = await prisma.bookingLeg.findFirst({
      where:{ id:legId, bookingId },
      include:{ booking:{select:{customerId:true}}, driver:{select:{id:true}} },
    });
    if (!leg) return res.status(404).json({success:false,message:"Booking leg not found"});

    const auth = req.auth;
    if (!auth) return res.status(401).json({success:false,message:"Authentication required"});
    if (auth.userType === "DRIVER" && auth.driverId !== leg.driverId) return res.status(403).json({success:false,message:"Only the assigned driver can create ride verification"});
    if (auth.userType === "CUSTOMER" && auth.customerId !== leg.booking.customerId) return res.status(403).json({success:false,message:"Only the booking customer can choose verification"});

    if (method === "QR") {
      if (!leg.driverId) return res.status(409).json({success:false,message:"Driver must be assigned before QR verification"});
      const token = crypto.randomBytes(32).toString("base64url");
      const payload = `RIDEX5.6|${bookingId}|${legId}|${leg.booking.customerId}|${leg.driverId}|${token}`;
      const hash = crypto.createHash("sha256").update(payload).digest("hex");
      const expiresAt = new Date(Date.now()+5*60*1000);
      await prisma.bookingLeg.update({
        where:{id:leg.id},
        data:{verificationMethod:"QR", verificationTokenHash:hash, verificationExpiresAt:expiresAt, verificationUsedAt:null, verificationCustomerId:leg.booking.customerId, verificationDriverId:leg.driverId},
      });
      return res.json({success:true,data:{method,bookingId,legId,qrPayload:payload,expiresAt:expiresAt.toISOString(),masked:true}});
    }

    await prisma.bookingLeg.update({
      where:{id:leg.id},
      data:{verificationMethod:"OTP", verificationUsedAt:null, verificationCustomerId:leg.booking.customerId, verificationDriverId:leg.driverId},
    });
    // The OTP value itself is never returned to the Driver. In TEST, the seeded
    // Trip PIN can be used by the approved test customer/driver flow.
    return res.json({success:true,data:{method,bookingId,legId,masked:true,otpAvailableForCustomer:true}});
  } catch(e) { return res.status(500).json({success:false,message:e instanceof Error?e.message:String(e)}); }
});

router.post("/verification/verify", async (req,res)=>{
  try {
    const bookingId=String(req.body?.bookingId||"").trim();
    const legId=String(req.body?.legId||"").trim();
    const method=String(req.body?.method||"").toUpperCase();
    const credential=String(req.body?.credential||req.body?.tripPin||req.body?.qrPayload||"").trim();
    if(!bookingId||!legId||!["OTP","QR"].includes(method)||!credential)
      return res.status(400).json({success:false,message:"bookingId, legId, method and credential are required"});

    const leg=await prisma.bookingLeg.findFirst({where:{id:legId,bookingId},include:{booking:{select:{customerId:true}},driver:{select:{id:true}}}});
    if(!leg)return res.status(404).json({success:false,message:"Booking leg not found"});
    const auth=req.auth;
    if(!auth)return res.status(401).json({success:false,message:"Authentication required"});
    if(auth.userType!=="CUSTOMER" || auth.customerId!==leg.booking.customerId)
      return res.status(403).json({success:false,message:"Only the booking customer can verify the ride credential"});
    if(!leg.driverId)return res.status(409).json({success:false,message:"Driver is not assigned"});
    if(method!==String(leg.verificationMethod||"OTP").toUpperCase())return res.status(409).json({success:false,message:"Verification method does not match the selected ride verification"});

    if(leg.verificationUsedAt) return res.status(409).json({success:false,message:"Verification credential has already been used"});
    if(method==="OTP") {
      if(!/^\d{4}$/.test(credential) || leg.tripPin!==credential) return res.status(400).json({success:false,message:"Invalid OTP"});
    } else {
      const hash=crypto.createHash("sha256").update(credential).digest("hex");
      if(!leg.verificationTokenHash || leg.verificationTokenHash!==hash) return res.status(400).json({success:false,message:"Invalid QR credential"});
      if(leg.verificationExpiresAt && leg.verificationExpiresAt<new Date()) return res.status(400).json({success:false,message:"QR credential expired"});
      const parts=credential.split("|");
      if(parts.length!==6 || parts[0]!=="RIDEX5.5" || parts[1]!==bookingId || parts[2]!==legId || parts[3]!==leg.booking.customerId || parts[4]!==leg.driverId)
        return res.status(400).json({success:false,message:"QR credential is not bound to this Customer, Driver and Ride"});
    }

    const verifiedAt=new Date();
    const updated=await prisma.bookingLeg.update({
      where:{id:leg.id},
      data:{verificationUsedAt:verifiedAt, verificationCustomerId:leg.booking.customerId, verificationDriverId:leg.driverId},
      select:{id:true,verificationMethod:true,verificationUsedAt:true},
    });
    return res.json({success:true,data:{verified:true,bookingId,legId,method,verifiedAt:updated.verificationUsedAt}});
  } catch(e){return res.status(500).json({success:false,message:e instanceof Error?e.message:String(e)});}
});

/**
 * =========================================================
 * START TRIP
 * =========================================================
 *
 * POST /api/v1/trips/start
 *
 * Body:
 * {
 *   bookingId: string,
 *   driverId: string,
 *   tripPin: string,
 *   legId?: string
 * }
 *
 * Rules:
 * - Booking must exist and be active.
 * - Current leg must belong to driver.
 * - Trip PIN must be exactly 4 digits.
 * - PIN must match the current BookingLeg.
 * - A completed/cancelled leg cannot start.
 * - Existing Trip returns idempotently.
 */
router.post(
  "/start",
  async (req, res) => {
    try {
      const bookingId =
        String(
          req.body?.bookingId ??
            ""
        ).trim();

      const driverId =
        String(
          req.body?.driverId ??
            ""
        ).trim();

      const tripPin =
        String(
          req.body?.tripPin ??
            req.body?.pin ??
            ""
        ).trim();
      const verificationMethod = String(req.body?.verificationMethod || "OTP").toUpperCase();
      const verificationCredential = String(req.body?.verificationCredential || tripPin).trim();

      const legId =
        cleanString(
          req.body?.legId
        );

      if (!bookingId || !driverId || !verificationCredential) {
        return res.status(400).json({
          success: false,
          message:
            "bookingId, driverId and tripPin are required",
        });
      }

      if (verificationMethod === "OTP" && !/^\d{4}$/.test(verificationCredential)) {
        return res.status(400).json({
          success: false,
          message:
            "Trip PIN must be exactly 4 digits",
        });
      }

      const {
        booking,
        leg,
      } =
        await findOperationalLeg(
          bookingId,
          legId
        );

      if (!booking) {
        return res.status(404).json({
          success: false,
          message:
            "Booking not found",
        });
      }

      if (!leg) {
        return res.status(404).json({
          success: false,
          message:
            legId
              ? "Booking leg not found"
              : "No operational booking leg found",
        });
      }

      if (
        booking.status ===
          "COMPLETED" ||
        booking.status ===
          "CANCELLED"
      ) {
        return res.status(409).json({
          success: false,
          message:
            "Trip cannot be started for a completed/cancelled booking",
        });
      }

      if (
        !driverOwnsLeg(
          leg,
          driverId
        )
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Driver is not assigned to the current booking leg",
        });
      }

      /**
       * Idempotent case:
       * current leg already has an active Trip.
       */
      if (
        leg.tripId &&
        leg.trip
      ) {
        if (
          leg.status ===
            "STARTED" ||
          leg.status ===
            "IN_PROGRESS"
        ) {
          return res.json({
            success: true,
            alreadyStarted: true,
            message:
              "Trip already started",
            data: {
              trip:
                leg.trip,
              leg,
            },
          });
        }
      }

      /**
       * Trip cannot start if PIN is missing.
       */
      if (!leg.tripPin) {
        return res.status(409).json({
          success: false,
          message:
            "Trip PIN is not configured for this booking leg",
        });
      }

      if (verificationMethod === "OTP" && leg.tripPin !== verificationCredential) {
        return res.status(400).json({ success: false, message: "Invalid Trip PIN" });
      }
      if (!["OTP", "QR"].includes(verificationMethod)) return res.status(400).json({success:false,message:"verificationMethod must be OTP or QR"});
      if (verificationMethod !== String(leg.verificationMethod || "OTP").toUpperCase()) return res.status(409).json({success:false,message:"Selected verification method does not match this leg"});
      if (verificationMethod === "QR") {
        if (!leg.verificationUsedAt) return res.status(409).json({success:false,message:"QR must be scanned and verified by the customer before the driver can start"});
        if (leg.verificationCustomerId !== booking.customerId || leg.verificationDriverId !== driverId) return res.status(403).json({success:false,message:"QR verification binding mismatch"});
      }

      /**
       * Driver flow normally reaches DRIVER_ARRIVED
       * before Trip PIN/start.
       *
       * STARTED/IN_PROGRESS were already handled above.
       */
      const allowedStartStatuses = new Set([
        "DRIVER_ARRIVED",
      ]);

      if (
        !allowedStartStatuses.has(
          leg.status
        )
      ) {
        return res.status(409).json({
          success: false,
          message:
            `Booking leg cannot start from status ${leg.status}`,
        });
      }

      const now =
        new Date();

      const result =
        await prisma.$transaction(
          async (tx) => {
            const currentLeg =
              await tx.bookingLeg.findUnique({
                where: {
                  id:
                    leg.id,
                },
              });

            if (!currentLeg) {
              throw new Error(
                "Booking leg not found"
              );
            }

            if (
              currentLeg.tripId
            ) {
              const existingTrip =
                await tx.trip.findUnique({
                  where: {
                    id:
                      currentLeg.tripId,
                  },
                });

              if (
                existingTrip
              ) {
                return {
                  trip:
                    existingTrip,
                  leg:
                    currentLeg,
                  booking:
                    await tx.booking.findUnique({
                      where: {
                        id:
                          booking.id,
                      },
                    }),
                  alreadyStarted:
                    true,
                };
              }

              throw new Error(
                "Booking leg already has a trip reference"
              );
            }

            if (isConnectionBooking(booking)) {
              const earlierActiveLeg =
                await tx.bookingLeg.findFirst({
                  where: {
                    bookingId:
                      booking.id,
                    sequence: {
                      lt:
                        currentLeg.sequence,
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
                    sequence: true,
                    status: true,
                  },
                });

              if (earlierActiveLeg) {
                throw new Error(
                  "Previous Connection Ride leg is still active"
                );
              }
            }

            const trip =
              await tx.trip.create({
                data: {
                  status:
                    "IN_PROGRESS",
                  tripPin:
                    currentLeg.tripPin!,
                  startedAt:
                    now,
                },
              });

            const claimed =
              await tx.bookingLeg.updateMany({
                where: {
                  id:
                    currentLeg.id,
                  tripId:
                    null,
                  status:
                    "DRIVER_ARRIVED",
                },
                data: {
                  status:
                    "IN_PROGRESS",
                  tripId:
                    trip.id,
                },
              });

            if (
              claimed.count !==
              1
            ) {
              await tx.trip.delete({
                where: {
                  id:
                    trip.id,
                },
              });

              throw new Error(
                "Trip start lost a concurrent update"
              );
            }

            const updatedLeg =
              await tx.bookingLeg.findUnique({
                where: {
                  id:
                    currentLeg.id,
                },
                include: {
                  trip: true,
                },
              });

            if (!updatedLeg) {
              throw new Error(
                "Booking leg disappeared after trip start"
              );
            }

            const updatedBooking =
              await tx.booking.update({
                where: {
                  id:
                    booking.id,
                },
                data: {
                  status:
                    "IN_PROGRESS",
                  assignedDriverId:
                    driverId,
                  vehicleId:
                    currentLeg.vehicleId ??
                    undefined,
                },
              });

            return {
              trip,
              leg:
                updatedLeg,
              booking:
                updatedBooking,
              alreadyStarted:
                false,
            };
          }
        );

      return res.status(201).json({
        success: true,
        message:
          "Trip started successfully",
        data: result,
      });
    } catch (error) {
      console.error(
        "START TRIP ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to start trip",
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
 * GET TRIP
 * =========================================================
 *
 * GET /api/v1/trips/:tripId
 */
router.get(
  "/:tripId",
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
          include: {
            locations: {
              orderBy: {
                recordedAt:
                  "asc",
              },
              take: 1000,
            },
            bookingLeg: {
              include: {
                booking: {
                  select: {
                    id: true,
                    customerId: true,
                    status: true,
                    rideType: true,
                  },
                },
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
        "GET TRIP ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load trip",
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
 * START TRIP BY BOOKING
 * =========================================================
 *
 * Compatibility helper:
 *
 * POST /api/v1/trips/booking/:bookingId/start
 *
 * Body:
 * {
 *   driverId: string,
 *   tripPin: string,
 *   legId?: string
 * }
 *
 * This avoids changing the main booking route and gives the
 * Trip module a booking-oriented start endpoint too.
 */
router.post(
  "/booking/:bookingId/start",
  async (req, res) => {
    try {
      const bookingId =
        String(
          req.params.bookingId ??
            ""
        ).trim();

      if (!bookingId) {
        return res.status(400).json({
          success: false,
          message:
            "bookingId is required",
        });
      }

      const driverId =
        String(
          req.body?.driverId ??
            ""
        ).trim();

      const tripPin =
        String(
          req.body?.tripPin ??
            req.body?.pin ??
            ""
        ).trim();
      const verificationMethod = String(req.body?.verificationMethod || "OTP").toUpperCase();
      const verificationCredential = String(req.body?.verificationCredential || tripPin).trim();

      const legId =
        cleanString(
          req.body?.legId
        );

      /**
       * Keep the endpoint independent instead of recursively
       * invoking Express handlers.
       */
      if (
        !driverId ||
        !tripPin
      ) {
        return res.status(400).json({
          success: false,
          message:
            "driverId and tripPin are required",
        });
      }

      if (verificationMethod === "OTP" && !/^\d{4}$/.test(verificationCredential)) {
        return res.status(400).json({
          success: false,
          message:
            "Trip PIN must be exactly 4 digits",
        });
      }

      const {
        booking,
        leg,
      } =
        await findOperationalLeg(
          bookingId,
          legId
        );

      if (!booking) {
        return res.status(404).json({
          success: false,
          message:
            "Booking not found",
        });
      }

      if (!leg) {
        return res.status(404).json({
          success: false,
          message:
            "Booking leg not found",
        });
      }

      if (
        !driverOwnsLeg(
          leg,
          driverId
        )
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Driver is not assigned to this booking leg",
        });
      }

      if (
        leg.tripId &&
        leg.trip &&
        (
          leg.status ===
            "STARTED" ||
          leg.status ===
            "IN_PROGRESS"
        )
      ) {
        return res.json({
          success: true,
          alreadyStarted: true,
          data: {
            trip:
              leg.trip,
            leg,
          },
        });
      }

      if (verificationMethod === "OTP" && leg.tripPin !== verificationCredential) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid Trip PIN",
        });
      }

      if (
        leg.status !==
        "DRIVER_ARRIVED"
      ) {
        return res.status(409).json({
          success: false,
          message:
            `Booking leg cannot start from status ${leg.status}`,
        });
      }

      const now =
        new Date();

      const result =
        await prisma.$transaction(
          async (tx) => {
            const currentLeg =
              await tx.bookingLeg.findUnique({
                where: {
                  id:
                    leg.id,
                },
              });

            if (!currentLeg) {
              throw new Error(
                "Booking leg not found"
              );
            }

            if (
              currentLeg.tripId
            ) {
              const existingTrip =
                await tx.trip.findUnique({
                  where: {
                    id:
                      currentLeg.tripId,
                  },
                });

              if (
                existingTrip
              ) {
                return {
                  trip:
                    existingTrip,
                  leg:
                    currentLeg,
                  booking:
                    await tx.booking.findUnique({
                      where: {
                        id:
                          booking.id,
                      },
                    }),
                  alreadyStarted:
                    true,
                };
              }

              throw new Error(
                "Booking leg already has a trip reference"
              );
            }

            if (isConnectionBooking(booking)) {
              const earlierActiveLeg =
                await tx.bookingLeg.findFirst({
                  where: {
                    bookingId:
                      booking.id,
                    sequence: {
                      lt:
                        currentLeg.sequence,
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
                    sequence: true,
                    status: true,
                  },
                });

              if (earlierActiveLeg) {
                throw new Error(
                  "Previous Connection Ride leg is still active"
                );
              }
            }

            const trip =
              await tx.trip.create({
                data: {
                  status:
                    "IN_PROGRESS",
                  tripPin:
                    currentLeg.tripPin!,
                  startedAt:
                    now,
                },
              });

            const claimed =
              await tx.bookingLeg.updateMany({
                where: {
                  id:
                    currentLeg.id,
                  tripId:
                    null,
                  status:
                    "DRIVER_ARRIVED",
                },
                data: {
                  status:
                    "IN_PROGRESS",
                  tripId:
                    trip.id,
                },
              });

            if (
              claimed.count !==
              1
            ) {
              await tx.trip.delete({
                where: {
                  id:
                    trip.id,
                },
              });

              throw new Error(
                "Trip start lost a concurrent update"
              );
            }

            const updatedLeg =
              await tx.bookingLeg.findUnique({
                where: {
                  id:
                    currentLeg.id,
                },
                include: {
                  trip: true,
                },
              });

            if (!updatedLeg) {
              throw new Error(
                "Booking leg disappeared after trip start"
              );
            }

            const updatedBooking =
              await tx.booking.update({
                where: {
                  id:
                    booking.id,
                },
                data: {
                  status:
                    "IN_PROGRESS",
                  assignedDriverId:
                    driverId,
                  vehicleId:
                    currentLeg.vehicleId ??
                    undefined,
                },
              });

            return {
              trip,
              leg:
                updatedLeg,
              booking:
                updatedBooking,
              alreadyStarted:
                false,
            };
          }
        );

      return res.status(201).json({
        success: true,
        message:
          "Trip started successfully",
        data: result,
      });
    } catch (error) {
      console.error(
        "BOOKING START TRIP ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to start trip",
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
 * COMPLETE TRIP
 * =========================================================
 *
 * POST /api/v1/trips/:tripId/complete
 *
 * Body:
 * {
 *   driverId: string
 * }
 *
 * finalizeTrip performs the authoritative completion,
 * fare/ledger/earning/payment logic and Connection leg
 * orchestration.
 */
router.post(
  "/:tripId/complete",
  async (req, res) => {
    try {
      const tripId =
        String(
          req.params.tripId ??
            ""
        ).trim();

      const driverId =
        String(
          req.body?.driverId ??
            ""
        ).trim();

      if (
        !tripId ||
        !driverId
      ) {
        return res.status(400).json({
          success: false,
          message:
            "tripId and driverId are required",
        });
      }

      const trip =
        await prisma.trip.findUnique({
          where: {
            id: tripId,
          },
          include: {
            bookingLeg: {
              select: {
                id: true,
                bookingId: true,
                driverId: true,
                status: true,
                tripId: true,
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

      const leg =
        trip.bookingLeg;

      if (!leg) {
        return res.status(409).json({
          success: false,
          message:
            "Trip is not linked to a booking leg",
        });
      }

      if (
        leg.driverId !==
        driverId
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Driver is not assigned to this trip",
        });
      }

      if (
        leg.tripId !==
        tripId
      ) {
        return res.status(409).json({
          success: false,
          message:
            "Trip does not match the assigned booking leg",
        });
      }

      if (
        trip.status ===
        "COMPLETED"
      ) {
        return res.json({
          success: true,
          alreadyCompleted:
            true,
          message:
            "Trip already completed",
          data: trip,
        });
      }

      if (
        trip.status !==
          "IN_PROGRESS" &&
        trip.status !==
          "STARTED"
      ) {
        return res.status(409).json({
          success: false,
          message:
            `Trip cannot be completed from status ${trip.status}`,
        });
      }

      const result =
        await finalizeTrip({
          bookingId:
            leg.bookingId,
          source:
            "DRIVER",
        });

      return res.json({
        success: true,
        message:
          "Trip completed successfully",
        data: {
          ...result,
          tripId,
        },
      });
    } catch (error) {
      console.error(
        "COMPLETE TRIP ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to complete trip",
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
 * ACTIVE TRIP FOR DRIVER
 * =========================================================
 *
 * GET /api/v1/trips/driver/:driverId/active
 */
router.get(
  "/driver/:driverId/active",
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

      const leg =
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
          include: {
            booking: {
              select: {
                id: true,
                customerId: true,
                status: true,
                rideType: true,
                pickupAddress: true,
                dropAddress: true,
              },
            },
            trip: {
              include: {
                locations: {
                  orderBy: {
                    recordedAt:
                      "desc",
                  },
                  take: 50,
                },
              },
            },
          },
        });

      if (!leg) {
        return res.json({
          success: true,
          data: null,
        });
      }

      return res.json({
        success: true,
        data: {
          leg,
          trip:
            leg.trip,
        },
      });
    } catch (error) {
      console.error(
        "GET ACTIVE DRIVER TRIP ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load active driver trip",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

export {
  router as tripsRouter,
};

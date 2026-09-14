import { Router } from "express";
import { RatingTarget } from "@prisma/client";
import { prisma } from "../lib/prisma";

const router = Router();

/**
 * =========================================================
 * CREATE / UPDATE RATING
 * =========================================================
 *
 * Customer can rate a completed RideX booking.
 *
 * Normal Ride:
 * - RIDE rating = rating for the overall ride.
 * - DRIVER rating = rating for the assigned driver.
 *
 * Connection Ride:
 * - The booking represents the complete journey.
 * - Customer gives ONE RIDE rating for the whole journey.
 * - DRIVER rating is intentionally NOT allowed because a
 *   Connection Ride may contain multiple drivers across legs.
 * - Connection RIDE ratings never write a driverId.
 *
 * Same customer + booking + target:
 * one rating record is maintained.
 */
router.post("/", async (req, res) => {
  try {
    const bookingId = String(
      req.body?.bookingId ?? ""
    ).trim();

    const customerId = String(
      req.body?.customerId ?? ""
    ).trim();

    const suppliedDriverId =
      req.body?.driverId !== undefined &&
      req.body?.driverId !== null
        ? String(req.body.driverId).trim()
        : "";

    /**
     * Rating target
     */
    const rawTarget = String(
      req.body?.target ?? "RIDE"
    )
      .trim()
      .toUpperCase();

    const allowedTargets: RatingTarget[] = [
      RatingTarget.RIDE,
      RatingTarget.DRIVER,
    ];

    if (
      !allowedTargets.includes(
        rawTarget as RatingTarget
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid rating target",
        allowedTargets,
      });
    }

    const target =
      rawTarget as RatingTarget;

    const stars = Number(
      req.body?.stars
    );

    const comment =
      req.body?.comment !== undefined &&
      req.body?.comment !== null
        ? String(req.body.comment).trim()
        : null;

    /**
     * =====================================================
     * BASIC VALIDATION
     * =====================================================
     */
    if (!bookingId || !customerId) {
      return res.status(400).json({
        success: false,
        message:
          "bookingId and customerId are required",
      });
    }

    if (
      !Number.isInteger(stars) ||
      stars < 1 ||
      stars > 5
    ) {
      return res.status(400).json({
        success: false,
        message:
          "stars must be an integer between 1 and 5",
      });
    }

    /**
     * =====================================================
     * BOOKING CHECK
     * =====================================================
     */
    const booking =
      await prisma.booking.findUnique({
        where: {
          id: bookingId,
        },
        include: {
          assignedDriver: true,
        },
      });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    /**
     * Rating is tied to the customer of the booking.
     */
    if (
      booking.customerId !== customerId
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Customer is not allowed to rate this booking",
      });
    }

    /**
     * Only completed rides can be rated.
     */
    if (booking.status !== "COMPLETED") {
      return res.status(400).json({
        success: false,
        message:
          "Rating is available after ride completion",
      });
    }

    const isConnectionRide =
      booking.bookingType === "RIDE" &&
      booking.rideType === "CONNECTION_RIDE";

    /**
     * =====================================================
     * CONNECTION RIDE RULE
     * =====================================================
     *
     * A Connection Ride is one customer journey made from
     * multiple automatic legs. There is no single driver to
     * rate for the entire booking, so only RIDE is allowed.
     */
    if (
      isConnectionRide &&
      target === RatingTarget.DRIVER
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Connection Ride supports one RIDE rating for the whole journey; individual DRIVER ratings are not allowed",
      });
    }

    /**
     * For a whole-journey RIDE rating, driverId is not used.
     * Reject a supplied driverId instead of silently attaching
     * a driver to a booking-level rating.
     */
    if (
      target === RatingTarget.RIDE &&
      suppliedDriverId
    ) {
      return res.status(400).json({
        success: false,
        message:
          "driverId must not be supplied for a RIDE rating",
      });
    }

    /**
     * =====================================================
     * DRIVER VALIDATION
     * =====================================================
     *
     * DRIVER validation applies only to DRIVER ratings.
     * Connection Ride never reaches this branch because its
     * DRIVER target is rejected above.
     */
    const finalDriverId =
      target === RatingTarget.DRIVER
        ? suppliedDriverId ||
          booking.assignedDriverId ||
          null
        : null;

    if (
      target === RatingTarget.DRIVER &&
      finalDriverId &&
      booking.assignedDriverId &&
      finalDriverId !==
        booking.assignedDriverId
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Driver does not belong to this booking",
      });
    }

    /**
     * A DRIVER target requires an assigned driver.
     */
    if (
      target === RatingTarget.DRIVER &&
      !finalDriverId
    ) {
      return res.status(400).json({
        success: false,
        message:
          "A driver rating requires an assigned driver",
      });
    }

    /**
     * =====================================================
     * CREATE / UPDATE RATING
     * =====================================================
     */
    const row =
      await prisma.rating.upsert({
        where: {
          bookingId_customerId_target: {
            bookingId,
            customerId,
            target,
          },
        },

        create: {
          bookingId,
          customerId,
          driverId: finalDriverId,
          stars,
          comment,
          target,
        },

        update: {
          stars,
          comment,
          driverId: finalDriverId,
        },
      });

    /**
     * =====================================================
     * RECALCULATE DRIVER RATING
     * =====================================================
     *
     * Driver averages are maintained only from DRIVER ratings.
     * A Connection Ride RIDE rating must never alter an
     * individual driver's rating.
     */
    if (
      target === RatingTarget.DRIVER &&
      finalDriverId
    ) {
      const ratings =
        await prisma.rating.findMany({
          where: {
            driverId: finalDriverId,
            target:
              RatingTarget.DRIVER,
          },
          select: {
            stars: true,
          },
        });

      const totalStars =
        ratings.reduce(
          (sum, rating) =>
            sum + rating.stars,
          0
        );

      const averageRating =
        totalStars /
        Math.max(1, ratings.length);

      await prisma.driver.update({
        where: {
          id: finalDriverId,
        },
        data: {
          rating:
            Math.round(
              averageRating * 100
            ) / 100,
        },
      });
    }

    return res.status(201).json({
      success: true,
      data: row,
      message:
        isConnectionRide
          ? "Connection Ride rating saved successfully"
          : "Rating saved successfully",
    });
  } catch (error) {
    console.error(
      "RATING ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to save rating",
      error:
        error instanceof Error
          ? error.message
          : String(error),
    });
  }
});

/**
 * =========================================================
 * GET BOOKING RATINGS
 * =========================================================
 */
router.get(
  "/booking/:bookingId",
  async (req, res) => {
    try {
      const bookingId = String(
        req.params.bookingId ?? ""
      ).trim();

      if (!bookingId) {
        return res.status(400).json({
          success: false,
          message:
            "bookingId is required",
        });
      }

      const ratings =
        await prisma.rating.findMany({
          where: {
            bookingId,
          },
          orderBy: {
            createdAt: "desc",
          },
        });

      return res.json({
        success: true,
        data: ratings,
      });
    } catch (error) {
      console.error(
        "BOOKING RATINGS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load booking ratings",
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
 * GET DRIVER RATING
 * =========================================================
 */
router.get(
  "/driver/:driverId",
  async (req, res) => {
    try {
      const driverId = String(
        req.params.driverId ?? ""
      ).trim();

      if (!driverId) {
        return res.status(400).json({
          success: false,
          message:
            "driverId is required",
        });
      }

      const ratings =
        await prisma.rating.findMany({
          where: {
            driverId,
            target:
              RatingTarget.DRIVER,
          },
          select: {
            stars: true,
            comment: true,
            target: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        });

      const total =
        ratings.reduce(
          (sum, rating) =>
            sum + rating.stars,
          0
        );

      const average =
        total /
        Math.max(1, ratings.length);

      return res.json({
        success: true,
        data: {
          driverId,
          average:
            Math.round(
              average * 100
            ) / 100,
          totalRatings:
            ratings.length,
          ratings,
        },
      });
    } catch (error) {
      console.error(
        "DRIVER RATINGS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load driver ratings",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

export {
  router as ratingsRouter,
};

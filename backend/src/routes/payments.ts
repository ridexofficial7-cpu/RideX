import { Router } from "express";
import {
  PaymentMethod,
} from "@prisma/client";
import { prisma } from "../lib/prisma";

const router = Router();

/**
 * =========================================================
 * PAYMENT ROUTES
 * =========================================================
 *
 * TEST MODE
 *
 * Current MVP flow:
 *
 * Customer App
 *      ↓
 * POST /payments/intent
 *      ↓
 * Payment PENDING
 *      ↓
 * POST /payments/test-success
 *      ↓
 * Payment SUCCESS
 *
 * Real UPI / Card gateway integration बाद में जोड़ी जाएगी।
 *
 * Important:
 * - Financial amount backend booking से लिया जाएगा.
 * - Customer द्वारा भेजे गए estimatedFare को trusted amount
 *   नहीं माना जाएगा.
 * - Successful payment को दोबारा PENDING नहीं किया जाएगा.
 * - Write operations verify booking ownership using customerId.
 * =========================================================
 */

/**
 * =========================================================
 * CREATE PAYMENT INTENT
 * =========================================================
 */
router.post("/intent", async (req, res) => {
  try {
    const bookingId = String(
      req.body?.bookingId ?? ""
    ).trim();

    const customerId = String(
      req.body?.customerId ?? ""
    ).trim();

    const rawMethod = String(
      req.body?.method ?? "UPI"
    )
      .trim()
      .toUpperCase();

    const allowedMethods: PaymentMethod[] = [
      PaymentMethod.UPI,
      PaymentMethod.CARD,
      PaymentMethod.CASH,
    ];

    if (!bookingId || !customerId) {
      return res.status(400).json({
        success: false,
        message: "bookingId and customerId are required",
      });
    }

    if (
      !allowedMethods.includes(
        rawMethod as PaymentMethod
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment method",
        allowedMethods,
      });
    }

    const method =
      rawMethod as PaymentMethod;

    /**
     * Load booking.
     */
    const booking =
      await prisma.booking.findUnique({
        where: {
          id: bookingId,
        },
        include: {
          payment: true,
        },
      });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    /**
     * Customer ownership check.
     */
    if (booking.customerId !== customerId) {
      return res.status(403).json({
        success: false,
        message:
          "Customer is not allowed to access payment for this booking",
      });
    }

    /**
     * Booking already cancelled.
     */
    if (booking.status === "CANCELLED") {
      return res.status(400).json({
        success: false,
        message:
          "Payment cannot be created for a cancelled booking",
      });
    }

    /**
     * Completed booking must use final fare when available.
     * Otherwise estimated fare is used.
     *
     * Backend remains the financial source of truth.
     */
    const amount = Number(
      booking.finalFare ??
        booking.estimatedFare ??
        0
    );

    if (
      !Number.isFinite(amount) ||
      amount < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking fare",
      });
    }

    /**
     * =====================================================
     * CASH
     * =====================================================
     */
    if (method === PaymentMethod.CASH) {
      const payment =
        await prisma.payment.upsert({
          where: {
            bookingId,
          },

          create: {
            bookingId,
            customerId:
              booking.customerId,
            amount,
            method:
              PaymentMethod.CASH,
            status: "PENDING",
          },

          update: {
            amount,
            method:
              PaymentMethod.CASH,
          },
        });

      return res.json({
        success: true,
        mode: "TEST",
        paymentRequired: false,
        data: payment,
        message:
          "Cash payment selected. Collection will be recorded during trip completion.",
      });
    }

    /**
     * =====================================================
     * ONLINE PAYMENT
     * =====================================================
     */

    /**
     * Existing successful payment must not be reset.
     */
    if (
      booking.payment &&
      booking.payment.status === "SUCCESS"
    ) {
      return res.json({
        success: true,
        mode: "TEST",
        paymentRequired: false,
        data: booking.payment,
        message:
          "Payment already completed",
      });
    }

    const payment =
      await prisma.payment.upsert({
        where: {
          bookingId,
        },

        create: {
          bookingId,
          customerId:
            booking.customerId,
          amount,
          method,
          status: "PENDING",
        },

        update: {
          amount,
          method,
          status: "PENDING",
          paidAt: null,
        },
      });

    return res.json({
      success: true,
      mode: "TEST",
      paymentRequired: true,
      data: payment,
      message:
        "Test payment intent created. Real gateway integration is still pending.",
    });
  } catch (error) {
    console.error(
      "PAYMENT INTENT ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to create payment intent",
      error:
        error instanceof Error
          ? error.message
          : String(error),
    });
  }
});

/**
 * =========================================================
 * TEST PAYMENT SUCCESS
 * =========================================================
 *
 * TEST ONLY
 */
router.post(
  "/test-success",
  async (req, res) => {
    if (String(process.env.RIDEX_TEST_MODE ?? "false").toLowerCase() !== "true") {
      return res.status(404).json({ success: false, message: "Test payment endpoint is disabled" });
    }
    try {
      const bookingId = String(
        req.body?.bookingId ?? ""
      ).trim();

      const customerId = String(
        req.body?.customerId ?? ""
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
          include: {
            payment: true,
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
       * Customer ownership check.
       */
      if (booking.customerId !== customerId) {
        return res.status(403).json({
          success: false,
          message:
            "Customer is not allowed to complete payment for this booking",
        });
      }

      /**
       * Idempotent:
       * already-successful payment returns itself.
       */
      if (
        booking.payment &&
        booking.payment.status ===
          "SUCCESS"
      ) {
        return res.json({
          success: true,
          mode: "TEST",
          alreadyProcessed: true,
          data: booking.payment,
          message:
            "Payment already marked as successful",
        });
      }

      /**
       * A cancelled booking cannot be paid.
       */
      if (booking.status === "CANCELLED") {
        return res.status(400).json({
          success: false,
          message:
            "Payment cannot be completed for a cancelled booking",
        });
      }

      const amount = Number(
        booking.finalFare ??
          booking.estimatedFare ??
          0
      );

      if (
        !Number.isFinite(amount) ||
        amount < 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid booking fare",
        });
      }

      const payment =
        await prisma.payment.upsert({
          where: {
            bookingId,
          },

          create: {
            bookingId,
            customerId:
              booking.customerId,
            amount,
            method:
              booking.payment?.method ??
              PaymentMethod.UPI,
            status: "SUCCESS",
            paidAt: new Date(),
          },

          update: {
            amount,
            status: "SUCCESS",
            paidAt: new Date(),
          },
        });

      return res.json({
        success: true,
        mode: "TEST",
        data: payment,
        message:
          "Test payment marked as successful",
      });
    } catch (error) {
      console.error(
        "TEST PAYMENT SUCCESS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to complete test payment",
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
 * PAYMENT DETAILS
 * =========================================================
 */
router.get(
  "/:bookingId",
  async (req, res) => {
    try {
      const bookingId = String(
        req.params.bookingId ?? ""
      ).trim();

      const customerId = String(
        req.query?.customerId ??
          req.body?.customerId ??
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
          },
        });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found",
        });
      }

      if (
        booking.customerId !==
        customerId
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Customer is not allowed to access payment for this booking",
        });
      }

      const payment =
        await prisma.payment.findUnique({
          where: {
            bookingId,
          },
        });

      if (!payment) {
        return res.status(404).json({
          success: false,
          message:
            "Payment not found",
        });
      }

      return res.json({
        success: true,
        data: payment,
      });
    } catch (error) {
      console.error(
        "PAYMENT DETAILS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load payment",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
);

export {
  router as paymentsRouter,
};

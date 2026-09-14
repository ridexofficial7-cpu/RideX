import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import { UserStatus, UserType } from "@prisma/client";
import {
  createAuthSession,
  revokeAuthSession,
} from "../services/authSession";
import { getSystemConfig } from "../services/systemConfig";

const router = Router();

/* =========================================================
   OTP CHALLENGE CONFIGURATION
   ========================================================= */

const OTP_TTL_MS = 5 * 60_000;
const MAX_OTP_ATTEMPTS = 5;

function hashOtp(mobile: string, otp: string) {
  return crypto
    .createHash("sha256")
    .update(`${mobile}:${otp}:${process.env.JWT_SECRET ?? "ridex"}`)
    .digest("hex");
}

/* =========================================================
   HELPERS
   ========================================================= */

const normalizeMobile = (value: unknown): string =>
  String(value ?? "")
    .replace(/\D/g, "")
    .slice(-10);

const isTestMode = (): boolean =>
  String(process.env.RIDEX_TEST_MODE ?? "false").toLowerCase() ===
  "true";

const isTesterApprovalRequired = (): boolean => String(process.env.RIDEX_TESTER_APPROVAL_REQUIRED ?? "true").toLowerCase() === "true";

async function assertTestAccess(mobile: string, userType: UserType) {
  if (!isTestMode() || !isTesterApprovalRequired() || userType === UserType.ADMIN) return true;
  const tester = await prisma.approvedTester.findFirst({ where: { mobile, active: true } });
  return Boolean(tester);
}

function makeOtp(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/* =========================================================
   OTP DELIVERY
   ========================================================= */

async function deliverOtp(
  mobile: string,
  otp: string
): Promise<boolean> {
  const url = await getSystemConfig(
    "OTP_PROVIDER_URL",
    String(process.env.OTP_PROVIDER_URL ?? "").trim()
  );

  if (!url) {
    return false;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const apiKey = await getSystemConfig(
    "OTP_PROVIDER_API_KEY",
    String(process.env.OTP_PROVIDER_API_KEY ?? "").trim()
  );

  const username = await getSystemConfig(
    "OTP_PROVIDER_USERNAME",
    String(process.env.OTP_PROVIDER_USERNAME ?? "").trim()
  );

  const password = await getSystemConfig(
    "OTP_PROVIDER_PASSWORD",
    String(process.env.OTP_PROVIDER_PASSWORD ?? "").trim()
  );

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  } else if (username && password) {
    headers.Authorization =
      `Basic ${Buffer.from(
        `${username}:${password}`
      ).toString("base64")}`;
  }

  const senderId = await getSystemConfig(
    "OTP_PROVIDER_SENDER_ID",
    String(process.env.OTP_PROVIDER_SENDER_ID ?? "").trim()
  );

  const timeoutMs = Number(
    process.env.OTP_PROVIDER_TIMEOUT_MS ?? 8000
  );

  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, Number.isFinite(timeoutMs) ? timeoutMs : 8000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        mobile,
        otp,
        senderId: senderId || undefined,
        message:
          `Your RideX OTP is ${otp}. Valid for 5 minutes.`,
      }),
      signal: controller.signal,
    });

    return response.ok;
  } catch (error) {
    console.error("OTP PROVIDER ERROR:", error);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/* =========================================================
   SEND OTP
   ========================================================= */

router.post("/send-otp", async (req, res) => {
  try {
    const mobile = normalizeMobile(req.body?.mobile);

    const requestedType = String(
      req.body?.userType ?? "CUSTOMER"
    )
      .trim()
      .toUpperCase();

    if (!/^\d{10}$/.test(mobile)) {
      return res.status(400).json({
        success: false,
        message: "Valid 10-digit mobile is required",
      });
    }

    if (
      !Object.values(UserType).includes(
        requestedType as UserType
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid user type",
      });
    }

    const userType = requestedType as UserType;

    if (!(await assertTestAccess(mobile, userType))) {
      return res.status(403).json({ success: false, message: "This mobile is not approved for the RideX TEST environment" });
    }

    /*
     * Admin accounts must already exist.
     * Customer/Driver accounts can be created during verification.
     */
    if (userType === UserType.ADMIN) {
      const adminUser = await prisma.user.findUnique({
        where: { mobile },
        include: { admin: true },
      });

      if (!adminUser?.admin) {
        return res.status(404).json({
          success: false,
          message: "Admin account not found",
        });
      }

      if (
        adminUser.status !== UserStatus.ACTIVE
      ) {
        return res.status(403).json({
          success: false,
          message: "Admin account is not active",
        });
      }

      if (
        adminUser.admin.approvalStatus !==
        "APPROVED"
      ) {
        return res.status(403).json({
          success: false,
          message: "Admin account is not approved",
        });
      }
    }

    const otp = isTestMode()
      ? "1234"
      : makeOtp();

    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    await prisma.otpChallenge.deleteMany({
      where: { mobile, userType, consumedAt: null },
    });
    await prisma.otpChallenge.create({
      data: {
        mobile,
        userType,
        otpHash: hashOtp(mobile, otp),
        expiresAt,
      },
    });

    if (!isTestMode()) {
      const delivered = await deliverOtp(
        mobile,
        otp
      );

      if (!delivered) {
        await prisma.otpChallenge.deleteMany({
          where: { mobile, userType, consumedAt: null },
        });

        return res.status(503).json({
          success: false,
          message:
            "OTP provider is not configured or unavailable",
        });
      }
    }

    return res.json({
      success: true,
      message: "OTP sent successfully",
      mobile,

      ...(isTestMode()
        ? {
            testOtp: otp,
          }
        : {}),
    });
  } catch (error) {
    console.error("SEND OTP ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to send OTP",
    });
  }
});

/* =========================================================
   VERIFY OTP
   ========================================================= */

router.post("/verify-otp", async (req, res) => {
  try {
    const mobile = normalizeMobile(req.body?.mobile);

    const otp = String(
      req.body?.otp ?? ""
    ).trim();

    const requestedType = String(
      req.body?.userType ?? "CUSTOMER"
    )
      .trim()
      .toUpperCase() as UserType;

    if (!/^\d{10}$/.test(mobile)) {
      return res.status(400).json({
        success: false,
        message: "Valid 10-digit mobile is required",
      });
    }

    if (
      !Object.values(UserType).includes(
        requestedType
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid user type",
      });
    }

    if (!(await assertTestAccess(mobile, requestedType))) {
      return res.status(403).json({ success: false, message: "This mobile is not approved for the RideX TEST environment" });
    }

    const record = await prisma.otpChallenge.findFirst({
      where: {
        mobile,
        userType: requestedType,
        consumedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!record) {
      return res.status(400).json({
        success: false,
        message: "OTP not found. Request a new OTP.",
      });
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      await prisma.otpChallenge.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      return res.status(400).json({
        success: false,
        message: "OTP expired. Request a new OTP.",
      });
    }

    const attempts = record.attempts + 1;
    await prisma.otpChallenge.update({
      where: { id: record.id },
      data: { attempts },
    });

    if (attempts > MAX_OTP_ATTEMPTS) {
      await prisma.otpChallenge.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      return res.status(429).json({
        success: false,
        message: "Too many OTP attempts",
      });
    }

    if (hashOtp(mobile, otp) !== record.otpHash) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    await prisma.otpChallenge.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    /* -------------------------------------------------------
       FIND EXISTING USER
       ------------------------------------------------------- */

    let user = await prisma.user.findUnique({
      where: { mobile },
      include: {
        customer: true,
        driver: true,
        admin: true,
      },
    });

    /* -------------------------------------------------------
       CREATE CUSTOMER / DRIVER USER
       ------------------------------------------------------- */

    if (!user) {
      if (
        requestedType === UserType.ADMIN
      ) {
        return res.status(404).json({
          success: false,
          message:
            "Admin account not found",
        });
      }

      user = await prisma.user.create({
        data: {
          mobile,

          userType:
            requestedType === UserType.DRIVER
              ? UserType.DRIVER
              : UserType.CUSTOMER,

          status: UserStatus.ACTIVE,
        },

        include: {
          customer: true,
          driver: true,
          admin: true,
        },
      });
    }

    /* -------------------------------------------------------
       ACCOUNT TYPE CHECK
       ------------------------------------------------------- */

    if (
      user.userType !== requestedType
    ) {
      return res.status(403).json({
        success: false,
        message:
          "This mobile is registered for a different account type",
      });
    }

    /* -------------------------------------------------------
       ACCOUNT STATUS
       ------------------------------------------------------- */

    if (
      user.status !== UserStatus.ACTIVE
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Account is not active",
      });
    }

    /* -------------------------------------------------------
       ADMIN APPROVAL
       ------------------------------------------------------- */

    if (
      user.userType === UserType.ADMIN
    ) {
      if (!user.admin) {
        return res.status(403).json({
          success: false,
          message:
            "Admin profile not found",
        });
      }

      if (
        user.admin.approvalStatus !==
        "APPROVED"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Admin account is not approved",
        });
      }
    }

    /* -------------------------------------------------------
       ENSURE CUSTOMER PROFILE
       ------------------------------------------------------- */

    if (
      user.userType === UserType.CUSTOMER &&
      !user.customer
    ) {
      await prisma.customer.create({
        data: {
          userId: user.id,
          fullName:
            `Customer ${mobile.slice(-4)}`,
        },
      });
    }

    /* -------------------------------------------------------
       ENSURE DRIVER PROFILE
       ------------------------------------------------------- */

    if (
      user.userType === UserType.DRIVER &&
      !user.driver
    ) {
      await prisma.driver.create({
        data: {
          userId: user.id,
          fullName:
            `Driver ${mobile.slice(-4)}`,
        },
      });
    }

    /* -------------------------------------------------------
       CREATE AUTH SESSION
       ------------------------------------------------------- */

    const session =
      await createAuthSession({
        userId: user.id,
        userType: user.userType,

        deviceInfo:
          String(
            req.headers["user-agent"] ?? ""
          ).slice(0, 250) || null,

        ipAddress:
          req.ip || null,
      });

    /* -------------------------------------------------------
       REFRESH USER DATA
       ------------------------------------------------------- */

    const fresh =
      await prisma.user.findUnique({
        where: {
          id: user.id,
        },

        include: {
          customer: true,
          driver: true,
          admin: true,
        },
      });

    /* -------------------------------------------------------
       RESPONSE
       ------------------------------------------------------- */

    return res.json({
      success: true,

      data: {
        token: session.token,
        session: session.session,

        userId: user.id,

        userType: user.userType,

        customerId:
          fresh?.customer?.id ?? null,

        driverId:
          fresh?.driver?.id ?? null,

        adminId:
          fresh?.admin?.id ?? null,
      },
    });
  } catch (error) {
    console.error(
      "VERIFY OTP ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to verify OTP",
    });
  }
});

/* =========================================================
   LOGOUT
   ========================================================= */

router.post("/logout", async (req, res) => {
  try {
    const header = String(
      req.headers.authorization ?? ""
    );

    const match =
      /^Bearer\s+(.+)$/i.exec(
        header.trim()
      );

    if (!match) {
      return res.json({
        success: true,
        message:
          "Already signed out",
      });
    }

    await revokeAuthSession(
      match[1]
    );

    return res.json({
      success: true,
      message:
        "Logged out successfully",
    });
  } catch (error) {
    console.error(
      "LOGOUT ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to logout",
    });
  }
});

export { router as authRouter };
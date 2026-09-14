import { Router } from "express";
import { UserType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getSystemConfigStatus, setSystemConfig } from "../services/systemConfig";

const router = Router();

const ALLOWED_KEYS = [
  "OTP_PROVIDER_URL",
  "OTP_PROVIDER_API_KEY",
  "OTP_PROVIDER_USERNAME",
  "OTP_PROVIDER_PASSWORD",
  "OTP_PROVIDER_SENDER_ID",
  "ROUTING_URL",
  "GOOGLE_MAPS_API_KEY",
  "PAYMENT_PROVIDER_URL",
  "PAYMENT_PROVIDER_API_KEY",
  "PAYMENT_PROVIDER_USERNAME",
  "PAYMENT_PROVIDER_PASSWORD",
] as const;

async function requireSuperAdmin(req: any, res: any) {
  if (req.auth?.userType !== UserType.ADMIN) {
    res.status(403).json({ success: false, message: "Admin access required" });
    return false;
  }
  const admin = await prisma.adminUser.findUnique({ where: { userId: req.auth.userId }, include: { role: true } });
  if (!admin || admin.approvalStatus !== "APPROVED" || String(admin.role.name).toUpperCase() !== "SUPER_ADMIN") {
    res.status(403).json({ success: false, message: "Super Admin access required" });
    return false;
  }
  return true;
}

router.get("/status", async (req, res) => {
  if (!(await requireSuperAdmin(req, res))) return;
  return res.json({ success: true, data: await getSystemConfigStatus(ALLOWED_KEYS) });
});

router.put("/:key", async (req, res) => {
  if (!(await requireSuperAdmin(req, res))) return;
  const key = String(req.params.key ?? "").trim().toUpperCase();
  if (!(ALLOWED_KEYS as readonly string[]).includes(key)) return res.status(400).json({ success: false, message: "Unsupported configuration key" });
  const value = String(req.body?.value ?? "").trim();
  if (!value) return res.status(400).json({ success: false, message: "Configuration value is required" });
  await setSystemConfig(key, value);
  return res.json({ success: true, message: `${key} updated securely` });
});

export { router as configurationRouter };

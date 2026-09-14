import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

router.get("/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ success: true, status: "ready", version: "5.6.0", mode: process.env.NODE_ENV === "production" ? "PRODUCTION" : "TEST" });
  } catch (error) {
    return res.status(503).json({ success: false, status: "not_ready", message: error instanceof Error ? error.message : String(error) });
  }
});

router.get("/version", (_req, res) => res.json({ success: true, app: "RideX", version: "5.6.0", api: "/api/v1" }));

export { router as metaRouter };

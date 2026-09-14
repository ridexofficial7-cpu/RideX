import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ success: true, status: "ok", database: "ok", mode: process.env.NODE_ENV === "production" ? "PRODUCTION" : "TEST" });
  } catch (error) {
    return res.status(503).json({ success: false, status: "degraded", database: "unavailable", message: error instanceof Error ? error.message : String(error) });
  }
});

export { router as healthRouter };

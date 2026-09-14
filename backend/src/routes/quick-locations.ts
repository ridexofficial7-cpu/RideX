import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    const data = await prisma.quickLocation.findMany({ where: { active: true, ...(category ? { category } : {}) }, orderBy: [{ category: "asc" }, { name: "asc" }] });
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load quick locations", error: error instanceof Error ? error.message : String(error) });
  }
});

export { router as quickLocationsRouter };

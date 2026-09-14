import crypto from "node:crypto";
import { prisma } from "../lib/prisma";

export type PlatformMode = "TEST" | "LIVE";

export function getPlatformMode(): PlatformMode {
  const value = String(process.env.RIDEX_ENVIRONMENT || process.env.NODE_ENV || "TEST").toUpperCase();
  return value === "PRODUCTION" || value === "LIVE" ? "LIVE" : "TEST";
}

export function hashRelease(bytes: Buffer) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export async function ensureEnvironmentControl() {
  return prisma.environmentControl.upsert({
    where: { key: "RIDEX_PRIMARY_ENVIRONMENT" },
    update: {},
    create: {
      key: "RIDEX_PRIMARY_ENVIRONMENT",
      activeEnvironment: "TEST",
      deploymentStatus: "TESTING",
      currentVersion: "5.6.0",
    },
  });
}

export async function getEnvironmentState() {
  const [control, testers, releases] = await Promise.all([
    ensureEnvironmentControl(),
    prisma.approvedTester.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.projectRelease.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  return { control, testers, releases, runtimeEnvironment: getPlatformMode() };
}

export function assertTestEnvironment() {
  if (getPlatformMode() !== "TEST") throw new Error("This operation is test-only while the backend is running in LIVE mode.");
}

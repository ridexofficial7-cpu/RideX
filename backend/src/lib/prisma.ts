import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const runtimeMode = String(process.env.RIDEX_ENVIRONMENT || process.env.NODE_ENV || "TEST").toUpperCase();
const databaseUrl = runtimeMode === "LIVE" || runtimeMode === "PRODUCTION"
  ? (process.env.DATABASE_URL_LIVE || process.env.DATABASE_URL || "")
  : (process.env.DATABASE_URL_TEST || process.env.DATABASE_URL || "");

if (!databaseUrl) {
  throw new Error(`RideX database configuration missing for ${runtimeMode}. Set DATABASE_URL_${runtimeMode === "LIVE" || runtimeMode === "PRODUCTION" ? "LIVE" : "TEST"}.`);
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ datasources: { db: { url: databaseUrl } } });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma";

const PREFIX = "enc:v1:";

function encryptionKey() {
  const raw = String(process.env.RIDEX_CONFIG_ENCRYPTION_KEY ?? "").trim();
  if (!raw) throw new Error("RIDEX_CONFIG_ENCRYPTION_KEY is required for provider secret storage");
  return createHash("sha256").update(raw).digest();
}

export function encryptConfigValue(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function decryptConfigValue(value: string) {
  if (!value.startsWith(PREFIX)) return value;
  const packed = Buffer.from(value.slice(PREFIX.length), "base64url");
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export async function getSystemConfig(key: string, fallback = "") {
  const row = await prisma.systemConfiguration.findUnique({ where: { key }, select: { value: true } });
  if (!row) return fallback;
  try { return decryptConfigValue(row.value); } catch { return fallback; }
}

export async function setSystemConfig(key: string, value: string, description?: string | null) {
  return prisma.systemConfiguration.upsert({
    where: { key },
    create: { key, value: encryptConfigValue(value), description: description ?? null },
    update: { value: encryptConfigValue(value), ...(description !== undefined ? { description } : {}) },
  });
}

export async function getSystemConfigStatus(keys: readonly string[]) {
  const rows = await prisma.systemConfiguration.findMany({ where: { key: { in: [...keys] } }, select: { key: true, updatedAt: true } });
  const map = new Map(rows.map((row) => [row.key, row]));
  return keys.map((key) => ({ key, configured: map.has(key), updatedAt: map.get(key)?.updatedAt ?? null }));
}

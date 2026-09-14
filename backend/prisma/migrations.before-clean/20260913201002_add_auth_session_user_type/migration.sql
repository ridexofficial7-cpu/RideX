/*
  Warnings:

  - Added the required column `userType` to the `AuthSession` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "AuthSession_userId_expiresAt_idx";

-- DropIndex
DROP INDEX "AuthSession_userId_revokedAt_idx";

-- AlterTable
ALTER TABLE "AuthSession" ADD COLUMN     "userType" "UserType" NOT NULL;

-- CreateIndex
CREATE INDEX "AuthSession_userId_userType_idx" ON "AuthSession"("userId", "userType");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthSession_revokedAt_idx" ON "AuthSession"("revokedAt");

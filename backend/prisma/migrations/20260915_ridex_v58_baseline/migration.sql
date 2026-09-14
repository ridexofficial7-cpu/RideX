-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "parcelServiceEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "dropZoneId" TEXT,
ADD COLUMN     "environment" TEXT NOT NULL DEFAULT 'TEST',
ADD COLUMN     "pickupZoneId" TEXT,
ADD COLUMN     "requestedDurationMinutes" INTEGER,
ADD COLUMN     "serviceSubtype" TEXT,
ADD COLUMN     "sharedGroupId" TEXT;

-- AlterTable
ALTER TABLE "BookingLeg" ADD COLUMN     "connectionPointZoneId" TEXT,
ADD COLUMN     "handoverAt" TIMESTAMP(3),
ADD COLUMN     "handoverFromDriverId" TEXT,
ADD COLUMN     "handoverStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "handoverToDriverId" TEXT,
ADD COLUMN     "maxDistanceKm" DOUBLE PRECISION,
ADD COLUMN     "verificationCustomerId" TEXT,
ADD COLUMN     "verificationDriverId" TEXT,
ADD COLUMN     "verificationExpiresAt" TIMESTAMP(3),
ADD COLUMN     "verificationMethod" TEXT NOT NULL DEFAULT 'OTP',
ADD COLUMN     "verificationTokenHash" TEXT,
ADD COLUMN     "verificationUsedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CityZone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "centerLat" DOUBLE PRECISION NOT NULL,
    "centerLng" DOUBLE PRECISION NOT NULL,
    "radiusKm" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "connectionPoint" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CityZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "serviceType" TEXT,
    "bookingType" "BookingType",
    "rideType" "RideType",
    "vehicleType" "VehicleType",
    "zoneId" TEXT,
    "dayOfWeek" TEXT,
    "startTime" TEXT,
    "endTime" TEXT,
    "demandMin" INTEGER,
    "demandMax" INTEGER,
    "minFare" DECIMAL(12,2),
    "maxFare" DECIMAL(12,2),
    "baseFare" DECIMAL(12,2),
    "perKm" DECIMAL(12,2),
    "perMinute" DECIMAL(12,2),
    "waitingPerMinute" DECIMAL(12,2),
    "weightPerKg" DECIMAL(12,2),
    "multiplier" DECIMAL(8,4) NOT NULL DEFAULT 1,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParcelItem" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "pickupAddress" TEXT NOT NULL,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "dropAddress" TEXT NOT NULL,
    "dropLat" DOUBLE PRECISION NOT NULL,
    "dropLng" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "pickedUpAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "receiverName" TEXT,
    "receiverMobile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParcelItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingShareMember" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "customerId" TEXT,
    "pickupSequence" INTEGER NOT NULL DEFAULT 1,
    "dropSequence" INTEGER NOT NULL DEFAULT 1,
    "seatCount" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "boardedAt" TIMESTAMP(3),
    "droppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingShareMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovedTester" (
    "id" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" TEXT,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovedTester_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvironmentControl" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "activeEnvironment" TEXT NOT NULL DEFAULT 'TEST',
    "testApiBaseUrl" TEXT,
    "liveApiBaseUrl" TEXT,
    "currentVersion" TEXT,
    "approvedVersion" TEXT,
    "deploymentStatus" TEXT NOT NULL DEFAULT 'TESTING',
    "updatedByAdminId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnvironmentControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectRelease" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "sourceLabel" TEXT,
    "checksum" TEXT,
    "sourceHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "environment" TEXT NOT NULL DEFAULT 'TEST',
    "testStartedAt" TIMESTAMP(3),
    "testCompletedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "deployedAt" TIMESTAMP(3),
    "approvedByAdminId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRun" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT,
    "testerMobile" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "passed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "results" JSONB,

    CONSTRAINT "TestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataMergeJob" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceScope" TEXT NOT NULL DEFAULT 'HISTORICAL_CURRENT',
    "sourceQuery" JSONB,
    "derivativeData" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewedBy" TEXT,
    "mergedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataMergeJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CityZone_city_active_idx" ON "CityZone"("city", "active");

-- CreateIndex
CREATE INDEX "PricingRule_active_priority_idx" ON "PricingRule"("active", "priority");

-- CreateIndex
CREATE INDEX "PricingRule_serviceType_vehicleType_active_idx" ON "PricingRule"("serviceType", "vehicleType", "active");

-- CreateIndex
CREATE INDEX "ParcelItem_bookingId_sequence_idx" ON "ParcelItem"("bookingId", "sequence");

-- CreateIndex
CREATE INDEX "BookingShareMember_bookingId_status_idx" ON "BookingShareMember"("bookingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovedTester_mobile_key" ON "ApprovedTester"("mobile");

-- CreateIndex
CREATE INDEX "ApprovedTester_active_mobile_idx" ON "ApprovedTester"("active", "mobile");

-- CreateIndex
CREATE UNIQUE INDEX "EnvironmentControl_key_key" ON "EnvironmentControl"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectRelease_version_key" ON "ProjectRelease"("version");

-- CreateIndex
CREATE INDEX "ProjectRelease_environment_status_createdAt_idx" ON "ProjectRelease"("environment", "status", "createdAt");

-- CreateIndex
CREATE INDEX "TestRun_status_startedAt_idx" ON "TestRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "DataMergeJob_status_createdAt_idx" ON "DataMergeJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_environment_sharedGroupId_idx" ON "Booking"("environment", "sharedGroupId");

-- CreateIndex
CREATE INDEX "Booking_pickupZoneId_dropZoneId_status_idx" ON "Booking"("pickupZoneId", "dropZoneId", "status");

-- CreateIndex
CREATE INDEX "BookingLeg_handoverToDriverId_status_idx" ON "BookingLeg"("handoverToDriverId", "status");

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "CityZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelItem" ADD CONSTRAINT "ParcelItem_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingShareMember" ADD CONSTRAINT "BookingShareMember_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingShareMember" ADD CONSTRAINT "BookingShareMember_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "ProjectRelease"("id") ON DELETE SET NULL ON UPDATE CASCADE;


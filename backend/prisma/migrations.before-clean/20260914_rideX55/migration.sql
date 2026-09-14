ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "requestedDurationMinutes" INTEGER;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "serviceSubtype" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "environment" TEXT NOT NULL DEFAULT 'TEST';
ALTER TABLE "BookingLeg" ADD COLUMN IF NOT EXISTS "verificationMethod" TEXT NOT NULL DEFAULT 'OTP';
ALTER TABLE "BookingLeg" ADD COLUMN IF NOT EXISTS "verificationTokenHash" TEXT;
ALTER TABLE "BookingLeg" ADD COLUMN IF NOT EXISTS "verificationExpiresAt" TIMESTAMP(3);
ALTER TABLE "BookingLeg" ADD COLUMN IF NOT EXISTS "handoverStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED';
ALTER TABLE "BookingLeg" ADD COLUMN IF NOT EXISTS "maxDistanceKm" DOUBLE PRECISION;
ALTER TABLE "BookingLeg" ADD COLUMN IF NOT EXISTS "connectionPointZoneId" TEXT;
ALTER TABLE "ProjectRelease" ADD COLUMN IF NOT EXISTS "sourceHash" TEXT;

CREATE TABLE IF NOT EXISTS "CityZone" (
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
CREATE INDEX IF NOT EXISTS "CityZone_city_active_idx" ON "CityZone"("city","active");

CREATE TABLE IF NOT EXISTS "PricingRule" (
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
CREATE INDEX IF NOT EXISTS "PricingRule_active_priority_idx" ON "PricingRule"("active","priority");
CREATE INDEX IF NOT EXISTS "PricingRule_service_vehicle_active_idx" ON "PricingRule"("serviceType","vehicleType","active");
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "CityZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "ParcelItem" (
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
ALTER TABLE "ParcelItem" ADD CONSTRAINT "ParcelItem_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ParcelItem_booking_sequence_idx" ON "ParcelItem"("bookingId","sequence");

CREATE TABLE IF NOT EXISTS "BookingShareMember" (
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
ALTER TABLE "BookingShareMember" ADD CONSTRAINT "BookingShareMember_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookingShareMember" ADD CONSTRAINT "BookingShareMember_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "BookingShareMember_booking_status_idx" ON "BookingShareMember"("bookingId","status");

CREATE TABLE IF NOT EXISTS "ApprovedTester" (
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
  CONSTRAINT "ApprovedTester_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApprovedTester_mobile_key" UNIQUE ("mobile")
);
CREATE INDEX IF NOT EXISTS "ApprovedTester_active_mobile_idx" ON "ApprovedTester"("active","mobile");

CREATE TABLE IF NOT EXISTS "EnvironmentControl" (
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
  CONSTRAINT "EnvironmentControl_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EnvironmentControl_key_key" UNIQUE ("key")
);

CREATE TABLE IF NOT EXISTS "ProjectRelease" (
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
  CONSTRAINT "ProjectRelease_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectRelease_version_key" UNIQUE ("version")
);
CREATE INDEX IF NOT EXISTS "ProjectRelease_environment_status_created_idx" ON "ProjectRelease"("environment","status","createdAt");

CREATE TABLE IF NOT EXISTS "TestRun" (
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
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "ProjectRelease"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "TestRun_status_started_idx" ON "TestRun"("status","startedAt");

CREATE TABLE IF NOT EXISTS "DataMergeJob" (
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
CREATE INDEX IF NOT EXISTS "DataMergeJob_status_created_idx" ON "DataMergeJob"("status","createdAt");

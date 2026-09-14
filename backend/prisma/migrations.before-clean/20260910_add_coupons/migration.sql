CREATE TYPE "CouponDiscountType" AS ENUM ('FIXED', 'PERCENTAGE');
CREATE TYPE "CouponRideScope" AS ENUM ('ALL', 'FULL_RIDE', 'SHARED_RIDE', 'CONNECTION_RIDE', 'GOODS');

ALTER TABLE "Booking"
  ADD COLUMN "couponId" TEXT,
  ADD COLUMN "couponCode" TEXT,
  ADD COLUMN "couponDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE TABLE "Coupon" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT,
  "discountType" "CouponDiscountType" NOT NULL,
  "discountValue" DECIMAL(12,2) NOT NULL,
  "maxDiscount" DECIMAL(12,2),
  "minFare" DECIMAL(12,2),
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3) NOT NULL,
  "totalUsageLimit" INTEGER,
  "perCustomerLimit" INTEGER,
  "rideScope" "CouponRideScope" NOT NULL DEFAULT 'ALL',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CouponUsage" (
  "id" TEXT NOT NULL,
  "couponId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "discount" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CouponUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");
CREATE INDEX "Coupon_isActive_validFrom_validUntil_idx" ON "Coupon"("isActive","validFrom","validUntil");
CREATE UNIQUE INDEX "CouponUsage_bookingId_key" ON "CouponUsage"("bookingId");
CREATE INDEX "CouponUsage_couponId_customerId_createdAt_idx" ON "CouponUsage"("couponId","customerId","createdAt");
CREATE INDEX "CouponUsage_customerId_createdAt_idx" ON "CouponUsage"("customerId","createdAt");

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CouponUsage" ADD CONSTRAINT "CouponUsage_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CouponUsage" ADD CONSTRAINT "CouponUsage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CouponUsage" ADD CONSTRAINT "CouponUsage_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

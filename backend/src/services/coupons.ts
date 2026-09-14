import { CouponDiscountType, CouponRideScope } from "@prisma/client";
import { prisma } from "../lib/prisma";

export type CouponValidationInput = {
  code: string;
  customerId: string;
  bookingType: "RIDE" | "GOODS";
  rideType?: string | null;
  fare: number;
  now?: Date;
};

export type CouponValidationResult = {
  couponId: string;
  code: string;
  discount: number;
  payableFare: number;
};

export async function validateCoupon(input: CouponValidationInput): Promise<CouponValidationResult> {
  const code = input.code.trim().toUpperCase();
  if (!code) throw new Error("Coupon code is required");
  const now = input.now ?? new Date();
  const fare = Math.max(0, Number(input.fare) || 0);
  const coupon = await prisma.coupon.findUnique({ where: { code } });
  if (!coupon || !coupon.isActive) throw new Error("Coupon is invalid or inactive");
  if (now < coupon.validFrom || now > coupon.validUntil) throw new Error("Coupon is expired or not yet valid");
  if (coupon.minFare !== null && fare < Number(coupon.minFare)) throw new Error(`Minimum fare for this coupon is ₹${Number(coupon.minFare).toFixed(2)}`);
  const scope = coupon.rideScope;
  if (scope !== CouponRideScope.ALL) {
    const requested = input.bookingType === "GOODS" ? "GOODS" : String(input.rideType ?? "");
    if (scope !== requested) throw new Error(`Coupon is not applicable to ${requested || "this booking"}`);
  }
  if (coupon.totalUsageLimit !== null) {
    const used = await prisma.couponUsage.count({ where: { couponId: coupon.id } });
    if (used >= coupon.totalUsageLimit) throw new Error("Coupon usage limit has been reached");
  }
  if (coupon.perCustomerLimit !== null) {
    const usedByCustomer = await prisma.couponUsage.count({ where: { couponId: coupon.id, customerId: input.customerId } });
    if (usedByCustomer >= coupon.perCustomerLimit) throw new Error("You have reached the usage limit for this coupon");
  }
  let discount = coupon.discountType === CouponDiscountType.PERCENTAGE ? fare * Number(coupon.discountValue) / 100 : Number(coupon.discountValue);
  if (coupon.maxDiscount !== null) discount = Math.min(discount, Number(coupon.maxDiscount));
  discount = Math.min(fare, Math.max(0, Math.round(discount * 100) / 100));
  return { couponId: coupon.id, code: coupon.code, discount, payableFare: Math.max(0, Math.round((fare - discount) * 100) / 100) };
}

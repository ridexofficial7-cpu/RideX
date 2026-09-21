/**
 * RideX Unified Navigation Route Registry
 *
 * This file defines route-key contracts only. Business rules, authentication,
 * onboarding state and operational eligibility remain backend-authoritative.
 *
 * Locked product structure:
 * - Customer + Driver live in the unified mobile application.
 * - Admin is a separate control-center role/experience in the unified entry
 *   architecture currently used by the project.
 * - Driver onboarding includes registration and application-status visibility.
 * - The old manual Service Mode selector is NOT a product feature. The
 *   existing `serviceMode` route key is retained only as the compatibility
 *   route for the Driver Work Eligibility screen until all callers are
 *   renamed; its UI must remain backend-derived, not a manual selector.
 */

export const CUSTOMER_SCREENS = [
  "welcome",
  "login",
  "otp",
  "home",
  "location",
  "rideType",
  "goods",
  "fare",
  "confirmed",
  "payment",
  "rating",
  "rebook",
  "gallery",
  "safety",
  "rides",
  "profile",
  "wallet",
  "editProfile",
  "support",
  "notifications",
  "event",
  "qrScanner",
  "rideDetails",
] as const;

export type CustomerScreen = (typeof CUSTOMER_SCREENS)[number];

export const DRIVER_SCREENS = [
  "welcome",
  "login",
  "otp",
  "registration",
  "applicationStatus",
  "home",
  "request",
  "accepted",
  "arrived",
  "trip",
  "completed",
  "history",
  "earnings",
  "profile",
  "kyc",
  "payout",
  "safety",
  "sos",
  "notifications",
  "messages",
  "serviceMode",
] as const;

export type DriverScreen = (typeof DRIVER_SCREENS)[number];

export const ADMIN_SCREENS = [
  "login",
  "otp",
  "dashboard",
  "drivers",
  "kyc",
  "bookings",
  "payments",
  "support",
] as const;

export type AdminScreen = (typeof ADMIN_SCREENS)[number];

export type AppRole = "CUSTOMER" | "DRIVER" | "ADMIN";

export const DEFAULT_ROLE: AppRole = "CUSTOMER";

export const CUSTOMER_SCREENS = [
  "welcome","login","otp","home","location","rideType","goods","fare","confirmed",
  "payment","rating","rebook","gallery","safety","rides","profile","editProfile",
  "support","qrScanner","rideDetails",
] as const;
export type CustomerScreen = typeof CUSTOMER_SCREENS[number];

export const DRIVER_SCREENS = [
  "welcome","login","otp","home","serviceMode","request","accepted","arrived","trip",
  "completed","history","earnings","profile","kyc","payout","safety","sos","notifications","messages",
] as const;
export type DriverScreen = typeof DRIVER_SCREENS[number];

export const ADMIN_SCREENS = ["login","otp","dashboard","drivers","kyc","bookings","payments","support"] as const;
export type AdminScreen = typeof ADMIN_SCREENS[number];

export type AppRole = "CUSTOMER" | "DRIVER" | "ADMIN";
export const DEFAULT_ROLE: AppRole = "CUSTOMER";
import { VehicleType, GoodsSize } from "@prisma/client";

export const DEFAULT_RIDEX_COMMISSION_RATE = 0.25;

export function fullRideFare(km: number) {
  const distance = Math.max(0, Number(km) || 0);
  if (distance <= 1.2) return 80;
  return 80 + Math.ceil((distance - 1.2) / 0.2) * 2;
}

export function sharedFare(passengers: number) {
  const count = Math.min(4, Math.max(1, Math.trunc(Number(passengers) || 1)));
  return count * 20;
}

export function distanceFare(km: number, passengers: number) {
  const distance = Math.max(1, Number(km) || 1);
  const count = Math.min(4, Math.max(1, Math.trunc(Number(passengers) || 1)));
  return (10 + Math.ceil(Math.max(0, distance - 1)) * 20) * count;
}

export function goodsFare(input: {
  km: number;
  vehicleType?: VehicleType | string | null;
  weightKg?: number;
  size?: GoodsSize | string | null;
  waitingMinutes?: number;
}) {
  const distance = Math.max(1, Number(input.km) || 1);
  const vehicle = String(input.vehicleType ?? "E_RICKSHAW");
  const first = vehicle === "PICKUP_TRUCK" ? 500 : 200;
  const extra = vehicle === "PICKUP_TRUCK" ? 100 : 50;
  const waiting = Math.max(0, Number(input.waitingMinutes) || 0);
  const waitingCharge = waiting > 30 ? Math.ceil((waiting - 30) / 15) * 20 : 0;
  return first + Math.ceil(Math.max(0, distance - 1)) * extra + waitingCharge;
}

export function commission(grossFare: number, rate = DEFAULT_RIDEX_COMMISSION_RATE) {
  return Math.max(0, Number(grossFare) || 0) * Math.max(0, Math.min(1, Number(rate) || 0));
}

export function driverEarning(grossFare: number, rate = DEFAULT_RIDEX_COMMISSION_RATE) {
  const gross = Math.max(0, Number(grossFare) || 0);
  return gross - commission(gross, rate);
}

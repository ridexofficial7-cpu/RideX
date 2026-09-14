import { BookingType, RideType, VehicleType } from "@prisma/client";
import { prisma } from "../lib/prisma";

export type SmartPricingInput = {
  baseFare: number;
  distanceKm: number;
  durationMinutes?: number;
  bookingType: BookingType;
  rideType?: RideType | null;
  vehicleType?: VehicleType | null;
  zoneId?: string | null;
  demandLevel?: number;
  weightKg?: number;
};

export async function applySmartPricing(input: SmartPricingInput) {
  const rules = await prisma.pricingRule.findMany({ where: { active: true }, orderBy: [{ priority: "desc" }, { createdAt: "desc" }] });
  let value = Math.max(0, input.baseFare);
  const matched: string[] = [];
  const now = new Date();
  const day = String(now.getDay());
  const minutes = now.getHours() * 60 + now.getMinutes();

  for (const rule of rules) {
    if (rule.bookingType && rule.bookingType !== input.bookingType) continue;
    if (rule.rideType && rule.rideType !== (input.rideType ?? null)) continue;
    if (rule.vehicleType && rule.vehicleType !== (input.vehicleType ?? null)) continue;
    if (rule.zoneId && rule.zoneId !== (input.zoneId ?? null)) continue;
    if (rule.dayOfWeek && rule.dayOfWeek.split(",").map((x) => x.trim()).includes(day) === false) continue;
    if (rule.demandMin != null && (input.demandLevel ?? 0) < rule.demandMin) continue;
    if (rule.demandMax != null && (input.demandLevel ?? 0) > rule.demandMax) continue;
    if (rule.startTime && rule.endTime) {
      const parse = (x: string) => { const [h, m] = x.split(":").map(Number); return h * 60 + m; };
      const start = parse(rule.startTime), end = parse(rule.endTime);
      if (start <= end ? (minutes < start || minutes > end) : (minutes > end && minutes < start)) continue;
    }
    let calculated = value;
    if (rule.baseFare != null) calculated = Number(rule.baseFare);
    if (rule.perKm != null) calculated += Math.max(0, input.distanceKm) * Number(rule.perKm);
    if (rule.perMinute != null) calculated += Math.max(0, input.durationMinutes ?? 0) * Number(rule.perMinute);
    if (rule.waitingPerMinute != null && input.durationMinutes) calculated += input.durationMinutes * Number(rule.waitingPerMinute);
    if (rule.weightPerKg != null) calculated += Math.max(0, input.weightKg ?? 0) * Number(rule.weightPerKg);
    calculated *= Number(rule.multiplier || 1);
    if (rule.minFare != null) calculated = Math.max(calculated, Number(rule.minFare));
    if (rule.maxFare != null) calculated = Math.min(calculated, Number(rule.maxFare));
    value = calculated;
    matched.push(rule.id);
  }

  return { fare: Math.max(0, Number(value.toFixed(2))), matchedRuleIds: matched };
}

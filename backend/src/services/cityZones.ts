import { prisma } from "../lib/prisma";

export type Coordinate = { lat: number; lng: number };

export function distanceKm(a: Coordinate, b: Coordinate) {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export async function findActiveCityZone(point: Coordinate) {
  const zones = await prisma.cityZone.findMany({ where: { active: true } });
  return zones
    .map((zone) => ({ zone, distanceKm: distanceKm(point, { lat: zone.centerLat, lng: zone.centerLng }) }))
    .filter((x) => x.distanceKm <= x.zone.radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)[0]?.zone ?? null;
}

export async function assertSameCityZone(points: Coordinate[]) {
  const zones = await Promise.all(points.map(findActiveCityZone));
  const names = zones.map((z) => z?.id).filter(Boolean);
  const same = names.length === points.length && names.every((id) => id === names[0]);
  return { same, zones };
}

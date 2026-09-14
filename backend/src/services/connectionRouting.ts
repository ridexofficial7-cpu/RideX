import { roadRoute } from "./routing";
import { findActiveCityZone } from "./cityZones";

export type ConnectionPlanPoint = {
  lat: number;
  lng: number;
  address: string;
};

export type ConnectionPlanLeg = {
  sequence: number;
  pickup: ConnectionPlanPoint;
  drop: ConnectionPlanPoint;
  distanceKm: number;
  durationMinutes: number;
  geometry: unknown;
};

export type ConnectionPlan = {
  distanceKm: number;
  durationMinutes: number;
  geometry: unknown;
  legs: ConnectionPlanLeg[];
};

type Coordinate = {
  lat: number;
  lng: number;
};

type OsrmStep = {
  geometry?: {
    coordinates?: number[][];
  };
  distance?: number;
  duration?: number;
  name?: string;
  ref?: string;
};

const DEFAULT_MAX_STEPS = 6;
const DEFAULT_TARGET_LEG_KM = 15;
const DEFAULT_MAX_LEG_KM = 15;
const DEFAULT_MIN_LEG_KM = 1;

function envNumber(key: string, fallback: number) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function distanceKm(a: Coordinate, b: Coordinate) {
  const R = 6371;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) *
      Math.cos(toRad(b.lat)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function cleanBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function routingBaseUrl() {
  return cleanBaseUrl(
    process.env.ROUTING_URL ||
      process.env.OSRM_BASE_URL ||
      "https://router.project-osrm.org"
  );
}

function routeUrl(points: Coordinate[]) {
  const coordinates = points
    .map((point) => `${point.lng},${point.lat}`)
    .join(";");

  return `${routingBaseUrl()}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true`;
}

async function fetchOsrm(points: Coordinate[]) {
  if (points.length < 2) {
    throw new Error("At least two route points are required");
  }

  const timeoutMs = Math.trunc(
    envNumber("ROUTING_TIMEOUT_MS", 10_000)
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(routeUrl(points), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "RideX/2.1 Connection Routing",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OSRM request failed with HTTP ${response.status}`);
    }

    const data = (await response.json()) as any;

    if (data?.code !== "Ok" || !data?.routes?.length) {
      throw new Error(data?.message || "OSRM route not found");
    }

    return data.routes[0] as {
      distance: number;
      duration: number;
      geometry?: { coordinates?: number[][] };
      legs?: Array<{
        distance?: number;
        duration?: number;
        steps?: OsrmStep[];
      }>;
    };
  } finally {
    clearTimeout(timeout);
  }
}

function geometryCoordinates(geometry: unknown): Coordinate[] {
  const coordinates =
    (geometry as any)?.coordinates;

  if (!Array.isArray(coordinates)) {
    return [];
  }

  return coordinates
    .map((item: unknown) => {
      if (!Array.isArray(item) || item.length < 2) {
        return null;
      }

      const lng = Number(item[0]);
      const lat = Number(item[1]);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
      }

      return { lat, lng };
    })
    .filter((item): item is Coordinate => Boolean(item));
}

function cumulativeDistances(points: Coordinate[]) {
  const cumulative = [0];

  for (let i = 1; i < points.length; i += 1) {
    cumulative.push(
      cumulative[i - 1] +
        distanceKm(points[i - 1], points[i])
    );
  }

  return cumulative;
}

function interpolateAtDistance(
  points: Coordinate[],
  cumulative: number[],
  targetKm: number
): Coordinate {
  if (!points.length) {
    throw new Error("OSRM route geometry is empty");
  }

  if (targetKm <= 0) {
    return points[0];
  }

  const totalKm = cumulative[cumulative.length - 1];
  if (targetKm >= totalKm) {
    return points[points.length - 1];
  }

  for (let i = 1; i < cumulative.length; i += 1) {
    if (cumulative[i] < targetKm) {
      continue;
    }

    const start = cumulative[i - 1];
    const end = cumulative[i];
    const span = end - start;
    const ratio = span > 0 ? (targetKm - start) / span : 0;

    return {
      lat:
        points[i - 1].lat +
        (points[i].lat - points[i - 1].lat) * ratio,
      lng:
        points[i - 1].lng +
        (points[i].lng - points[i - 1].lng) * ratio,
    };
  }

  return points[points.length - 1];
}

function routePointWithRoadContext(
  points: Coordinate[],
  cumulative: number[],
  targetKm: number,
  totalKm: number,
  steps: OsrmStep[]
) {
  const exact = interpolateAtDistance(points, cumulative, targetKm);

  /*
   * Prefer an actual OSRM step endpoint close to the target.
   * This keeps the transfer point on the routed road rather than
   * inventing a free-floating coordinate. Named/ref'd road steps
   * are preferred because they are generally more useful for a
   * practical transfer point.
   */
  const candidates: Array<{
    point: Coordinate;
    cumulativeKm: number;
    quality: number;
  }> = [];

  let cursorKm = 0;
  for (const step of steps) {
    const stepCoordinates = geometryCoordinates(step.geometry);
    const stepDistanceKm = Number(step.distance || 0) / 1000;

    cursorKm += stepDistanceKm;

    if (!stepCoordinates.length) {
      continue;
    }

    const endpoint =
      stepCoordinates[stepCoordinates.length - 1];

    const roadContext =
      String(step.ref || step.name || "").trim();

    const distanceError = Math.abs(cursorKm - targetKm);
    const withinWindow =
      cursorKm >= Math.max(0, targetKm - 2) &&
      cursorKm <= Math.min(totalKm, targetKm + 2);

    if (!withinWindow) {
      continue;
    }

    candidates.push({
      point: endpoint,
      cumulativeKm: cursorKm,
      quality:
        distanceError - (roadContext ? 0.75 : 0),
    });
  }

  candidates.sort((a, b) => a.quality - b.quality);

  return candidates[0]?.point ?? exact;
}

function chooseLegCount(
  totalKm: number,
  minLegKm: number,
  targetLegKm: number,
  maxLegKm: number,
  maxLegs: number
) {
  if (totalKm <= maxLegKm) {
    return 1;
  }

  const lower = Math.max(1, Math.ceil(totalKm / maxLegKm));
  const upper = Math.max(1, Math.floor(totalKm / minLegKm));

  for (
    let count = lower;
    count <= Math.min(upper, maxLegs);
    count += 1
  ) {
    const average = totalKm / count;
    if (
      average >= minLegKm &&
      average <= maxLegKm
    ) {
      return count;
    }
  }

  return Math.min(
    maxLegs,
    Math.max(
      1,
      Math.round(totalKm / targetLegKm)
    )
  );
}

function sliceGeometry(
  points: Coordinate[],
  cumulative: number[],
  startKm: number,
  endKm: number
) {
  const geometryPoints: Coordinate[] = [
    interpolateAtDistance(
      points,
      cumulative,
      startKm
    ),
  ];

  for (let i = 1; i < cumulative.length - 1; i += 1) {
    if (
      cumulative[i] > startKm &&
      cumulative[i] < endKm
    ) {
      geometryPoints.push(points[i]);
    }
  }

  geometryPoints.push(
    interpolateAtDistance(
      points,
      cumulative,
      endKm
    )
  );

  return {
    type: "LineString",
    coordinates: geometryPoints.map((point) => [
      point.lng,
      point.lat,
    ]),
  };
}

function cumulativeForConnectionPoints(
  points: Coordinate[],
  connectionPoints: Coordinate[]
) {
  const cumulative = cumulativeDistances(points);

  return connectionPoints.map((connectionPoint) => {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < points.length; i += 1) {
      const distance = distanceKm(
        points[i],
        connectionPoint
      );

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    return cumulative[bestIndex];
  });
}


function isInsideZone(point: Coordinate, zone: { centerLat: number; centerLng: number; radiusKm: number }) {
  return distanceKm(point, { lat: zone.centerLat, lng: zone.centerLng }) <= zone.radiusKm;
}

function findBoundaryDistance(points: Coordinate[], cumulative: number[], zone: { centerLat:number; centerLng:number; radiusKm:number }, mode: "EXIT"|"ENTRY") {
  if (points.length < 2) return null;
  for (let i=1;i<points.length;i++) {
    const prev = isInsideZone(points[i-1], zone);
    const current = isInsideZone(points[i], zone);
    if (mode === "EXIT" && prev && !current || mode === "ENTRY" && !prev && current) {
      let lo=cumulative[i-1], hi=cumulative[i];
      const start=points[i-1], end=points[i];
      for (let n=0;n<18;n++) {
        const mid=(lo+hi)/2;
        const ratio=(hi-lo)>0 ? (mid-cumulative[i-1])/(cumulative[i]-cumulative[i-1]) : 0;
        const point={lat:start.lat+(end.lat-start.lat)*ratio,lng:start.lng+(end.lng-start.lng)*ratio};
        const inside=isInsideZone(point,zone);
        if ((mode === "EXIT" && inside) || (mode === "ENTRY" && !inside)) lo=mid; else hi=mid;
      }
      return (lo+hi)/2;
    }
  }
  return null;
}

export async function buildConnectionPlan(input: {
  pickupLat: number;
  pickupLng: number;
  dropLat: number;
  dropLng: number;
}) : Promise<ConnectionPlan> {
  const pickup: Coordinate = {
    lat: Number(input.pickupLat),
    lng: Number(input.pickupLng),
  };

  const drop: Coordinate = {
    lat: Number(input.dropLat),
    lng: Number(input.dropLng),
  };

  const route = await fetchOsrm([pickup, drop]);

  const geometry = route.geometry ?? null;
  const points = geometryCoordinates(geometry);

  if (points.length < 2) {
    /*
     * Safety fallback: keep the existing routing implementation
     * available for deployments where geometry is not exposed.
     */
    const fallback = await roadRoute(
      pickup,
      drop,
      []
    );

    return {
      distanceKm: fallback.distanceKm,
      durationMinutes: fallback.durationMinutes,
      geometry,
      legs: [
        {
          sequence: 1,
          pickup: {
            ...pickup,
            address: "Customer Pickup",
          },
          drop: {
            ...drop,
            address: "Customer Drop",
          },
          distanceKm: fallback.distanceKm,
          durationMinutes: fallback.durationMinutes,
          geometry,
        },
      ],
    };
  }

  const totalKm = Number(route.distance || 0) / 1000;
  const totalMinutes = Number(route.duration || 0) / 60;

  if (!Number.isFinite(totalKm) || totalKm <= 0) {
    throw new Error("OSRM returned an invalid route distance");
  }

  const minLegKm = envNumber(
    "CONNECTION_MIN_LEG_KM",
    DEFAULT_MIN_LEG_KM
  );
  const targetLegKm = envNumber(
    "CONNECTION_TARGET_LEG_KM",
    DEFAULT_TARGET_LEG_KM
  );
  const maxLegKm = envNumber(
    "CONNECTION_MAX_LEG_KM",
    DEFAULT_MAX_LEG_KM
  );
  const maxLegs = Math.trunc(
    envNumber(
      "CONNECTION_MAX_LEGS",
      DEFAULT_MAX_STEPS
    )
  );

  const pickupZone = await findActiveCityZone(pickup);
  const dropZone = await findActiveCityZone(drop);

  const cumulative = cumulativeDistances(points);

  // When the trip crosses city service zones, keep the local city portion
  // intact, split only the inter-city corridor into <= 15 km connection legs,
  // then leave the destination-city portion intact.
  if (pickupZone && dropZone && pickupZone.id !== dropZone.id) {
    const exitKm = findBoundaryDistance(points, cumulative, pickupZone, "EXIT");
    const entryKm = findBoundaryDistance(points, cumulative, dropZone, "ENTRY");
    if (exitKm != null && entryKm != null && entryKm > exitKm) {
      const corridorKm = entryKm - exitKm;
      const corridorLegs = Math.max(1, Math.ceil(corridorKm / maxLegKm));
      const boundaries = [0, exitKm];
      for (let i=1;i<corridorLegs;i++) boundaries.push(exitKm + corridorKm * (i/corridorLegs));
      boundaries.push(entryKm, totalKm);
      const unique = boundaries.filter((v,i,a)=>i===0 || v-a[i-1] > 0.05);
      const steps = (route.legs || []).flatMap((item) => item.steps || []);
      const legs: ConnectionPlanLeg[] = [];
      for (let index=0; index<unique.length-1; index++) {
        const startKm=unique[index], endKm=unique[index+1];
        const segmentDistance=Math.max(0,endKm-startKm);
        const segmentDuration=totalKm>0 ? totalMinutes*(segmentDistance/totalKm) : 0;
        const startPoint=interpolateAtDistance(points,cumulative,startKm);
        const endPoint=interpolateAtDistance(points,cumulative,endKm);
        const startLabel=index===0 ? "Customer Pickup" : (Math.abs(startKm-exitKm)<0.08 ? `${pickupZone.city} Connection Point` : `Connection Leg ${index} Start`);
        const endLabel=Math.abs(endKm-entryKm)<0.08 ? `${dropZone.city} Connection Point` : (index===unique.length-2 ? "Customer Drop" : `Connection Point ${index+1}`);
        legs.push({sequence:index+1,pickup:{...startPoint,address:startLabel},drop:{...endPoint,address:endLabel},distanceKm:segmentDistance,durationMinutes:segmentDuration,geometry:sliceGeometry(points,cumulative,startKm,endKm)});
      }
      return { distanceKm: totalKm, durationMinutes: totalMinutes, geometry, legs };
    }
  }

  const legCount = chooseLegCount(
    totalKm,
    minLegKm,
    targetLegKm,
    maxLegKm,
    maxLegs
  );

  if (legCount <= 1) {
    return {
      distanceKm: totalKm,
      durationMinutes: totalMinutes,
      geometry,
      legs: [
        {
          sequence: 1,
          pickup: {
            ...pickup,
            address: "Customer Pickup",
          },
          drop: {
            ...drop,
            address: "Customer Drop",
          },
          distanceKm: totalKm,
          durationMinutes: totalMinutes,
          geometry,
        },
      ],
    };
  }

  const steps = (route.legs || []).flatMap(
    (item) => item.steps || []
  );

  const rawConnections: Coordinate[] = [];

  for (let index = 1; index < legCount; index += 1) {
    const targetKm =
      (totalKm * index) / legCount;

    rawConnections.push(
      routePointWithRoadContext(
        points,
        cumulative,
        targetKm,
        totalKm,
        steps
      )
    );
  }

  const connectionKm = cumulativeForConnectionPoints(
    points,
    rawConnections
  ).sort((a, b) => a - b);

  const boundaries = [0, ...connectionKm, totalKm];
  const legs: ConnectionPlanLeg[] = [];

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startKm = boundaries[index];
    const endKm = boundaries[index + 1];
    const segmentDistance = Math.max(0, endKm - startKm);
    const segmentDuration =
      totalKm > 0
        ? totalMinutes * (segmentDistance / totalKm)
        : 0;

    const startPoint =
      interpolateAtDistance(
        points,
        cumulative,
        startKm
      );
    const endPoint =
      interpolateAtDistance(
        points,
        cumulative,
        endKm
      );

    legs.push({
      sequence: index + 1,
      pickup: {
        ...startPoint,
        address:
          index === 0
            ? "Customer Pickup"
            : `Connection Point ${index}`,
      },
      drop: {
        ...endPoint,
        address:
          index === boundaries.length - 2
            ? "Customer Drop"
            : `Connection Point ${index + 1}`,
      },
      distanceKm: segmentDistance,
      durationMinutes: segmentDuration,
      geometry: sliceGeometry(
        points,
        cumulative,
        startKm,
        endKm
      ),
    });
  }

  return {
    distanceKm: totalKm,
    durationMinutes: totalMinutes,
    geometry,
    legs,
  };
}

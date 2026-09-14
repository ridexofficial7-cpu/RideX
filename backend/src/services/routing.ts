import { getSystemConfig } from "./systemConfig";

type Coordinate = {
  lat: number;
  lng: number;
};

export type GeoJsonLineString = {
  type: "LineString";
  coordinates: number[][];
};

export type RouteStep = {
  distanceMeters: number;
  durationSeconds: number;
  name?: string;
  ref?: string;
  geometry?: GeoJsonLineString;
};

export type RouteResult = {
  distanceKm: number;
  durationMinutes: number;

  /**
   * Full OSRM road geometry.
   * Kept optional so existing consumers remain compatible.
   */
  geometry?: GeoJsonLineString | null;

  /**
   * OSRM road steps.
   * Useful for Connection Ride road-context selection.
   */
  steps?: RouteStep[];
};

/**
 * =========================================================
 * RIDEX ROUTING CONFIG
 * =========================================================
 *
 * Priority:
 * 1. ROUTING_URL
 * 2. OSRM_BASE_URL
 * 3. Public OSRM
 *
 * Example:
 *   ROUTING_URL=http://localhost:5000
 */

async function getRoutingUrl() {
  return (await getSystemConfig(
    "ROUTING_URL",
    process.env.ROUTING_URL || process.env.OSRM_BASE_URL || "https://router.project-osrm.org"
  )).replace(/\/+$/, "");
}

const parsedTimeout = Number(
  process.env.ROUTING_TIMEOUT_MS || 10000
);

const ROUTING_TIMEOUT_MS =
  Number.isFinite(parsedTimeout) && parsedTimeout > 0
    ? parsedTimeout
    : 10000;

/**
 * =========================================================
 * COORDINATE VALIDATION
 * =========================================================
 */

function isValidCoordinate(
  point: Coordinate
): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lng >= -180 &&
    point.lng <= 180
  );
}

/**
 * =========================================================
 * FETCH WITH TIMEOUT
 * =========================================================
 */

async function fetchWithTimeout(
  url: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    return await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "RideX/2.1 Routing",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * =========================================================
 * NORMALIZE OSRM GEOMETRY
 * =========================================================
 */

function normalizeGeometry(
  geometry: unknown
): GeoJsonLineString | null {
  const source = geometry as {
    type?: unknown;
    coordinates?: unknown;
  } | null;

  if (!source || !Array.isArray(source.coordinates)) {
    return null;
  }

  const coordinates = source.coordinates
    .filter(
      (item): item is unknown[] =>
        Array.isArray(item) && item.length >= 2
    )
    .map((item) => [
      Number(item[0]),
      Number(item[1]),
    ])
    .filter(
      (item) =>
        Number.isFinite(item[0]) &&
        Number.isFinite(item[1])
    );

  if (coordinates.length < 2) {
    return null;
  }

  return {
    type: "LineString",
    coordinates,
  };
}

/**
 * =========================================================
 * ROAD ROUTE
 * =========================================================
 *
 * Calculates a real driving route through:
 *
 * pickup
 *   ↓
 * stop 1
 *   ↓
 * stop 2
 *   ↓
 * drop
 *
 * OSRM expects:
 * longitude,latitude
 *
 * RideX internally uses:
 * latitude,longitude
 *
 * IMPORTANT:
 * overview=full + steps=true are intentional.
 *
 * Connection Ride needs the actual OSRM road geometry so the
 * backend can calculate practical road-based connection points.
 */

export async function roadRoute(
  pickup: Coordinate,
  drop: Coordinate,
  stops: Coordinate[] = []
): Promise<RouteResult> {
  /**
   * Validate pickup.
   */
  if (!isValidCoordinate(pickup)) {
    throw new Error(
      "Invalid pickup coordinates"
    );
  }

  /**
   * Validate drop.
   */
  if (!isValidCoordinate(drop)) {
    throw new Error(
      "Invalid drop coordinates"
    );
  }

  /**
   * Validate stops.
   */
  for (let i = 0; i < stops.length; i++) {
    if (!isValidCoordinate(stops[i])) {
      throw new Error(
        `Invalid stop coordinates at index ${i}`
      );
    }
  }

  const points: Coordinate[] = [
    pickup,
    ...stops,
    drop,
  ];

  if (points.length < 2) {
    throw new Error(
      "At least pickup and drop are required"
    );
  }

  /**
   * =======================================================
   * OSRM COORDINATE FORMAT
   * =======================================================
   *
   * OSRM:
   * lng,lat
   */
  const coordinates = points
    .map(
      (point) =>
        `${point.lng},${point.lat}`
    )
    .join(";");

  const routingUrl = await getRoutingUrl();
  const url =
    `${routingUrl}/route/v1/driving/` +
    `${coordinates}` +
    `?overview=full&geometries=geojson&steps=true`;

  let response: Response;

  try {
    response =
      await fetchWithTimeout(
        url,
        ROUTING_TIMEOUT_MS
      );
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new Error(
        `Routing service timeout after ${ROUTING_TIMEOUT_MS}ms`
      );
    }

    throw new Error(
      `Routing service unavailable: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Routing service returned HTTP ${response.status}`
    );
  }

  let data: any;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      "Routing service returned invalid JSON"
    );
  }

  if (
    data?.code !== "Ok" ||
    !Array.isArray(data?.routes) ||
    !data.routes[0]
  ) {
    throw new Error(
      data?.message ||
      "No road route available"
    );
  }

  const route = data.routes[0];

  /**
   * =======================================================
   * DISTANCE / DURATION
   * =======================================================
   */

  const rawDistanceMeters =
    Number(route.distance);

  const rawDurationSeconds =
    Number(route.duration);

  if (
    !Number.isFinite(
      rawDistanceMeters
    ) ||
    !Number.isFinite(
      rawDurationSeconds
    ) ||
    rawDistanceMeters < 0 ||
    rawDurationSeconds < 0
  ) {
    throw new Error(
      "Invalid routing result"
    );
  }

  const distanceKm =
    rawDistanceMeters / 1000;

  const durationMinutes =
    rawDurationSeconds / 60;

  /**
   * =======================================================
   * FULL ROAD GEOMETRY
   * =======================================================
   */

  const geometry =
    normalizeGeometry(
      route.geometry
    );

  /**
   * =======================================================
   * ROAD STEPS
   * =======================================================
   *
   * Keep step information because Connection Ride may use
   * road names/references when selecting transfer points.
   */

  const steps: RouteStep[] =
    Array.isArray(route.legs)
      ? route.legs.flatMap(
          (leg: any) =>
            Array.isArray(leg?.steps)
              ? leg.steps
                  .map(
                    (step: any): RouteStep | null => {
                      const distanceMeters =
                        Number(
                          step?.distance || 0
                        );

                      const durationSeconds =
                        Number(
                          step?.duration || 0
                        );

                      if (
                        !Number.isFinite(
                          distanceMeters
                        ) ||
                        !Number.isFinite(
                          durationSeconds
                        )
                      ) {
                        return null;
                      }

                      return {
                        distanceMeters:
                          Math.max(
                            0,
                            distanceMeters
                          ),
                        durationSeconds:
                          Math.max(
                            0,
                            durationSeconds
                          ),
                        name:
                          step?.name
                            ? String(
                                step.name
                              )
                            : undefined,
                        ref:
                          step?.ref
                            ? String(
                                step.ref
                              )
                            : undefined,
                        geometry:
                          normalizeGeometry(
                            step?.geometry
                          ) ?? undefined,
                      };
                    }
                  )
                  .filter(
                    (
                      step: any
                    ): step is RouteStep =>
                      Boolean(step)
                  )
              : []
        )
      : [];

  return {
    /**
     * Store distance to 2 decimal places.
     */
    distanceKm:
      Math.round(
        distanceKm * 100
      ) / 100,

    /**
     * Minimum 1 minute for a valid route.
     */
    durationMinutes:
      Math.max(
        1,
        Math.ceil(
          durationMinutes
        )
      ),

    /**
     * Road geometry and steps are now available to the
     * Connection Ride routing service.
     */
    geometry,

    steps,
  };
}

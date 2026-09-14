import express, {
  NextFunction,
  Request,
  Response,
} from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";

import { healthRouter } from "./routes/health";
import { bookingRouter } from "./routes/bookings";
import { driverRouter } from "./routes/driver";
import { quickLocationsRouter } from "./routes/quick-locations";
import { ratingsRouter } from "./routes/ratings";
import { paymentsRouter } from "./routes/payments";
import { authRouter } from "./routes/auth";
import { adminRouter } from "./routes/admin";
import { safetyRouter } from "./routes/safety";
import { supportRouter } from "./routes/support";
import { notificationsRouter } from "./routes/notifications";
import { gpsRouter } from "./routes/gps";
import { tripsRouter } from "./routes/trips";
import { configurationRouter } from "./routes/configuration";
import { metaRouter } from "./routes/meta";
import { platformRouter } from "./routes/platform";
import { requireAppAuth, enforceActorIdentity } from "./middleware/auth";
import { requireAuthorizedAdminNetwork } from "./middleware/adminNetwork";

dotenv.config();

const app = express();

/**
 * =========================================================
 * BASIC SECURITY
 * =========================================================
 */

app.disable("x-powered-by");

app.use(helmet());

/**
 * =========================================================
 * OPTIONAL PROXY SUPPORT
 * =========================================================
 *
 * Useful when the API is later deployed behind a reverse
 * proxy/load balancer so req.ip is populated correctly.
 */
if (
  process.env.TRUST_PROXY === "true"
) {
  app.set(
    "trust proxy",
    1
  );
}

/**
 * =========================================================
 * CORS
 * =========================================================
 *
 * Development:
 *   CORS_ORIGIN=*
 *
 * Production:
 *   Set a specific frontend origin.
 */
const corsOrigin =
  process.env.CORS_ORIGIN || "*";

app.use(
  cors({
    origin:
      corsOrigin === "*"
        ? true
        : corsOrigin,
    methods: [
      "GET",
      "POST",
      "PATCH",
      "PUT",
      "DELETE",
      "OPTIONS",
    ],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Idempotency-Key",
      "x-admin-user-id",
      "x-user-id",
      "x-actor-id",
    ],
  })
);

/**
 * =========================================================
 * BODY PARSER
 * =========================================================
 */

app.use(
  express.json({
    limit: "2mb",
  })
);

/**
 * =========================================================
 * ROOT
 * =========================================================
 */

app.get(
  "/",
  (_req, res) => {
    return res.status(200).json({
      success: true,
      app: "RideX",
      version:
        "5.6.0",
      status: "ok",
      mode:
        process.env.NODE_ENV ===
        "production"
          ? "PRODUCTION"
          : "TEST",
    });
  }
);

/**
 * =========================================================
 * API ROUTES
 * =========================================================
 */

const API_PREFIX =
  "/api/v1";

/**
 * Health / Auth
 */
app.use(
  `${API_PREFIX}/health`,
  healthRouter
);

app.use(`${API_PREFIX}/meta`, metaRouter);

app.use(
  `${API_PREFIX}/auth`,
  authRouter
);

/**
 * Customer / Driver trip operations
 */
app.use(`${API_PREFIX}/bookings`, requireAppAuth(), enforceActorIdentity, bookingRouter);

app.use(`${API_PREFIX}/driver`, requireAppAuth(), enforceActorIdentity, driverRouter);

app.use(`${API_PREFIX}/trips`, requireAppAuth(), enforceActorIdentity, tripsRouter);

app.use(`${API_PREFIX}/gps`, requireAppAuth(), enforceActorIdentity, gpsRouter);

/**
 * Pricing / location / rating / payment
 */
app.use(
  `${API_PREFIX}/quick-locations`,
  quickLocationsRouter
);

app.use(`${API_PREFIX}/ratings`, requireAppAuth(), enforceActorIdentity, ratingsRouter);

app.use(`${API_PREFIX}/payments`, requireAppAuth(), enforceActorIdentity, paymentsRouter);

/**
 * Safety / support / notifications
 */
app.use(`${API_PREFIX}/sos`, requireAppAuth(), enforceActorIdentity, safetyRouter);

app.use(`${API_PREFIX}/support`, requireAppAuth(), enforceActorIdentity, supportRouter);

app.use(`${API_PREFIX}/notifications`, requireAppAuth(), enforceActorIdentity, notificationsRouter);

/**
 * Admin
 */
app.use(`${API_PREFIX}/admin/configuration`, requireAppAuth(), enforceActorIdentity, requireAuthorizedAdminNetwork, configurationRouter);
app.use(`${API_PREFIX}/admin`, requireAppAuth(), enforceActorIdentity, requireAuthorizedAdminNetwork, adminRouter);
app.use(`${API_PREFIX}/admin/platform`, requireAppAuth(), enforceActorIdentity, requireAuthorizedAdminNetwork, platformRouter);

/**
 * =========================================================
 * 404 HANDLER
 * =========================================================
 */

app.use(
  (
    req: Request,
    res: Response
  ) => {
    return res.status(404).json({
      success: false,
      message:
        "API route not found",
      path:
        req.originalUrl,
    });
  }
);

/**
 * =========================================================
 * GLOBAL ERROR HANDLER
 * =========================================================
 */

app.use(
  (
    error: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction
  ) => {
    console.error(
      "RIDEX GLOBAL ERROR:",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "Internal server error";

    return res.status(500).json({
      success: false,
      message,
    });
  }
);

/**
 * =========================================================
 * START SERVER
 * =========================================================
 */

const port = Number(
  process.env.PORT || 4000
);

const server =
  app.listen(
    port,
    () => {
      console.log(
        `RideX backend running on :${port} (${
          process.env.NODE_ENV ===
          "production"
            ? "PRODUCTION"
            : "TEST MODE"
        })`
      );
    }
  );

/**
 * =========================================================
 * GRACEFUL SHUTDOWN
 * =========================================================
 */

function shutdown(
  signal: string
) {
  console.log(
    `\nRideX received ${signal}. Shutting down...`
  );

  server.close(() => {
    console.log(
      "RideX backend stopped."
    );

    process.exit(0);
  });

  setTimeout(
    () => {
      console.error(
        "Forced shutdown after timeout."
      );

      process.exit(1);
    },
    10000
  ).unref();
}

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

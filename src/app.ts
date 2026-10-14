// Builds the Express app: global middleware in order, the API routes, then 404 and error handling.
// Kept separate from server.ts so the app can be created without opening a port (e.g. in tests).
import express from "express";
import helmet from "helmet";

import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { apiRateLimiter } from "./middleware/rate-limit.js";
import { requestLogger } from "./middleware/request-logger.js";
import { apiRouter } from "./routes/index.js";

export function createApp() {
  const app = express();

  // Behind a reverse proxy, this makes req.ip the real client IP (used by rate limiting).
  app.set("trust proxy", env.TRUST_PROXY_HOPS);

  app.use(helmet());
  app.use(requestLogger);
  app.use(apiRateLimiter);
  app.use(express.json({ limit: "100kb" }));

  app.use("/api/v1", apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

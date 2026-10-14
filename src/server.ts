// Entry point: starts the HTTP server and shuts down cleanly (finish in-flight requests, close the
// DB pool) when Docker or the terminal sends a stop signal.
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";

const server = createApp().listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT}/api/v1`);
});

function shutdown(signal: NodeJS.Signals) {
  logger.info(`${signal} received, shutting down`);

  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });

  // Don't hang forever if a connection refuses to close.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

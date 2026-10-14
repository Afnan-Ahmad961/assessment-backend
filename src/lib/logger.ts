// Shared pino logger. Pretty-printed in development, JSON in production (for log collectors).
import { pino } from "pino";

import { env, isProduction } from "../config/env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  // Never let credentials or tokens reach the logs.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.refreshToken",
      "*.accessToken",
    ],
    censor: "[redacted]",
  },
  ...(isProduction
    ? {}
    : { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } } }),
});

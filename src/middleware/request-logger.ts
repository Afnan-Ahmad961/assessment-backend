// Logs one line per request (method, URL, status, duration) and tags it with a request id.
// The id is echoed back in the X-Request-Id header so a failing request can be found in the logs.
import { randomUUID } from "node:crypto";

import { pinoHttp } from "pino-http";

import { logger } from "../lib/logger.js";

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers["x-request-id"];
    const id = typeof incoming === "string" && incoming.length <= 100 ? incoming : randomUUID();
    res.setHeader("X-Request-Id", id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  serializers: {
    req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
  },
});

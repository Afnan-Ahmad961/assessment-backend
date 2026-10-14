// Final error handler. Every error ends up here and leaves as:
//   { "error": { "code": "...", "message": "...", "details"?: ... } }
// Known errors (HttpError, malformed JSON bodies) keep their status. Anything unexpected is logged
// with its stack and returned as a generic 500, so internals never leak to the client.
import type { ErrorRequestHandler } from "express";

import { HttpError } from "../lib/http-error.js";

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const httpError = toHttpError(err);

  if (httpError.status >= 500) {
    req.log.error({ err }, "Unhandled error");
  }

  res.status(httpError.status).json({
    error: {
      code: httpError.code,
      message: httpError.message,
      ...(httpError.details === undefined ? {} : { details: httpError.details }),
    },
  });
};

function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) {
    return err;
  }

  // Errors thrown by express.json() carry a `type` field.
  if (typeof err === "object" && err !== null && "type" in err) {
    if (err.type === "entity.parse.failed") {
      return HttpError.badRequest("Request body is not valid JSON");
    }
    if (err.type === "entity.too.large") {
      return new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
    }
  }

  return new HttpError(500, "INTERNAL_ERROR", "Something went wrong");
}

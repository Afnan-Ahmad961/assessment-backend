// HttpError: the one error type services and middleware throw on purpose. The error handler turns
// it into a JSON response with the right status code; anything else becomes a generic 500.

export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }

  static badRequest(message: string, details?: unknown) {
    return new HttpError(400, "BAD_REQUEST", message, details);
  }

  static validation(details: unknown) {
    return new HttpError(400, "VALIDATION_FAILED", "Request validation failed", details);
  }

  static unauthorized(message = "Authentication required") {
    return new HttpError(401, "UNAUTHORIZED", message);
  }

  static forbidden(message = "You do not have access to this resource") {
    return new HttpError(403, "FORBIDDEN", message);
  }

  static notFound(message = "Resource not found") {
    return new HttpError(404, "NOT_FOUND", message);
  }

  static conflict(message: string) {
    return new HttpError(409, "CONFLICT", message);
  }

  /** Well-formed request that breaks a business rule, e.g. booking outside opening hours. */
  static unprocessable(message: string) {
    return new HttpError(422, "UNPROCESSABLE", message);
  }
}

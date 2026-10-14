// Request validation. `validate({ body, query, params })` parses each part with its Zod schema,
// replaces it with the parsed (trimmed, coerced) value, and rejects the request with a 400 listing
// every problem if anything is invalid. Handlers can then trust their input.
import type { RequestHandler } from "express";
import type { z } from "zod";

import { HttpError } from "../lib/http-error.js";

type RequestPart = "body" | "query" | "params";

type RequestSchemas = Partial<Record<RequestPart, z.ZodType>>;

export type ValidationIssue = {
  location: RequestPart;
  path: string;
  message: string;
};

export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    const issues: ValidationIssue[] = [];

    for (const part of ["body", "query", "params"] as const) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);

      if (!result.success) {
        issues.push(
          ...result.error.issues.map((issue) => ({
            location: part,
            path: issue.path.map(String).join("."),
            message: issue.message,
          })),
        );
        continue;
      }

      // In Express 5, req.query is a read-only getter, so it has to be redefined rather than assigned.
      Object.defineProperty(req, part, { value: result.data, writable: true, configurable: true, enumerable: true });
    }

    next(issues.length > 0 ? HttpError.validation(issues) : undefined);
  };
}

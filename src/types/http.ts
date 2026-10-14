// Shared HTTP types used by controllers.
import type { Request } from "express";

/** A request whose body, query, and params have already been parsed by the validate() middleware. */
export type ValidatedRequest<TBody = unknown, TQuery = unknown, TParams = Record<string, string>> = Request<
  TParams,
  unknown,
  TBody,
  TQuery
>;

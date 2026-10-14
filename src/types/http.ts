// Shared HTTP types used by controllers.
import type { Request } from "express";

/** A request whose body has already been parsed by the validate() middleware. */
export type ValidatedRequest<TBody> = Request<Record<string, string>, unknown, TBody>;

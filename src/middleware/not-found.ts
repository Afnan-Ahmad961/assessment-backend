// Catch-all for requests that matched no route. Mounted after all routers, before the error handler.
import type { RequestHandler } from "express";

import { HttpError } from "../lib/http-error.js";

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(HttpError.notFound(`Route ${req.method} ${req.path} not found`));
};

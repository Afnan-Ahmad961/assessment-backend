// Health check used by Docker and the VPS to know the API is up and can reach the database.
import type { Request, Response } from "express";

import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";

export async function health(req: Request, res: Response) {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    req.log.error({ err }, "Health check: database unreachable");
    throw new HttpError(503, "SERVICE_UNAVAILABLE", "Database unreachable");
  }

  res.status(200).json({ data: { status: "ok" } });
}

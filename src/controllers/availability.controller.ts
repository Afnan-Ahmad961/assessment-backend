// HTTP layer for availability.
import type { Response } from "express";

import type { AvailabilityQuery } from "../schemas/appointment.schema.js";
import * as availabilityService from "../services/availability.service.js";
import type { ValidatedRequest } from "../types/http.js";

export async function list(req: ValidatedRequest<unknown, AvailabilityQuery>, res: Response) {
  const { service, timeZone, slots } = await availabilityService.getAvailableSlots(req.query.serviceId, req.query.date);
  res.status(200).json({ data: { date: req.query.date, timeZone, service, slots } });
}

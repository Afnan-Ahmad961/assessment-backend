// HTTP layer for the list of bookable services.
import type { Request, Response } from "express";

import * as serviceCatalog from "../services/service-catalog.service.js";

export async function list(_req: Request, res: Response) {
  const services = await serviceCatalog.listActiveServices();
  res.status(200).json({ data: { services } });
}

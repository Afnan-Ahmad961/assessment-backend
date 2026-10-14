// /services routes. Requires a signed-in user.
import { Router } from "express";

import * as serviceCatalogController from "../controllers/service-catalog.controller.js";
import { requireAuth } from "../middleware/require-auth.js";

export const serviceCatalogRouter = Router();

serviceCatalogRouter.get("/", requireAuth, serviceCatalogController.list);

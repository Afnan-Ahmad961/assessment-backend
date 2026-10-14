// /availability routes. Requires a signed-in user.
import { Router } from "express";

import * as availabilityController from "../controllers/availability.controller.js";
import { requireAuth } from "../middleware/require-auth.js";
import { validate } from "../middleware/validate.js";
import { availabilityQuerySchema } from "../schemas/appointment.schema.js";

export const availabilityRouter = Router();

availabilityRouter.get("/", requireAuth, validate({ query: availabilityQuerySchema }), availabilityController.list);

// /appointments routes. All require a signed-in user.
import { Router } from "express";

import * as appointmentController from "../controllers/appointment.controller.js";
import { requireAuth } from "../middleware/require-auth.js";
import { validate } from "../middleware/validate.js";
import {
  appointmentParamsSchema,
  createAppointmentBodySchema,
  listAppointmentsQuerySchema,
} from "../schemas/appointment.schema.js";

export const appointmentRouter = Router();

appointmentRouter.use(requireAuth);

appointmentRouter.post("/", validate({ body: createAppointmentBodySchema }), appointmentController.create);
appointmentRouter.get("/", validate({ query: listAppointmentsQuerySchema }), appointmentController.list);
appointmentRouter.get("/:id", validate({ params: appointmentParamsSchema }), appointmentController.getOne);

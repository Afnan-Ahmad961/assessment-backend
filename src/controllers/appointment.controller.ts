// HTTP layer for appointments.
import type { Response } from "express";

import { getAuth } from "../middleware/require-auth.js";
import type { AppointmentParams, CreateAppointmentBody, ListAppointmentsQuery } from "../schemas/appointment.schema.js";
import * as appointmentService from "../services/appointment.service.js";
import type { ValidatedRequest } from "../types/http.js";

export async function create(req: ValidatedRequest<CreateAppointmentBody>, res: Response) {
  // Bookings through this endpoint come from the form; the chat flow creates its own with source CHAT.
  const appointment = await appointmentService.createAppointment({
    userId: getAuth(req).userId,
    ...req.body,
    source: "FORM",
  });
  res.status(201).json({ data: { appointment } });
}

export async function list(req: ValidatedRequest<unknown, ListAppointmentsQuery>, res: Response) {
  const appointments = await appointmentService.listAppointments(getAuth(req).userId, req.query.scope);
  res.status(200).json({ data: { appointments } });
}

export async function getOne(req: ValidatedRequest<unknown, unknown, AppointmentParams>, res: Response) {
  const appointment = await appointmentService.getAppointment(getAuth(req).userId, req.params.id);
  res.status(200).json({ data: { appointment } });
}

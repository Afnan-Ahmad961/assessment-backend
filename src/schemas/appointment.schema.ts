// Zod schemas for appointment, availability, and service requests.
import { z } from "zod";

export const createAppointmentBodySchema = z.object({
  serviceId: z.uuid("Choose a service"),
  // Must include a timezone offset ("2026-10-20T10:00:00Z" or "...+05:00") so it's an exact moment.
  startsAt: z.iso.datetime({ offset: true, message: "Enter a valid start time" }).transform((value) => new Date(value)),
  notes: z
    .string()
    .trim()
    .max(1000, "Notes must be at most 1000 characters")
    .optional()
    .transform((value) => value || undefined),
});

export const listAppointmentsQuerySchema = z.object({
  scope: z.enum(["upcoming", "past"]).default("upcoming"),
});

export const appointmentParamsSchema = z.object({
  id: z.uuid("Invalid appointment id"),
});

export const availabilityQuerySchema = z.object({
  serviceId: z.uuid("Choose a service"),
  date: z.iso.date("Date must be in YYYY-MM-DD format"),
});

export type CreateAppointmentBody = z.infer<typeof createAppointmentBodySchema>;
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;
export type AppointmentParams = z.infer<typeof appointmentParamsSchema>;
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

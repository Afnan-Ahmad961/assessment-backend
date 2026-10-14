// Creating and reading appointments. Users only ever see their own.
import { Prisma, type BookingSource } from "../generated/prisma/client.js";
import { addMinutes } from "../lib/business-time.js";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";

import { getSlotProblem } from "./booking-rules.service.js";
import { getActiveServiceOrThrow } from "./service-catalog.service.js";

const LIST_LIMIT = 50;

const appointmentSelect = {
  id: true,
  startsAt: true,
  endsAt: true,
  status: true,
  source: true,
  notes: true,
  createdAt: true,
  service: { select: { id: true, name: true, durationMinutes: true } },
} satisfies Prisma.AppointmentSelect;

export type AppointmentView = Prisma.AppointmentGetPayload<{ select: typeof appointmentSelect }>;

export type CreateAppointmentInput = {
  userId: string;
  serviceId: string;
  startsAt: Date;
  notes?: string | undefined;
  source: BookingSource;
  chatSessionId?: string | undefined;
};

export async function createAppointment(input: CreateAppointmentInput): Promise<AppointmentView> {
  const service = await getActiveServiceOrThrow(input.serviceId);

  const problem = getSlotProblem(input.startsAt, service.durationMinutes, new Date());
  if (problem) {
    throw HttpError.unprocessable(problem);
  }

  try {
    return await prisma.appointment.create({
      data: {
        userId: input.userId,
        serviceId: service.id,
        chatSessionId: input.chatSessionId ?? null,
        startsAt: input.startsAt,
        endsAt: addMinutes(input.startsAt, service.durationMinutes),
        source: input.source,
        notes: input.notes ?? null,
      },
      select: appointmentSelect,
    });
  } catch (error) {
    // No overlap check beforehand: the database constraint is the source of truth, so two
    // people booking the same slot at the same moment can't both succeed.
    if (isOverlapViolation(error)) {
      throw HttpError.conflict("That time was just booked. Please pick another slot.");
    }
    throw error;
  }
}

export type AppointmentScope = "upcoming" | "past";

export function listAppointments(userId: string, scope: AppointmentScope): Promise<AppointmentView[]> {
  const now = new Date();

  return prisma.appointment.findMany({
    where: { userId, endsAt: scope === "upcoming" ? { gt: now } : { lte: now } },
    orderBy: { startsAt: scope === "upcoming" ? "asc" : "desc" },
    take: LIST_LIMIT,
    select: appointmentSelect,
  });
}

export async function getAppointment(userId: string, id: string): Promise<AppointmentView> {
  // Filtering by userId means another user's appointment looks exactly like a missing one.
  const appointment = await prisma.appointment.findFirst({ where: { id, userId }, select: appointmentSelect });
  if (!appointment) {
    throw HttpError.notFound("Appointment not found");
  }
  return appointment;
}

/** The appointment booked from a chat session, if any. */
export function findAppointmentForSession(chatSessionId: string): Promise<AppointmentView | null> {
  return prisma.appointment.findFirst({ where: { chatSessionId }, select: appointmentSelect });
}

// 23P01 is Postgres's exclusion_violation; the only exclusion constraint on appointments is
// appointments_no_overlap. Prisma passes the original Postgres error through in `meta`.
const POSTGRES_EXCLUSION_VIOLATION = "23P01";

function isOverlapViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const adapterError = error.meta?.driverAdapterError;
  if (typeof adapterError !== "object" || adapterError === null || !("cause" in adapterError)) return false;
  const { cause } = adapterError;
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === POSTGRES_EXCLUSION_VIOLATION;
}

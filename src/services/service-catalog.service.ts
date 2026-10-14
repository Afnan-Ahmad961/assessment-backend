// The bookable services (Consultation, Follow-up, ...). Only active services are visible.
import type { Prisma } from "../generated/prisma/client.js";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";

const serviceSelect = {
  id: true,
  name: true,
  description: true,
  durationMinutes: true,
} satisfies Prisma.ServiceSelect;

export type ServiceView = Prisma.ServiceGetPayload<{ select: typeof serviceSelect }>;

export function listActiveServices(): Promise<ServiceView[]> {
  return prisma.service.findMany({ where: { isActive: true }, select: serviceSelect, orderBy: { name: "asc" } });
}

export async function getActiveServiceOrThrow(id: string): Promise<ServiceView> {
  const service = await prisma.service.findFirst({ where: { id, isActive: true }, select: serviceSelect });
  if (!service) {
    throw HttpError.notFound("Service not found");
  }
  return service;
}

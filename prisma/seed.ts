// Seeds the bookable services. Safe to run repeatedly: services are matched by name and updated.
import { prisma } from "../src/lib/prisma.js";

const services = [
  { name: "Consultation", description: "A first conversation to understand what you need.", durationMinutes: 30 },
  { name: "Follow-up", description: "A short check-in after a previous appointment.", durationMinutes: 15 },
  { name: "Extended session", description: "A longer, in-depth session.", durationMinutes: 60 },
];

async function main() {
  for (const service of services) {
    await prisma.service.upsert({ where: { name: service.name }, create: service, update: service });
  }
  console.log(`Seeded ${services.length} services`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

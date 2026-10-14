// Single PrismaClient for the whole process, connected through the node-postgres driver adapter.
import { PrismaPg } from "@prisma/adapter-pg";

import { env } from "../config/env.js";
import { PrismaClient } from "../generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });

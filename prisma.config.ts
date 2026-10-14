// Prisma CLI configuration: where the schema and migrations live and which database to talk to.
import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

config({ quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});

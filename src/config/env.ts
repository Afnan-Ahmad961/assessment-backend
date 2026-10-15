// Loads and validates environment variables once at startup. The rest of the app imports `env`
// from here instead of reading process.env, so a missing or malformed variable fails fast.
import { config } from "dotenv";
import { z } from "zod";

config({ quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  // Shared with the Next.js BFF. Proves an X-Client-IP header really came from the BFF, so rate
  // limits apply per user IP instead of to all of Vercel's servers at once.
  BFF_SHARED_SECRET: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(32, "BFF_SHARED_SECRET must be at least 32 characters").optional(),
  ),

  DATABASE_URL: z.url(),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // IANA name, e.g. "Europe/London". Business hours in config/booking.ts are in this timezone.
  BUSINESS_TIMEZONE: z
    .string()
    .default("UTC")
    .refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz) || tz === "UTC", "Unknown timezone"),

  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  GEMINI_MODEL: z.string().default("gemini-3.1-flash-lite"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:\n" + z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === "production";

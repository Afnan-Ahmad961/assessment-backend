// Zod schemas for auth request bodies, plus the TypeScript types inferred from them.
import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address").max(254));

// bcrypt only looks at the first 72 bytes of a password, so longer ones are rejected rather than
// silently truncated.
const newPassword = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters");

const refreshToken = z.string().min(1).max(200);

export const signupBodySchema = z.object({
  email,
  password: newPassword,
  fullName: z.string().trim().min(1, "Name is required").max(100),
});

export const loginBodySchema = z.object({
  email,
  password: z.string().min(1, "Password is required").max(72),
});

export const refreshBodySchema = z.object({ refreshToken });

export const logoutBodySchema = z.object({ refreshToken });

export type SignupBody = z.infer<typeof signupBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type RefreshBody = z.infer<typeof refreshBodySchema>;
export type LogoutBody = z.infer<typeof logoutBodySchema>;

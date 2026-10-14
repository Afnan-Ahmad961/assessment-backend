// Password hashing with bcrypt.
import bcrypt from "bcryptjs";

const BCRYPT_COST = 8;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Compared against when the email doesn't exist, so "unknown email" and "wrong password" take the
// same time and an attacker can't use response timing to discover which emails are registered.
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync("timing-attack-placeholder", BCRYPT_COST);

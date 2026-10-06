import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

let dummy: Promise<string> | undefined;

/**
 * Checks a password against a stored argon2 hash. Without a hash (no such account) it still
 * runs one argon2 verify against a throwaway hash with the same parameters, so the response
 * time does not tell an attacker whether the email address has an account.
 */
export async function verifyPassword(hash: string | null | undefined, password: string): Promise<boolean> {
  if (!hash) {
    dummy ??= argon2.hash(randomBytes(16).toString('hex'));
    await argon2.verify(await dummy, password).catch(() => false);
    return false;
  }
  return argon2.verify(hash, password).catch(() => false);
}

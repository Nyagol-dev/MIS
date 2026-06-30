/**
 * lib/auth/password.ts
 *
 * Password hashing and verification using argon2id.
 *
 * NULLABLE password_hash COLUMN
 * ─────────────────────────────────────────────────────────────────────────────
 * The `users.password_hash` column is TEXT and nullable (NULL for SSO-only
 * users). A NULL value does NOT mean "no password set, allow anything" — it
 * means the user account is SSO-only and MUST NOT accept password login
 * attempts. verifyPassword() enforces this by throwing SsoOnlyUserError
 * when hash is null, rather than returning false, so callers are forced
 * to handle the SSO case explicitly rather than silently falling through.
 */

import argon2 from "argon2";

// ─── Error types ──────────────────────────────────────────────────────────────

/**
 * Thrown by verifyPassword when the stored hash is null, indicating the user
 * account is SSO-only and password login is not permitted.
 *
 * Callers should return an HTTP 403 or a user-facing message like:
 * "This account uses SSO. Please sign in with your identity provider."
 */
export class SsoOnlyUserError extends Error {
  public readonly code = "SSO_ONLY_USER" as const;

  constructor(userId?: string) {
    super(
      userId
        ? `User ${userId} is SSO-only and cannot log in with a password.`
        : "This account is SSO-only and cannot log in with a password."
    );
    this.name = "SsoOnlyUserError";
  }
}

// ─── argon2id configuration ───────────────────────────────────────────────────

/**
 * Recommended argon2id parameters as of OWASP 2024:
 * - memoryCost: 64 MiB (65536 KiB)
 * - timeCost:   3 iterations
 * - parallelism: 4
 *
 * Tune upward on dedicated hardware; these are conservative defaults
 * suitable for serverless environments with ~128–256 MiB memory budgets.
 */
const ARGON2_OPTIONS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 65_536, // 64 MiB in KiB
  timeCost: 3,
  parallelism: 4,
};

// ─── Exported functions ───────────────────────────────────────────────────────

/**
 * Hashes a plaintext password using argon2id.
 *
 * The returned string is the full encoded argon2 PHC string
 * (e.g. `$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>`) and can be stored
 * directly in `users.password_hash`.
 *
 * @param plaintext - The raw password as supplied by the user.
 * @returns The PHC-encoded argon2id hash string.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  try {
  return await argon2.hash(plaintext, ARGON2_OPTIONS);
} catch (err) {
  // Convert any low-level argon2 error into a generic auth-failure error.
  throw new AuthFailureError('Password hashing failed');
}
}

/**
 * Verifies a plaintext password against a stored argon2id hash.
 *
 * @param storedHash - The value of `users.password_hash` from the database.
 *                     MUST be passed as-is — do NOT coerce null to empty string.
 * @param plaintext  - The raw password supplied by the user.
 * @returns `true` if the password matches, `false` if it does not.
 * @throws {SsoOnlyUserError} If storedHash is null — the account is SSO-only
 *                            and password login must be rejected.
 */
export async function verifyPassword(
  storedHash: string | null,
  plaintext: string
): Promise<boolean> {
  if (storedHash === null) {
    // Explicit rejection — do NOT fall through or return false.
    // Callers must handle this case as a definitive "cannot use password login".
    throw new SsoOnlyUserError();
  }

  try {
  return await argon2.verify(storedHash, plaintext);
} catch (err) {
  // Convert any verification error into a generic authentication failure.
  throw new AuthFailureError('Password verification failed');
}
}
/** Generic authentication error used to mask internal hashing/verification failures. */
export class AuthFailureError extends Error {
  public readonly code = 'AUTH_FAILURE' as const;
  constructor(message?: string) {
    super(message ?? 'Authentication failed');
    this.name = 'AuthFailureError';
  }
}

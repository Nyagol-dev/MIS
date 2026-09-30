import { createHmac } from "node:crypto";
import type { Pool } from "pg";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function hashScope(value: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be configured before login rate limiting can run.");
  }
  return createHmac("sha256", secret).update(value).digest("hex");
}

/**
 * Rate limit a login source without storing its raw address. The proxy in front
 * of Next.js must overwrite X-Forwarded-For or X-Real-IP; never expose the Node
 * listener directly to untrusted networks when relying on these headers.
 */
export async function checkLoginRateLimit(
  pool: Pool,
  forwardedFor: string | null,
  realIp: string | null,
  fallbackIdentity: string
): Promise<{ allowed: boolean; retryAfterSeconds: number; scopeHash: string | null }> {
  // Behind a trusted proxy, source address throttling applies to every account.
  // Local or direct deployments without forwarded address headers still get a
  // per-account bucket rather than silently disabling throttling.
  const source = realIp?.trim() || forwardedFor?.split(",")[0]?.trim() || `account:${fallbackIdentity}`;

  const scopeHash = hashScope(source);
  const { rows } = await pool.query<{ attempt_count: number; window_started_at: Date }>(
    `INSERT INTO auth_login_attempts (scope_hash, window_started_at, attempt_count)
     VALUES ($1, now(), 1)
     ON CONFLICT (scope_hash) DO UPDATE SET
       attempt_count = CASE
         WHEN auth_login_attempts.window_started_at < now() - interval '15 minutes' THEN 1
         ELSE auth_login_attempts.attempt_count + 1
       END,
       window_started_at = CASE
         WHEN auth_login_attempts.window_started_at < now() - interval '15 minutes' THEN now()
         ELSE auth_login_attempts.window_started_at
       END
     RETURNING attempt_count, window_started_at`,
    [scopeHash]
  );

  // Opportunistic bounded cleanup prevents expired source hashes accumulating.
  await pool.query(
    `DELETE FROM auth_login_attempts
      WHERE window_started_at < now() - interval '1 day'`
  );

  const attemptCount = Number(rows[0]?.attempt_count ?? 0);
  const windowStartedAt = new Date(rows[0]?.window_started_at ?? Date.now()).getTime();
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStartedAt + WINDOW_MS - Date.now()) / 1000));
  return {
    allowed: attemptCount <= MAX_ATTEMPTS,
    retryAfterSeconds,
    scopeHash,
  };
}

export async function clearLoginRateLimit(pool: Pool, scopeHash: string | null): Promise<void> {
  if (!scopeHash) return;
  await pool.query("DELETE FROM auth_login_attempts WHERE scope_hash = $1", [scopeHash]);
}

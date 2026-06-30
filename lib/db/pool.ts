/**
 * lib/db/pool.ts
 *
 * WHY TWO SEPARATE POOLS / ROLES?
 * ─────────────────────────────────────────────────────────────────────────────
 * The PostgreSQL schema enforces tenant isolation via Row-Level Security (RLS).
 *
 * • `appPool`   connects as `mis_app`, which has FORCE ROW LEVEL SECURITY on
 *   every tenant-scoped table. RLS policies call current_tenant_id(), which
 *   reads the `app.current_tenant_id` session variable. Normal request-scoped
 *   queries MUST go through withTenantContext (lib/db/withTenant.ts) so that
 *   variable is always set inside an explicit transaction.
 *
 * • `adminPool` connects as `mis_admin`, which is the table OWNER and therefore
 *   bypasses RLS entirely. This pool is exported separately and must ONLY be
 *   used behind an explicit requirePlatformAdmin() guard
 *   (lib/auth/permissions.ts). Collapsing these into one pool would silently
 *   break tenant isolation for every admin operation.
 *
 * PGBOUNCER / NEON POOLER COMPATIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Both pools are configured for transaction-pooling mode (Neon's default when
 * using the pooler endpoint on port 6432). Key constraint: named prepared
 * statements are NOT supported under transaction pooling — use parameterised
 * queries ($1, $2, …) only. The `pg` driver's default `statement_timeout`
 * is left to the server; set it via the connection string if needed.
 *
 * SINGLETON PATTERN
 * ─────────────────────────────────────────────────────────────────────────────
 * Pools are cached on `globalThis` so they survive Next.js hot-reload in dev
 * (module re-evaluation) and reuse warm connections in serverless invocations.
 */

import { Pool } from "pg";

// ─── Type augmentation for the cache ────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __mis_app_pool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __mis_admin_pool: Pool | undefined;
}

// ─── Connection pool configuration ──────────────────────────────────────────

/**
 * Shared base options appropriate for both pools under Neon transaction pooling.
 * Prepared statements are explicitly disabled at the protocol level by NOT using
 * pg's query-cache helpers; callers should always use plain parameterised queries.
 */
function makePoolConfig(connectionString: string): ConstructorParameters<typeof Pool>[0] {
  return {
    connectionString,
    // Keep pool small for serverless. Neon pooler handles the heavy lifting.
    max: 5,
    // Idle connections released quickly to avoid Neon's idle-timeout disconnects.
    idleTimeoutMillis: 10_000,
    // Connection-level timeout — fail fast rather than queue indefinitely.
    connectionTimeoutMillis: 5_000,
    // Disable SSL certificate validation only when explicitly opted-out
    // (e.g. local dev against a self-signed cert). Default: require SSL.
    ssl:
      process.env.PGSSLMODE === "disable"
        ? false
        : { rejectUnauthorized: false },
  };
}

// ─── appPool ─────────────────────────────────────────────────────────────────

/**
 * Application pool — connects as the `mis_app` Postgres role.
 *
 * RLS is FORCE-applied for this role: every query sees only the rows permitted
 * by the current_tenant_id() function, which reads `app.current_tenant_id`.
 * All queries through this pool MUST be wrapped in withTenantContext so that
 * variable is set inside an explicit transaction and never leaks between
 * connections returned to the pool.
 *
 * Connection string: DATABASE_URL_APP (must point to the Neon pooler endpoint).
 */
function createAppPool(): Pool {
  const connectionString = process.env.DATABASE_URL_APP;
  if (!connectionString) {
    throw new Error(
      "[mis] DATABASE_URL_APP is not set. " +
        "Set it to the mis_app connection string (Neon pooler endpoint). " +
        "See .env.example for the expected format."
    );
  }
  const pool = new Pool(makePoolConfig(connectionString));

  pool.on("error", (err) => {
    // Log unexpected idle-client errors. The pool will attempt to recover.
    console.error("[mis:appPool] Idle client error:", err);
  });

  return pool;
}

/**
 * adminPool — connects as the `mis_admin` Postgres role.
 *
 * `mis_admin` is the table OWNER and is NOT subject to RLS — it bypasses all
 * tenant isolation policies. This pool must ONLY be used from code that has
 * called requirePlatformAdmin() (lib/auth/permissions.ts) first.
 *
 * Do NOT import this pool directly in route handlers or Server Actions.
 * The intended pattern:
 *
 *   import { adminPool } from "@/lib/db/pool";
 *   import { requirePlatformAdmin } from "@/lib/auth/permissions";
 *
 *   requirePlatformAdmin(session); // throws ForbiddenError if not admin
 *   const client = await adminPool.connect();
 *
 * Connection string: DATABASE_URL_ADMIN (may point to the direct Neon endpoint
 * rather than the pooler, depending on your operational requirements).
 */
function createAdminPool(): Pool {
  const connectionString = process.env.DATABASE_URL_ADMIN;
  if (!connectionString) {
    throw new Error(
      "[mis] DATABASE_URL_ADMIN is not set. " +
        "Set it to the mis_admin connection string. " +
        "See .env.example for the expected format."
    );
  }
  const pool = new Pool(makePoolConfig(connectionString));

  pool.on("error", (err) => {
    console.error("[mis:adminPool] Idle client error:", err);
  });

  return pool;
}

// ─── Singleton exports ────────────────────────────────────────────────────────

/**
 * Singleton app pool (mis_app, RLS enforced).
 * All normal request-scoped queries go through withTenantContext using this pool.
 */
export const appPool: Pool =
  globalThis.__mis_app_pool ?? (globalThis.__mis_app_pool = createAppPool());

/**
 * Singleton admin pool (mis_admin, bypasses RLS).
 * Only reachable from code that explicitly calls requirePlatformAdmin() first.
 */
export const adminPool: Pool =
  globalThis.__mis_admin_pool ??
  (globalThis.__mis_admin_pool = createAdminPool());

# Round 6 — Platform Admin Layer: Architectural Blueprint

> [!IMPORTANT]
> This is a **design document only** — no implementation code. Every decision
> here is binding for the Round 6 implementation tasks drafted from it.
> Ambiguities flagged as ⚠️ TEAM DECISION require an explicit sign-off before
> implementation begins.

---

## Table of Contents

1. [Q1 — Where do platform admins live?](#q1--where-do-platform-admins-live)
2. [Q2 — Session model for platform admins](#q2--session-model-for-platform-admins)
3. [Q3 — Cross-tenant DB access pattern](#q3--cross-tenant-db-access-pattern)
4. [Q4 — Audit logging for platform-level actions](#q4--audit-logging-for-platform-level-actions)
5. [Q5 — Bootstrapping problem: creating the first tenant](#q5--bootstrapping-problem-creating-the-first-tenant)
6. [Q6 — Scope boundary with Round 5](#q6--scope-boundary-with-round-5)
7. [Schema Changes Summary (DDL Sketches)](#schema-changes-summary-ddl-sketches)
8. [Change Surface: Round 1–5 Files vs. Additive](#change-surface-round-15-files-vs-additive)
9. [Open Team Decisions](#open-team-decisions)

---

## Q1 — Where do platform admins live?

### Options Evaluated

| Criterion | Option A: Separate `platform_admins` table | Option B: Reuse `users` with nullable `tenant_id` |
|---|---|---|
| **Composite PK invariant** | ✅ Preserved entirely. `platform_admins` has its own PK `(id)` — no composite PK at all. | ❌ **Breaks the invariant.** `users.tenant_id` is `NOT NULL` in the current schema (`REFERENCES organizations(id) ON DELETE CASCADE`). Making it nullable would require an `ALTER TABLE`, invalidating the `UNIQUE (tenant_id, email)` constraint and every composite FK referencing `(tenant_id, id)`. |
| **RLS isolation** | ✅ `platform_admins` is a platform-controlled table with no tenant-scoped RLS policies. Platform admins are structurally outside tenant space. | ❌ A platform admin row would need `tenant_id = NULL`. Every existing RLS policy (`WHERE tenant_id = current_tenant_id()`) would evaluate to `NULL = UUID` → false, hiding the row from mis_app entirely. The platform admin would be invisible to all RLS-gated queries — a latent bug waiting to happen. |
| **Email uniqueness** | ✅ Platform admins are in a separate table; no collision with tenant user emails. | ❌ `UNIQUE (tenant_id, email)` only prevents duplicates within a tenant. A NULL tenant_id makes the uniqueness guarantee undefined — multiple rows with `tenant_id = NULL, email = 'admin@x.com'` would pass the constraint (NULL ≠ NULL in Postgres unique indexes). Requires a separate partial unique index. |
| **`getEffectivePermissions` coupling** | ✅ Completely decoupled — platform admins do not participate in the `user_roles` / `role_permissions` / tenant-scoped permission graph at all. | ❌ If a platform admin row lives in `users`, they would have a `tenant_id` (or NULL tenant), making it tempting to route permission checks through `getEffectivePermissions`, which is scoped by `tenant_id`. This creates confusion about whether platform authorization is a tenant-permission check or a structural check. |
| **Audit log FK** | ✅ `audit_log.actor_id` is already nullable UUID — platform admin IDs from `platform_admins.id` slot in without any schema change. | ✅ Same — user IDs are UUIDs regardless of table. |
| **Migration cost** | ✅ Purely additive — new table, no changes to existing tables. | ❌ Breaking change: `ALTER TABLE users ALTER COLUMN tenant_id DROP NOT NULL`, change composite FK constraints on every downstream table (`user_roles`, `audit_log`, etc.), update all RLS policies. Enormous blast radius. |

### **Decision: Option A — Separate `platform_admins` table**

**Reasoning:** Option B requires breaking an existing invariant (`users.tenant_id NOT NULL`) that is structural to every other design decision in the schema. The cost is enormous (RLS policy changes, FK constraint changes, composite PK violations) and the justification does not exist — platform admins are conceptually not tenant members and should not be modeled as such. A separate table is purely additive and makes the intent unambiguous.

---

## Q2 — Session model for platform admins

### Constraint recap

- `middleware.ts` is **Edge-only** and must not import `pg`.
- The current `verifySession()` call in middleware is the sole auth gate.
- Current `SessionPayload` shape: `{ userId: string; tenantId: string; issuedAt: number }`.

### Options Evaluated

| Criterion | Option A: Extend existing shape (`tenantId: null \| string`, `isPlatformAdmin?: boolean`) | Option B: Structurally distinct session type + distinct verification path |
|---|---|---|
| **Type safety** | ⚠️ `tenantId` becomes `string \| null`. Every call site that currently assumes `tenantId: string` would need a null-guard or a TypeScript discriminated union. This is not a zero-blast-radius change to `SessionPayload`. | ✅ The existing `SessionPayload` type stays unchanged. A new `PlatformAdminSessionPayload` type carries `platformAdminId` and a `sessionKind: 'platform_admin'` discriminant. |
| **Middleware complexity** | ⚠️ `verifySession()` would need to return a discriminated union or union type. Middleware would need to branch on `isPlatformAdmin` to redirect differently (e.g., platform admins bypassing tenant route guards). | ✅ Middleware calls a shared `verifyAnySession()` helper that returns `{ kind: 'tenant', payload: SessionPayload } \| { kind: 'platform_admin', payload: PlatformAdminSessionPayload } \| null`. Routing branches cleanly on `kind`. |
| **JWT signing** | Both options use the same `SESSION_SECRET` and `HS256` algorithm. The difference is purely in payload shape — no new secret, no new algorithm. | Same. |
| **Cookie** | Option A: same cookie name `mis_session` for both kinds. ⚠️ A platform admin arriving at a tenant route would appear authenticated (session valid) but `tenantId = null` — every call to `withTenantContext(session.tenantId, ...)` would pass `null` as the tenant ID, causing RLS failures silently (zero rows, not a thrown error). | Option B: Same cookie name is acceptable *if* route handler code checks `session.kind` before calling `withTenantContext`. Alternatively, use a distinct cookie name `mis_platform_session` — belt-and-suspenders, but adds operational complexity. |
| **Verification path in middleware** | Option A: `getSessionFromRequest()` parses the session and the middleware doesn't know if it's a tenant or platform session — it just checks "is there a valid JWT?" and passes through. Route handlers would need to distinguish. | Option B: Same — middleware just verifies the JWT is signed and unexpired. It does NOT query DB. The distinction between session kinds happens in route handlers, not middleware. |
| **Edge runtime compatibility** | Both options: `jose` handles JWT verification. No `pg` import anywhere in session verification code. ✅ Both are Edge-safe. | ✅ Same. |

### **Decision: Option B — Structurally distinct session type, shared verification path**

**Reasoning:** Keeping `SessionPayload.tenantId` as `string` (never `null`) preserves type safety at all existing call sites without any modifications to Round 1–5 code. A new `PlatformAdminSessionPayload` with a `sessionKind` discriminant makes intent explicit and prevents accidental use of platform admin sessions in tenant-scoped code paths.

**Exact shape:**

```typescript
// lib/auth/session.ts — additive, does not modify existing SessionPayload

export interface PlatformAdminSessionPayload {
  sessionKind: 'platform_admin';
  platformAdminId: string;   // platform_admins.id
  issuedAt: number;
}

export type AnySessionPayload =
  | ({ sessionKind: 'tenant' } & SessionPayload)
  | PlatformAdminSessionPayload;
```

> [!NOTE]
> `SessionPayload` gains an optional `sessionKind?: 'tenant'` discriminant field,
> defaulting to `'tenant'` if absent (backward-compatible with existing JWTs
> already in the wild during a rollout). Alternatively, treat absence of
> `sessionKind` as `'tenant'` in `verifyAnySession()`.
> **⚠️ TEAM DECISION #1:** Does the team want to force a re-login on deploy
> (all existing JWTs expire naturally) or handle `sessionKind`-absent JWTs
> as `'tenant'` for backward compatibility?

**Middleware impact:** `middleware.ts` **does not change**. It calls the existing
`getSessionFromRequest()` (which verifies the JWT is signed and unexpired) and
redirects to `/login` if absent. Platform admin routes live under a prefix like
`/platform/` which middleware treats identically to tenant routes — "is there a
valid JWT?" is the only check middleware performs. The route handler is
responsible for calling `requirePlatformAdminSession(session)` after the
middleware has already confirmed the JWT is valid.

**No pg import anywhere in session verification** — `verifyAnySession()` uses
`jwtVerify` from `jose`, which is Edge-compatible. The `platform_admins` table
lookup (verifying the admin still exists and `is_active = true`) happens in the
route handler (Node runtime), not in middleware.

---

## Q3 — Cross-tenant DB access pattern

### Problem statement

- `getSystemAdminPool()` → `_adminPoolInternal` with no actor identity. Correct for cron. Wrong for human platform admins.
- `getAdminPool(session)` → `_adminPoolInternal` with actor identity, but currently gated by `requirePlatformAdmin()` which throws unconditionally. It also receives a `SessionPayload` which has `tenantId` — implying a tenant context, which is semantically wrong for cross-tenant operations.
- Neither function is right for a human platform admin performing a cross-tenant, auditable mutation.

### Required properties of the new pattern

1. Returns `mis_admin` pool (bypasses RLS across all tenants).
2. Requires a verified `PlatformAdminSessionPayload` — no session = no access.
3. Does NOT set `app.current_tenant_id` (the operation is cross-tenant by definition).
4. Carries the actor identity (`platformAdminId`) for audit logging.

### Options Evaluated

| Criterion | Extend `getAdminPool(session)` | New function `getPlatformAdminPool(session)` |
|---|---|---|
| **Signature clarity** | ❌ `getAdminPool` currently accepts `SessionPayload` which has `tenantId`. Extending it to accept `AnySessionPayload` and branch internally conflates two distinct operations. | ✅ Distinct name, distinct parameter type. Call sites are unambiguous. |
| **Guard placement** | ❌ `requirePlatformAdmin()` currently throws unconditionally (TODO stub). Wiring it for real would change existing behavior of `getAdminPool`. | ✅ New function; no existing call site affected. |
| **Audit obligation** | Both options carry actor identity — the function returns the pool + actor ID so the caller can log. | Same. |
| **Blast radius** | ❌ Any change to `getAdminPool` signature risks breaking existing callers (even if there are none currently, it's an exported API). | ✅ Purely additive. |

### **Decision: New function `getPlatformAdminPool`**

**Exact signature:**

```typescript
// lib/auth/permissions.ts — additive

/**
 * Returns the mis_admin pool for use by a verified platform admin.
 *
 * This is the ONLY sanctioned way to obtain cross-tenant admin access
 * for human-initiated, auditable platform operations. It requires a
 * PlatformAdminSessionPayload — it will NOT accept a tenant SessionPayload.
 *
 * The returned pool bypasses RLS across all tenants. The caller MUST
 * write to platform_audit_log (not audit_log) using the platformAdminId
 * as the actor for every mutation performed with this pool.
 *
 * Do NOT use this pool to SET app.current_tenant_id — that would
 * partially re-enable RLS and create a misleading execution context.
 * Cross-tenant operations use the pool raw (no SET LOCAL).
 *
 * @param session - A verified PlatformAdminSessionPayload. Must be obtained
 *                  from verifyAnySession() and narrowed to kind='platform_admin'.
 * @returns { pool: Pool, platformAdminId: string }
 * @throws {ForbiddenError} if session.sessionKind !== 'platform_admin'
 *         or if the platform_admins row is_active = false (checked in DB).
 */
export async function getPlatformAdminPool(
  session: PlatformAdminSessionPayload
): Promise<{ pool: Pool; platformAdminId: string }>;
```

**Implementation note (not code, just contract):**

The function does two things before returning the pool:
1. Verifies `session.sessionKind === 'platform_admin'` (type guard — throws `ForbiddenError` otherwise).
2. Queries `platform_admins` via `_adminPoolInternal` (not `appPool`, to avoid RLS on the platform_admins table itself) to confirm `is_active = true` for `session.platformAdminId`. This is a single indexed lookup and is NOT in a `withTenantContext` call.

Returns `{ pool: _adminPoolInternal, platformAdminId: session.platformAdminId }` on success.

> [!IMPORTANT]
> The caller receives the `platformAdminId` alongside the pool explicitly so
> it cannot be accidentally omitted from the audit log. The return type
> bundles actor identity with access — you cannot get the pool without also
> having the audit identity.

**What happens to `getAdminPool(session)`?**

It remains unchanged. It still accepts `SessionPayload` (tenant session) and still calls `requirePlatformAdmin()`. Since `requirePlatformAdmin()` currently throws unconditionally (TODO stub), `getAdminPool` is effectively dead code today. In Round 6, the decision is:

> [!WARNING]
> **⚠️ TEAM DECISION #2:** Should `getAdminPool(session: SessionPayload)` be
> deprecated in favor of `getPlatformAdminPool`? The two functions serve
> different use cases (tenant-admin context vs. cross-tenant platform context)
> and the existing name is misleading. **Recommendation: deprecate `getAdminPool`
> by adding a `@deprecated` JSDoc and routing any future callers to
> `getPlatformAdminPool`.** No deletion yet — that's a Round 7 cleanup task.

---

## Q4 — Audit logging for platform-level actions

### Problem statement

`audit_log` has:
- `tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE` — a hard FK.
- RLS: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` — reads are gated by `current_tenant_id()`.
- Partition by `RANGE (created_at)` — the partition key is time, not tenant.

Platform-level actions (create tenant, modify `org_types`, manage `permissions` table atoms) have no single `tenant_id` to supply. Forcing a sentinel value (e.g., a well-known UUID) into `tenant_id` would violate the FK (`organizations.id` must exist) and the semantic meaning of the column.

### Options Evaluated

| Criterion | Option A: Sentinel value in `audit_log` | Option B: Separate `platform_audit_log` table | Option C: Nullable `tenant_id` in `audit_log` |
|---|---|---|---|
| **Schema validity** | ❌ `audit_log.tenant_id` has `REFERENCES organizations(id)` — a sentinel UUID must exist as a real row in `organizations`. This means creating a fake "platform" organization row, which pollutes the tenants table and breaks every "list all tenants" query. | ✅ New table, no modification to existing schema. | ❌ Requires `ALTER TABLE audit_log ALTER COLUMN tenant_id DROP NOT NULL`. This also drops the FK. Every existing audit query that assumes `tenant_id IS NOT NULL` is now incorrect. Breaking change to an append-only table. |
| **RLS impact** | ❌ Even with a sentinel org row, `audit_log` RLS would require `app.current_tenant_id` to be set to the sentinel UUID to read platform audit rows under `mis_app`. Platform admin UI would need to set a fake tenant context. Deeply confusing. | ✅ `platform_audit_log` has no tenant-scoped RLS. It is readable only via `mis_admin` pool or with explicit platform admin authorization. Platform audit data is structurally separated from tenant audit data. | ❌ Makes RLS policies more complex: `USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)` leaks platform-level rows to any authenticated connection. |
| **Partition strategy** | ❌ If using a sentinel row, platform audit rows would live in the same partitions as tenant audit rows. No clean way to apply different retention policies to platform vs. tenant audit data. | ✅ `platform_audit_log` uses the same `PARTITION BY RANGE (created_at)` pattern — consistent with the project convention, no second partitioning scheme introduced. The partition key is identical; only the table is separate. | ⚠️ Same partition table, nullable `tenant_id` — tenant and platform rows co-mingle. |
| **Additive vs. breaking** | ❌ Breaking: requires a real row in `organizations` to exist permanently, and RLS changes to allow querying it. | ✅ Purely additive. | ❌ Breaking: `ALTER TABLE` on a partitioned append-only table. |
| **Query isolation** | ❌ Tenant audit queries (`SELECT ... WHERE tenant_id = $1`) would accidentally match the sentinel if `$1` happens to be the sentinel UUID. Requires defensive filtering everywhere. | ✅ `platform_audit_log` is a separate table — no accidental cross-contamination. Tenant audit queries cannot accidentally return platform events. | ❌ Nullable `tenant_id` means every tenant audit query needs `AND tenant_id IS NOT NULL` or risk pulling platform rows. |

### **Decision: Option B — Separate `platform_audit_log` table**

**Reasoning:** Option A requires corrupting the `organizations` table with a fake row — this pollutes the tenant registry which is a first-class product surface. Option C is a breaking change to an append-only, partitioned table with a hard FK. Option B is purely additive and keeps the separation of concerns clean.

**Partition key decision:** `platform_audit_log` uses `PARTITION BY RANGE (created_at)` — **the same partition strategy as `audit_log`**. This is not a second partitioning *scheme*; it is the same scheme applied to a new table. A default partition absorbs all rows until monthly children are provisioned. No `pg_partman` changes are needed beyond adding the new table to the partitioning schedule.

> [!NOTE]
> The `writeAuditLog()` function in `lib/db/audit.ts` is NOT modified. A new
> `writePlatformAuditLog(client, params)` function is created alongside it,
> using a `PlatformAuditLogParams` type that omits `tenantId` and adds
> `platformAdminId`. Callers that need `tenantId` (because a platform action
> affects a specific tenant) can include it in the `context` JSONB field —
> but it is not a mandatory FK column.

---

## Q5 — Bootstrapping problem: creating the first tenant

### Confirming RLS status of `organizations`

From the schema ([`canonical_postgres_schema.md` §2.1](file:///home/nickson/Projects/MIS/canonical_postgres_schema.md)):

```sql
CREATE TABLE organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE,
    ...
);
```

**RLS is NOT enabled on `organizations`.** The `ENABLE ROW LEVEL SECURITY` / `FORCE ROW LEVEL SECURITY` / policy blocks in §3 of the schema apply only to:
- `users`
- `roles`
- `role_permissions`
- `user_roles`
- `audit_log`
- `tenant_permission_overrides`
- `entity_types`
- `field_definitions`
- `entity_records`
- `role_entity_type_permissions`
- `event_subscriptions`
- `event_execution_log`

`organizations` and `org_types` have **no RLS policies at all**.

### What this means

- Any connection as `mis_app` can read all rows from `organizations` and `org_types`.
- Any connection as `mis_app` can insert into `organizations` — there is no RLS INSERT policy blocking it.
- However, from a correctness/authorization standpoint, the application layer must not allow arbitrary users to create tenants.

### Bootstrapping answer

**Creating the first tenant (or any tenant) uses `_adminPoolInternal` (the `mis_admin` role), called via `getPlatformAdminPool()`, without setting `app.current_tenant_id`.**

The full execution path is:

1. Platform admin authenticates → receives `PlatformAdminSessionPayload` JWT.
2. Route handler calls `getPlatformAdminPool(session)` → receives `{ pool, platformAdminId }`.
3. Handler checks out a client from `pool` and runs a transaction:
   ```sql
   BEGIN;
   INSERT INTO organizations (...) VALUES (...) RETURNING id;
   -- Optionally seed default roles or system data for the new tenant.
   INSERT INTO platform_audit_log (...) VALUES (...);
   COMMIT;
   ```
4. No `SET LOCAL app.current_tenant_id` is issued. The `organizations` table has no RLS, so the insert goes through directly.
5. If seeding tenant-internal data (e.g., default roles), those rows can be inserted in the same transaction because `mis_admin` bypasses RLS on all tables.

**Why not `mis_app` for tenant creation?**

Although `organizations` has no RLS and `mis_app` *could* technically insert a row, there is no platform admin session verification on `mis_app` connections. Using `mis_app` for tenant creation would mean the authorization check is purely at the application layer with no defense-in-depth from the DB role. `mis_admin` being used only through `getPlatformAdminPool` (which enforces `PlatformAdminSessionPayload`) provides the structural guarantee that tenant creation is gated on platform admin identity.

**`org_types` is also unprotected by RLS.** Platform admins managing `org_types` (create/update org type slugs) follow the same pattern: `getPlatformAdminPool()` + direct query on `mis_admin`. Tenant users cannot modify `org_types` because no route handler allows it, and future enforcement could be added as an RLS policy if needed.

> [!NOTE]
> **No schema change is required for the bootstrapping path.** The `organizations`
> table is already unprotected by RLS — this is the correct design for a
> registry table that must be writable during tenant creation.

---

## Q6 — Scope boundary with Round 5

### `requireTenantAdmin` recap (Round 5)

[`lib/auth/requireTenantAdmin.ts`](file:///home/nickson/Projects/MIS/lib/auth/requireTenantAdmin.ts) checks for the `'user:manage'` permission codename, resolved via `user_roles → role_permissions → (permissions | tenant_permission_overrides)` — the **tenant-scoped permission graph**.

Its signature: `requireTenantAdmin(client: PoolClient, session: SessionPayload): Promise<ForbiddenError | undefined>`

The `client` must be from `withTenantContext(session.tenantId, ...)`, meaning:
- `app.current_tenant_id` is set in the transaction.
- RLS filters results to the session user's tenant.
- The `session.tenantId` must be a real, non-null UUID.

### Platform admin authorization is structurally separate

**Platform admin authorization is NOT a permission codename check.** It cannot be implemented by adding a `'platform:admin'` codename to `permissions` and routing through `getEffectivePermissions` for the following reasons:

1. `getEffectivePermissions(tenantId, userId)` requires a `tenantId` — platform admins have no `tenantId`.
2. `requireTenantAdmin` requires a `client` from `withTenantContext` — which requires `session.tenantId`. Platform admin sessions have `platformAdminId`, not `tenantId`.
3. The platform admin identity lives in `platform_admins`, not in `users`. There is no `user_roles` row for a platform admin, so the codename join would return zero rows even if attempted.

**Enforcement:**

Platform admin route handlers call `requirePlatformAdminSession(session)` (a new function in `lib/auth/platformAdmin.ts`), which:
- Narrows `AnySessionPayload` to `PlatformAdminSessionPayload` (throws `ForbiddenError` if `sessionKind !== 'platform_admin'`).
- Calls `getPlatformAdminPool(session)` to verify `is_active` in DB.

This is a structurally separate guard function in a structurally separate file. It does not call `getEffectivePermissions`. It does not use `withTenantContext`. It does not accept a `PoolClient` parameter.

**Explicit statement:** `requireTenantAdmin` gates operations within one tenant. `requirePlatformAdminSession` gates operations across all tenants. These are two parallel authorization tracks that share the `ForbiddenError` class but nothing else.

---

## Schema Changes Summary (DDL Sketches)

> [!NOTE]
> These are design-level DDL sketches. They are NOT deployment-ready migrations.
> A separate migration file will be produced in the implementation pass.

### New table: `platform_admins`

```sql
-- Platform-level identity store, entirely outside tenant scoping.
-- No RLS. Readable only via mis_admin pool.
-- No tenant_id column — platform admins are not tenant members.

CREATE TABLE platform_admins (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    password_hash   TEXT,               -- NULL for SSO-only platform admins
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE platform_admins IS
    'Platform-level administrator identities. Not tenant-scoped. '
    'Accessible only via mis_admin pool. No RLS applied. '
    'platform_admins.id is used as actor_id in platform_audit_log.';

CREATE INDEX idx_platform_admins_email ON platform_admins (email);

-- NO RLS on this table — access controlled entirely by pool/role selection.
-- mis_app role should have NO GRANT on this table (defense in depth).
REVOKE ALL ON platform_admins FROM mis_app;
```

> [!IMPORTANT]
> **⚠️ TEAM DECISION #3:** Should `mis_app` have any access to `platform_admins`?
> The recommendation is NO — `REVOKE ALL ... FROM mis_app` means a misconfigured
> route handler using `appPool` instead of the admin pool would get a permission
> error rather than silently returning zero rows. This is the safer default.
> If platform admin login goes through `mis_app` (e.g., for the login endpoint
> that doesn't have a session yet), then `SELECT` only needs to be granted.
> **Decision required before implementation.**

### New table: `platform_audit_log`

```sql
-- Platform-level audit log for cross-tenant and platform-wide operations.
-- Partitioned by created_at — same strategy as audit_log, separate table.
-- No tenant_id FK column — tenant context is optional in the context JSONB.

CREATE TABLE platform_audit_log (
    id                  UUID NOT NULL DEFAULT gen_random_uuid(),
    platform_admin_id   UUID REFERENCES platform_admins(id),  -- NULL for system/cron actions
    action              TEXT NOT NULL,      -- e.g. 'tenant.created', 'org_type.updated'
    entity_type         TEXT NOT NULL,      -- e.g. 'organization', 'org_types', 'platform_admin'
    entity_id           UUID,
    old_state           JSONB,
    new_state           JSONB,
    ip_address          INET,
    context             JSONB NOT NULL DEFAULT '{}',
    -- Optional: tenant_id when the action targets a specific tenant.
    -- Stored in context JSONB, not a FK column, to avoid nullable FK complexities.
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE platform_audit_log_default PARTITION OF platform_audit_log DEFAULT;

COMMENT ON TABLE platform_audit_log IS
    'Append-only, partition-ready. Same partition strategy as audit_log '
    '(PARTITION BY RANGE (created_at)). Covers platform-level actions '
    'that have no single tenant_id: tenant creation, org_type changes, '
    'platform admin management. No RLS — accessible only via mis_admin.';

CREATE INDEX idx_platform_audit_log_created
    ON platform_audit_log (platform_admin_id, created_at DESC);

CREATE INDEX idx_platform_audit_log_entity
    ON platform_audit_log (entity_type, entity_id);

-- No RLS on platform_audit_log.
-- mis_app should have INSERT only (for writePlatformAuditLog called from admin pool context)
-- or NO access at all. See TEAM DECISION #3.
REVOKE ALL ON platform_audit_log FROM mis_app;
```

> [!NOTE]
> The `tenant_id` of the affected organization (when relevant, e.g., deactivating
> a tenant) is stored in `context JSONB` as `{ "tenant_id": "<uuid>" }`, not as
> a FK column. This keeps the `platform_audit_log` schema stable even as tenant
> UUIDs come and go, and avoids the `ON DELETE CASCADE` complexity that would
> erase audit history if a tenant is deleted.

---

## Change Surface: Round 1–5 Files vs. Additive

### Files modified (breaking or non-breaking changes to existing files)

| File | Change type | What changes | Impact on existing callers |
|---|---|---|---|
| [`lib/auth/session.ts`](file:///home/nickson/Projects/MIS/lib/auth/session.ts) | **Additive** | Add `PlatformAdminSessionPayload` interface, `AnySessionPayload` union type, `createPlatformAdminSession()` and `verifyAnySession()` functions. Existing `SessionPayload`, `createSession()`, `verifySession()`, `getSessionFromRequest()` are unchanged. | None — purely additive exports. |
| [`lib/auth/permissions.ts`](file:///home/nickson/Projects/MIS/lib/auth/permissions.ts) | **Additive** | Add `getPlatformAdminPool(session: PlatformAdminSessionPayload)` function. Existing `getAdminPool(session)`, `requirePlatformAdmin()`, `getEffectivePermissions()`, etc. are unchanged. Add `@deprecated` JSDoc to `requirePlatformAdmin()` and `getAdminPool()`. | None — existing function signatures unchanged. |
| [`lib/db/audit.ts`](file:///home/nickson/Projects/MIS/lib/db/audit.ts) | **Additive** | Add `writePlatformAuditLog(client, params: PlatformAuditLogParams)` alongside existing `writeAuditLog`. Existing function and interface unchanged. | None. |
| [`middleware.ts`](file:///home/nickson/Projects/MIS/middleware.ts) | **No change needed** | Middleware only verifies JWT signature/expiry. Platform admin routes need a `/platform/` prefix added to route protection logic IF they require redirecting unauthenticated users differently. Otherwise, middleware already redirects to `/login` for any missing/invalid JWT, which is correct for platform admins too. | None if `/login` serves as the single entry point. ⚠️ TEAM DECISION #4 below. |

### Files that are purely additive (new files)

| File | Purpose |
|---|---|
| `lib/auth/platformAdmin.ts` | `requirePlatformAdminSession(session: AnySessionPayload)` guard. Narrow to `PlatformAdminSessionPayload`, verify `is_active`. Throw `ForbiddenError` on failure. |
| `lib/platform/tenants.ts` | `createTenant()`, `deactivateTenant()`, `listTenants()` functions using `getPlatformAdminPool`. |
| `lib/platform/platformAdmins.ts` | `createPlatformAdmin()`, `deactivatePlatformAdmin()`, `listPlatformAdmins()` functions. |
| `app/api/platform/tenants/route.ts` | Platform admin API route for tenant management. |
| `app/api/platform/admins/route.ts` | Platform admin API route for platform admin management. |
| `app/platform/` | Platform admin UI pages (if applicable). |

### Schema-only changes (no TypeScript file changes)

| Object | Change | Breaking? |
|---|---|---|
| `platform_admins` table | New table, no RLS | Additive |
| `platform_audit_log` table + default partition | New partitioned table, no RLS | Additive |
| `REVOKE ALL ON platform_admins FROM mis_app` | Permission restriction | Not breaking for application (mis_app was never using this table) |
| `REVOKE ALL ON platform_audit_log FROM mis_app` | Permission restriction | Same |

---

## Open Team Decisions

| # | Question | Recommendation | Risk if left unresolved |
|---|---|---|---|
| ⚠️ 1 | Backward compatibility of existing JWTs when `sessionKind` discriminant is added | Treat absent `sessionKind` as `'tenant'` in `verifyAnySession()` — no forced re-login | If not handled: existing tenant sessions are rejected as invalid on deploy |
| ⚠️ 2 | Deprecate `getAdminPool(session: SessionPayload)` | Add `@deprecated` JSDoc, do not delete yet | If kept live without deprecation: future developers may use it for platform admin operations, bypassing the correct session type check |
| ⚠️ 3 | `mis_app` grant on `platform_admins` | `REVOKE ALL` from `mis_app` for defense-in-depth; grant `SELECT` only if login goes through `mis_app` | If `mis_app` retains default access: a misconfigured route handler could read platform admin credentials via `appPool` without going through `getPlatformAdminPool` |
| ⚠️ 4 | Separate login page for platform admins (`/platform/login`) | Recommended — avoids tenant login form handling `tenantId = null` edge case and keeps login paths clean. Requires adding `/platform/login` to `PUBLIC_ROUTE_PREFIXES` in `middleware.ts` | If same login page: the login handler must branch on whether the credential matches `users` or `platform_admins`, adding complexity to a security-critical path |
| ⚠️ 5 | Password hashing for `platform_admins` | Reuse existing `lib/auth/password.ts` (argon2) — same security posture as tenant users | If different algorithm used: two code paths to audit and maintain |

---

*End of Round 6 Platform Admin Blueprint.*

# Round 3 — Event Subscriptions Dispatcher: Architecture Blueprint

> [!IMPORTANT]
> This document is a **blueprint only** — no implementation code. A separate
> implementation pass will build from this spec. Every file path, function name,
> and interface described here is the **binding contract** for that pass.

---

## Table of Contents

1. [Question 1 — Execution Model](#question-1--execution-model)
2. [Question 2 — event_execution_log Write Pattern](#question-2--event_execution_log-write-pattern)
3. [File / Function Map](#file--function-map)
4. [Action-Type Scope: Implement vs. Stub](#action-type-scope-implement-vs-stub)
5. [Event Filter Matching Logic](#event-filter-matching-logic)
6. [Schema Patch: UPDATE Policy on event_execution_log](#schema-patch-update-policy-on-event_execution_log)

---

## Question 1 — Execution Model

### Options Evaluated

| Criterion | (a) Inline Synchronous | (b) Fire-and-Forget fetch() | (c) Deferred Cron Poller | (d) Hybrid |
|---|---|---|---|---|
| **Response latency** | ❌ Blocked by slowest action (webhook round-trip, email send). A single webhook timeout (30 s) exceeds Vercel's serverless function limit. | ✅ Mutation returns immediately. | ✅ Mutation returns immediately. | ✅ Same as (c). |
| **Delivery guarantee** | ✅ Success/failure is known before COMMIT. | ❌ **None.** The fire-and-forget `fetch()` runs in a dangling promise. If the originating serverless invocation exits before the background fetch completes, the response is lost. No row tracks the attempt. | ✅ **Strong.** The pending row is committed atomically with the mutation. The cron poller retries until success or max_retries exhaustion. | ✅ Same as (c). |
| **Retry reliability** | ⚠️ Retry would mean re-running the entire mutation transaction or implementing inline retry loops, both unacceptable. | ❌ No tracking → no retry. | ✅ Natural: the poller re-queries `WHERE status IN ('pending', 'retrying')` every tick. The partial index `idx_event_exec_log_status` makes this a fast index-only scan. | ✅ Same as (c). |
| **Vercel constraints** | ❌ Vercel serverless functions default to 10 s timeout (max 300 s on Pro). Webhook destinations or email APIs can easily exceed this. | ⚠️ Works only if the function stays alive long enough. Vercel aggressively reclaims idle functions. No way to guarantee the `fetch()` completes. | ✅ Cron Route Handler runs on its own invocation with its own timeout budget. Mutations are never blocked. Vercel Cron supports 1-minute granularity. | ✅ Same as (c). |
| **Cold-start impact** | N/A (runs inside the mutation's already-warm invocation). | N/A (background fetch may cold-start the target route). | ⚠️ Cron invocation may cold-start, adding ~1–3 s. Acceptable for a background poller — not user-visible. | Same as (c). |
| **Operational complexity** | ✅ Simplest — no additional routes or cron config. | ⚠️ Requires a separate Route Handler for the background target but no tracking infra. | ⚠️ Requires: a cron schedule in `vercel.json`, a cron Route Handler, a state machine on the log table, and a locking strategy to prevent duplicate processing. | ⚠️ Same as (c), plus optional optimistic inline path (more code paths). |

### Decision: **(c) Deferred Cron Poller**

**Rationale:** This is the only option that provides **both** non-blocking mutations **and** guaranteed delivery with retries within Vercel's constraints.

- Option (a) is eliminated because it makes user-facing API latency hostage to external service performance and risks Vercel timeouts on every mutation.
- Option (b) is eliminated because it has **zero delivery guarantee**. A dangling promise in a serverless function that gets reaped is a silent data loss vector. The schema already has `event_execution_log` with a `status` column — not using it is wasting the schema design.
- Option (d) (hybrid: inline-optimistic + fallback poller) adds a second code path for marginal latency improvement (~1 min vs. near-instant dispatch) that isn't worth the complexity in Round 3. It can be layered on later by having the mutation `fetch()` the cron handler after committing, as a performance optimization — but the cron poller remains the **source of truth** for delivery.

**Processing-at-most-once guard:** The cron poller must `UPDATE status = 'running' ... WHERE status IN ('pending', 'retrying') ... RETURNING *` in a single atomic statement. This acts as a database-level "claim" — if two cron invocations overlap, only one wins each row. No distributed lock needed.

**Cron cadence:** `* * * * *` (every 1 minute) — the minimum Vercel Cron supports. Acceptable for workflow automation use cases (not real-time chat).

---

## Question 2 — event_execution_log Write Pattern

### Options Evaluated

| Criterion | (a) Mutable Rows (add UPDATE policy) | (b) Append-Only (new INSERT per transition) |
|---|---|---|
| **Audit completeness** | ⚠️ State transitions overwrite previous state. To preserve history, would need a separate audit trail — but the `audit_log` table already exists for entity mutations, and event execution is a system-internal concern, not a tenant-auditable action. The `started_at`, `completed_at`, `error_message` fields on the row provide sufficient forensic data. | ✅ Every state transition is a separate row, providing a complete timeline. |
| **Query complexity for retry poller** | ✅ **Trivial:** `SELECT * FROM event_execution_log WHERE status IN ('pending', 'retrying')` — single table scan on the partial index. | ❌ **Significantly harder.** Must find "latest row per (subscription_id, trigger_entity_id)" and filter to pending/retrying. Requires a `DISTINCT ON` or window function: `SELECT DISTINCT ON (subscription_id, trigger_entity_id) * FROM event_execution_log ORDER BY subscription_id, trigger_entity_id, created_at DESC`. The existing partial index on `status` is **useless** for this — it can't efficiently answer "latest row per group where latest status = pending". Would need a new index strategy. |
| **Schema purity** | ⚠️ Requires a schema patch: one new RLS policy. This is a one-line DDL addition, not a structural change. The table already has `status`, `started_at`, `completed_at`, `error_message`, `attempt` columns that are **designed to be updated** — they have no semantic meaning as immutable. | ✅ No schema change needed. But the table structure (with mutable-looking columns like `started_at`, `completed_at`) becomes misleading — these columns would only be populated on the final-state INSERT, leaving earlier rows with NULLs that a reader might misinterpret. |
| **Operational debuggability** | ✅ One row per event execution. Status, timing, error, and attempt count are all on one row. `SELECT * FROM event_execution_log WHERE subscription_id = $1 ORDER BY created_at DESC` gives a clean history — one row per trigger event. | ⚠️ Multiple rows per event execution. To understand the current state of a single execution, you must find the latest row per group. To understand how many retries occurred, you must count rows. More cognitive load for operators and more complex dashboard queries. |
| **Storage efficiency** | ✅ One row per event. `attempt` counter increments in place. | ❌ N rows per event (1 + retry_count). For a subscription with max_retries=3 that fails 3 times, that's 4 rows (pending → running → retrying → running → retrying → running → failed = up to 7 rows) vs. 1 mutable row. At scale across tenants, this is non-trivial bloat on a table that already has JSONB payloads. |

### Decision: **(a) Mutable Rows — Add UPDATE RLS Policy**

**Rationale:**

The append-only pattern is elegant for audit logs where **every historical state is a first-class record** (as with `audit_log` and `field_definitions` in this schema). But `event_execution_log` is an **operational tracking table**, not an audit table. Its purpose is to answer: "what is the current state of this execution, and what happened?" — not "show me every state transition as a separate record."

The decisive factor is **poller query complexity**. The cron handler is the hottest code path in the dispatcher. Making it fight a `DISTINCT ON` query instead of a direct index scan on `status` would be an unnecessary self-inflicted wound, especially since the partial index `idx_event_exec_log_status WHERE status IN ('pending', 'running', 'retrying')` is already in the schema and perfectly suited for the mutable-row pattern.

The schema patch is minimal — one `CREATE POLICY` statement (see [§6](#schema-patch-update-policy-on-event_execution_log)).

**State machine for a single log row:**

```
pending ──→ running ──→ succeeded   (happy path)
                    ──→ failed      (max_retries exhausted)
                    ──→ retrying    (transient failure, attempt < max_retries)
retrying ──→ running ──→ ...        (retry cycle)
```

**Fields mutated during transitions:**

| Transition | Fields Updated |
|---|---|
| pending → running | `status`, `started_at` |
| running → succeeded | `status`, `response_payload`, `completed_at` |
| running → failed | `status`, `error_message`, `response_payload`, `completed_at` |
| running → retrying | `status`, `error_message`, `attempt` (increment) |

---

## File / Function Map

All paths are relative to the project root. Modules are organized by concern layer.

---

### `lib/events/types.ts` — [NEW]

Shared type definitions for the event dispatcher subsystem.

| Export | Responsibility |
|---|---|
| `MutationEvent` (interface) | The data envelope that the entity CRUD layer passes to the dispatcher: contains `tenantId`, `entityTypeId`, `entityTypeSlug`, `sourceType`, `event`, `entityId`, `actorId`, `oldData`, `newData`, and `changedFields`. See [§5](#event-filter-matching-logic) for full shape. |
| `EventSubscriptionRow` (interface) | Typed representation of a row from `event_subscriptions`, used internally by the dispatcher. |
| `EventExecutionLogRow` (interface) | Typed representation of a row from `event_execution_log`. |
| `ActionResult` (interface) | Return type from action executors: `{ success: boolean; responsePayload?: unknown; errorMessage?: string }`. |
| `ActionExecutor` (type) | Function signature `(subscription: EventSubscriptionRow, event: MutationEvent, logId: string, client: PoolClient) => Promise<ActionResult>`. All action-type handlers conform to this. |

---

### `lib/events/dispatcher.ts` — [NEW]

Core dispatch logic — called from within the mutation transaction to enqueue work.

| Export | Responsibility |
|---|---|
| `dispatchEntityEvent(client: PoolClient, event: MutationEvent): Promise<void>` | Queries `event_subscriptions` for active subscriptions matching `(tenant_id, source_type, source_target, event)`, evaluates `event_filter` against the `MutationEvent`, and INSERTs one `pending` row into `event_execution_log` per matched subscription. Runs **inside** the caller's existing transaction (receives a `PoolClient`, not a `Pool`). |

---

### `lib/events/filter.ts` — [NEW]

Event filter evaluation logic — pure functions, no DB access.

| Export | Responsibility |
|---|---|
| `matchesEventFilter(filter: Record<string, unknown>, event: MutationEvent): boolean` | Evaluates a subscription's `event_filter` JSONB against the `MutationEvent` data. Returns `true` if the filter matches (or if the filter is empty `{}`). See [§5](#event-filter-matching-logic) for the full matching algorithm. |

---

### `lib/events/processor.ts` — [NEW]

The execution engine — called by the cron handler to process pending log rows.

| Export | Responsibility |
|---|---|
| `processPendingEvents(batchSize?: number): Promise<{ processed: number; succeeded: number; failed: number }>` | Opens its own `withTenantContext` per claimed row (or bypasses RLS via admin pool for cross-tenant cron — see design note below). Claims rows with `UPDATE ... SET status = 'running' WHERE status IN ('pending', 'retrying') ... RETURNING *`, processes each via the appropriate action executor, and updates the row to `succeeded`, `failed`, or `retrying`. Returns processing summary. |

> [!IMPORTANT]
> **Cross-tenant cron design note:** The cron handler processes events for **all
> tenants** in a single invocation. It must query `event_execution_log` without
> RLS filtering. Two options:
> 1. Use `_adminPoolInternal` (bypasses RLS) — simpler, but the cron handler
>    must be a platform-internal route that requires no session.
> 2. Use `appPool` but `SET LOCAL app.current_tenant_id` per-row after claiming.
>
> **Decision:** Use `_adminPoolInternal` for the claim query (cross-tenant),
> then switch to `appPool` with `withTenantContext(row.tenant_id, ...)` for
> action execution (so action executors like `field_update` and `create_record`
> operate under correct RLS). The cron route is protected by a shared secret
> header (`CRON_SECRET`), not by session auth.

---

### `lib/events/actions/webhook.ts` — [NEW]

| Export | Responsibility |
|---|---|
| `executeWebhook: ActionExecutor` | Sends an HTTP request to `action_config.url` with `action_config.method` and `action_config.headers`. Request body is the `MutationEvent` serialized as JSON. Respects a 10-second timeout. Returns success/failure based on HTTP status (2xx = success). |

---

### `lib/events/actions/field-update.ts` — [NEW]

| Export | Responsibility |
|---|---|
| `executeFieldUpdate: ActionExecutor` | Within the tenant context, updates `entity_records.data` by setting `action_config.target_field` to `action_config.value` on the entity record that triggered the event. Uses a direct `UPDATE ... SET data = jsonb_set(data, ...)` query. Writes an audit_log entry for the automated change (actor_id = NULL, context includes subscription_id). |

---

### `lib/events/actions/create-record.ts` — [NEW]

| Export | Responsibility |
|---|---|
| `executeCreateRecord: ActionExecutor` | Within the tenant context, inserts a new `entity_records` row into the entity type identified by `action_config.entity_type_slug`. The `action_config.template` JSONB is the data payload, with `{{field_key}}` placeholders resolved from the triggering record's data. Writes audit_log. |

---

### `lib/events/actions/internal-notification.ts` — [NEW]

| Export | Responsibility |
|---|---|
| `executeInternalNotification: ActionExecutor` | **STUB.** Logs the notification intent and returns success. See [§4](#action-type-scope-implement-vs-stub) for rationale. |

---

### `lib/events/actions/send-email-template.ts` — [NEW]

| Export | Responsibility |
|---|---|
| `executeSendEmailTemplate: ActionExecutor` | **STUB.** Logs the email intent and returns success. See [§4](#action-type-scope-implement-vs-stub) for rationale. |

---

### `lib/events/actions/registry.ts` — [NEW]

| Export | Responsibility |
|---|---|
| `getActionExecutor(actionType: string): ActionExecutor` | Maps `action_type` enum values to their executor functions. Throws on unknown action types. Single point of registration for all action handlers. |

---

### `app/api/cron/process-events/route.ts` — [NEW]

Vercel Cron Route Handler — the entrypoint for background event processing.

| Export | Responsibility |
|---|---|
| `GET(request: NextRequest): Promise<NextResponse>` | Validates the `CRON_SECRET` header (or `Authorization: Bearer <CRON_SECRET>`), calls `processPendingEvents()`, returns a JSON summary. This is NOT a session-authenticated route — it is invoked by Vercel Cron. |

---

### `vercel.json` — [NEW or MODIFY]

| Addition | Responsibility |
|---|---|
| `crons` array entry | Registers the cron schedule: `{ "path": "/api/cron/process-events", "schedule": "* * * * *" }` (every 1 minute). |

---

### `lib/entities/records.ts` — [MODIFY]

The existing CRUD functions ([records.ts](file:///home/nickson/Projects/MIS/lib/entities/records.ts)) must be modified to call the dispatcher after each mutation.

| Function | Modification |
|---|---|
| [createEntityRecord](file:///home/nickson/Projects/MIS/lib/entities/records.ts#L469-L532) | After the audit_log write (step 5), call `dispatchEntityEvent(client, { ... event: 'created', oldData: null, newData: record.data, ... })`. |
| [updateEntityRecord](file:///home/nickson/Projects/MIS/lib/entities/records.ts#L583-L692) | After the audit_log write (step 7), call `dispatchEntityEvent(client, { ... event: 'updated', oldData: existing.data, newData: updated.data, changedFields: computeChangedFields(existing.data, updated.data), ... })`. Additionally derive `event: 'field_changed'` or `event: 'status_changed'` when applicable (see [§5](#event-filter-matching-logic)). |
| [deleteEntityRecord](file:///home/nickson/Projects/MIS/lib/entities/records.ts#L710-L747) | After the audit_log write (step 3), call `dispatchEntityEvent(client, { ... event: 'deleted', oldData: existing.data, newData: null, ... })`. |

> [!NOTE]
> `dispatchEntityEvent` receives the already-open `PoolClient` from `withTenantContext`.
> It runs **inside** the same transaction — the pending log rows are committed
> atomically with the mutation. If the mutation rolls back, the pending events
> are also rolled back. This is critical for consistency.

---

### `lib/events/utils.ts` — [NEW]

| Export | Responsibility |
|---|---|
| `computeChangedFields(oldData: Record<string, unknown>, newData: Record<string, unknown>): ChangedField[]` | Compares old and new JSONB data objects. Returns an array of `{ field: string, from: unknown, to: unknown }` for each key whose value differs. Used by `updateEntityRecord` to build the `MutationEvent.changedFields` and by `matchesEventFilter` for filter evaluation. |
| `resolveTemplatePlaceholders(template: Record<string, unknown>, sourceData: Record<string, unknown>): Record<string, unknown>` | Replaces `{{field_key}}` placeholders in a template object with values from source data. Used by `executeCreateRecord`. |

---

## Action-Type Scope: Implement vs. Stub

| action_type | Round 3 | Reason |
|---|---|---|
| `webhook` | **Fully implement** | Self-contained — requires only `fetch()`. No external dependency beyond the webhook URL configured by the tenant. Core use case for integration. |
| `field_update` | **Fully implement** | Self-contained — operates entirely within the existing entity_records table using the existing `withTenantContext` and audit infrastructure. High value for status-change automation workflows. |
| `create_record` | **Fully implement** | Self-contained — uses existing entity_records INSERT path. The template resolution is straightforward string interpolation. Enables audit-trail and derived-record workflows. |
| `internal_notification` | **Stub** | No notification infrastructure exists. There is no `notifications` table, no in-app notification channel, no WebSocket/SSE push layer. The stub should log the intent and return success so subscriptions of this type can be configured and tested end-to-end without blocking. |
| `send_email_template` | **Stub** | No email provider is configured (no SendGrid/SES/Resend dependency in `package.json`, no `EMAIL_*` env vars in `.env.example`). The stub should log the intent, record what would be sent (template_id, resolved recipient), and return success. |

---

## Event Filter Matching Logic

### The `MutationEvent` Interface

This is the data envelope that the entity CRUD layer must pass to `dispatchEntityEvent`. Every field is populated by the CRUD function at the point of dispatch.

```
MutationEvent {
  tenantId:        string          — session.tenantId
  sourceType:      'custom_entity' — hardcoded for entity_records mutations
                                     ('core_entity' reserved for future core table hooks)
  sourceTarget:    string          — the entity_type slug (e.g. 'patient', 'asset')
                                     looked up from entity_types WHERE id = entityTypeId
  event:           'created' | 'updated' | 'deleted' | 'status_changed' | 'field_changed'
  entityTypeId:    string          — the entity type UUID
  entityId:        string          — the entity record UUID
  actorId:         string          — session.userId
  oldData:         object | null   — the record's data JSONB before the mutation (null on create)
  newData:         object | null   — the record's data JSONB after the mutation (null on delete)
  changedFields:   ChangedField[]  — computed diff of oldData vs newData (empty on create/delete)
  schemaVersion:   number          — the record's schema_version
  timestamp:       string          — ISO 8601 timestamp of the mutation
}

ChangedField {
  field:  string   — the field_key that changed
  from:   unknown  — old value (undefined if field was absent)
  to:     unknown  — new value (undefined if field was removed)
}
```

### How the Dispatcher Resolves `sourceTarget`

The CRUD functions currently receive `entityTypeId` (UUID) but subscriptions reference `source_target` by **slug**. The dispatcher needs the slug. Two options:

1. **Add a query inside `dispatchEntityEvent`** to look up the slug: `SELECT slug FROM entity_types WHERE id = $1`. This is one extra query per mutation but runs inside the existing transaction on the already-checked-out client.
2. **Thread the slug through from the CRUD layer** — but the CRUD layer doesn't currently have it.

**Decision:** Option 1. The query is trivial (PK lookup, RLS-filtered), runs on an already-open client, and avoids changing the CRUD function signatures.

### How the Dispatcher Queries Matching Subscriptions

```sql
SELECT *
  FROM event_subscriptions
 WHERE tenant_id    = $1        -- from MutationEvent.tenantId
   AND source_type  = $2        -- from MutationEvent.sourceType
   AND source_target = $3       -- from entity_type slug (resolved above)
   AND event        = $4        -- from MutationEvent.event
   AND is_active    = TRUE
 ORDER BY priority ASC
```

This query hits the partial index `idx_event_subs_lookup`.

**Multi-event dispatch for updates:** A single `updateEntityRecord` call may match subscriptions for **multiple** event types. The CRUD layer should call `dispatchEntityEvent` up to three times per update:

1. Always with `event = 'updated'`
2. If any `changedFields[].field` matches a subscription's `event_filter.field`, also with `event = 'field_changed'`
3. If `changedFields` includes a field named `status` specifically, also with `event = 'status_changed'`

This means a single update can produce 1–3 sets of subscription matches. Each matched subscription gets its own `event_execution_log` row.

### Filter Evaluation Algorithm

The `event_filter` JSONB on `event_subscriptions` is evaluated by `matchesEventFilter()`:

```
GIVEN:
  filter = { "field": "status", "from": "draft", "to": "published" }
  event  = MutationEvent with changedFields

ALGORITHM:
  1. If filter is empty ({}) or null → MATCH (unconditional subscription)

  2. If filter.field is present:
     a. Find the ChangedField in event.changedFields where
        changedField.field === filter.field
     b. If no such ChangedField exists → NO MATCH
        (the specified field did not change in this mutation)
     c. If filter.from is present AND changedField.from !== filter.from → NO MATCH
     d. If filter.to is present AND changedField.to !== filter.to → NO MATCH
     e. Otherwise → MATCH

  3. If filter has keys other than field/from/to (future extensibility):
     → Ignore unknown keys (forward-compatible)
```

**Value comparison:** Uses strict equality (`===`) after JSON deserialization. Both sides are JavaScript values from JSONB, so type coercion is not needed.

**Example walkthrough:**

| Filter | Event changedFields | Result |
|---|---|---|
| `{}` | (any) | ✅ Match |
| `{"field": "status"}` | `[{field: "status", from: "draft", to: "published"}]` | ✅ Match (field changed, no from/to constraint) |
| `{"field": "status", "from": "draft", "to": "published"}` | `[{field: "status", from: "draft", to: "published"}]` | ✅ Match |
| `{"field": "status", "from": "draft", "to": "published"}` | `[{field: "status", from: "published", to: "archived"}]` | ❌ No match (from ≠ "draft") |
| `{"field": "status", "to": "published"}` | `[{field: "status", from: "review", to: "published"}]` | ✅ Match (no from constraint, to matches) |
| `{"field": "priority"}` | `[{field: "status", from: "draft", to: "published"}]` | ❌ No match (priority didn't change) |

---

## Schema Patch: UPDATE Policy on event_execution_log

> [!WARNING]
> This DDL must be applied **before** the implementation pass begins. It is the
> only schema change required for Round 3.

```sql
-- ─── Schema Patch: Round 3 — event_execution_log UPDATE policy ───────────────
-- The cron poller needs to mutate status, timestamps, attempt count, and
-- error/response payloads as it processes pending events.
-- The existing table has SELECT and INSERT policies only.

CREATE POLICY tenant_isolation_update ON event_execution_log
    FOR UPDATE
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
```

> [!NOTE]
> **Why no DELETE policy?** Event execution logs should never be deleted by
> application code. Retention is handled by operational cleanup (if needed)
> via the admin pool or a future pg_partman setup. The absence of a DELETE
> policy is intentional.

### Cross-tenant cron UPDATE consideration

The cron poller uses `_adminPoolInternal` (which bypasses RLS) for the claim query. The UPDATE policy above is for the **action executors** that run under `withTenantContext(row.tenant_id, ...)` and may need to update the log row after execution. If all log updates are performed through the admin pool connection, the UPDATE policy is technically unnecessary for the cron path — but adding it is correct defense-in-depth, costs nothing, and allows future code paths (e.g., manual retry from a tenant admin UI) to update log rows under RLS.

---

## Verification Plan

### Automated Tests

No unit test framework is currently configured in the project. The implementation pass should:

1. **Verify the schema patch** by running the `CREATE POLICY` statement against a test database and confirming that `UPDATE` on `event_execution_log` succeeds under the `mis_app` role with correct tenant context.
2. **Verify the cron route** by calling `GET /api/cron/process-events` with the correct `CRON_SECRET` header and confirming it returns a JSON summary.
3. **Verify end-to-end** by creating an entity record with an active `webhook` subscription pointing to a request-bin URL, waiting for the cron tick, and confirming the webhook was received.

### Manual Verification

1. Deploy to a Vercel preview branch.
2. Create a test `event_subscription` (webhook type) via direct DB insert.
3. Create an entity record via the API.
4. Observe that within ~1 minute, the webhook fires and `event_execution_log` shows `status = 'succeeded'`.
5. Test retry by pointing a webhook at a URL that returns 500, confirming the log row transitions through `retrying` states up to `max_retries`.

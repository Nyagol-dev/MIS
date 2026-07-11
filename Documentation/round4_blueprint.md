# Round 4 — Reporting Engine Architecture Blueprint

> [!IMPORTANT]
> This document is the binding contract for the Round 4 implementation pass.
> Every decision, file path, and function signature below is authoritative.
> The implementation model must follow this blueprint exactly.

---

## Table of Contents

1. [Resolution Table](#1-resolution-table)
2. [Architectural Decisions — Full Analysis](#2-architectural-decisions--full-analysis)
3. [Dependency Map — New Tables](#3-dependency-map--new-tables)
4. [File / Function Map](#4-file--function-map)
5. [Query Pipeline Diagram](#5-query-pipeline-diagram)
6. [Security Surface Analysis](#6-security-surface-analysis)
7. [Decisions Expensive to Reverse](#7-decisions-expensive-to-reverse)
8. [Explicitly Out of Scope for Round 4](#8-explicitly-out-of-scope-for-round-4)

---

## 1. Resolution Table

| # | Question | Decision | Defense |
|---|---------|----------|---------|
| Q1 | Cross-version aggregation | **(b) Coerce-at-query-time** | Every record participates in every aggregation — no silently missing rows. The LEFT JOIN to `field_definitions` is cheap (tiny table per tenant, <100 rows), and `default_value` from `field_definitions` or NULL provides a deterministic, auditable fallback. This preserves the append-and-retire contract: no record is rewritten, no projection table drifts out of sync, and no cron job needs to maintain a shadow copy. |
| Q2 | Report definition | **(c) Hybrid — parameterizable templates** | Template shapes are code-defined (auditable, testable, no injection surface); tenants parameterize them via a `report_definitions` table (config-not-code, matching the `event_subscriptions` philosophy). Arbitrary tenant-defined queries are an unacceptable injection surface; limiting to template shapes eliminates this risk while still allowing each niche organization to configure reports against their own entity types and fields. |
| Q3 | Query interface | **(c) SQL generation layer** | A `ReportQuery` object is transformed into parameterized SQL by a builder that is internal to the reporting layer — SQL is never exposed to tenants. This maps naturally to Q2's hybrid templates: each template type produces a `ReportQuery`, and the builder translates it. Type safety is enforced at the `ReportQuery` construction boundary; extensibility is achieved by adding new template types, each with a new builder path. Per-report-type functions (option b) would fragment the API surface and couple callers to visualization shapes that belong in the presentation layer. |
| Q4 | Cross-entity-type reporting | **(a) Explicitly out of scope** | Single-entity-type queries only for Round 4. The `reference` field_type exists in `field_definitions`, but safe cross-entity JOINs require a reference resolution layer that validates traversal depth, handles retired reference fields, and manages JOIN fan-out — all of which are substantial. Deferring this prevents incorrect results at scale and keeps Round 4 focused on the single-entity aggregation problem. |
| Q5 | Performance / caching | **(d) Hybrid — live for simple, cached for heavy** | Simple counts and status distributions run live against existing indexes (fast, always fresh). Heavy aggregations (SUM, timeline, cross-field grouping) require a cached result stored in `report_cache`, with a "refresh report" endpoint that recomputes on demand. This avoids Vercel serverless timeout risk on slow queries, respects Neon connection limits (cached reads are fast SELECTs), and integrates with the existing event infrastructure via a new `invalidate_report_cache` action stub that marks cache entries stale on entity mutations. Scheduled cron recomputation is optional and can be layered later. |

---

## 2. Architectural Decisions — Full Analysis

### Q1 — Cross-Version Aggregation Strategy

**Problem**: Records at mixed `schema_version`s. A report requests SUM("amount") but some records predate the "amount" field.

#### Options Evaluated

| Option | Correctness | Performance | Complexity | Append-and-retire fit | Neon/Vercel fit |
|--------|-------------|-------------|------------|----------------------|-----------------|
| **(a) Exclude-on-mismatch** | ❌ Silent data loss — rows vanish from aggregation without warning. Users see "SUM of 50 records" when 200 exist. | ✅ Fast — simple WHERE | ✅ Simple | ✅ No writes | ✅ |
| **(b) Coerce-at-query-time** ✅ | ✅ Every record participates. NULL/default is deterministic. | ✅ LEFT JOIN to `field_definitions` is trivial (<100 rows). JSONB extraction is the bottleneck either way. | ✅ Moderate — one LEFT JOIN | ✅ No writes, no projections | ✅ |
| **(c) Write-time projection** | ✅ Correct at read time | ❌ Doubles write cost, requires backfill for existing records, projection drifts when schema evolves | ❌ High — new column or table, write-path changes in `records.ts` | ❌ Breaks isolation — `records.ts` now has reporting concerns | ⚠️ Write amplification on Neon |
| **(d) Materialized aggregation** | ✅ Correct at compute time, stale between | ✅ Reads are instant | ❌ High — cron job, cache table, invalidation logic | ✅ No writes to entity data | ⚠️ Cron must complete within Vercel timeout |

**Decision: (b) Coerce-at-query-time.**

**How it works**: The query builder LEFT JOINs `field_definitions` to determine whether a requested `field_key` existed under each record's pinned `schema_version`. For records where the field did not exist:
- If `field_definitions.default_value` is defined for that field → use the default.
- Otherwise → treat as NULL.

The coercion expression in the generated SQL:

```
CASE
  WHEN fd.id IS NOT NULL THEN (er.data->>$field_key_param)::target_type
  ELSE fd_default.default_value::target_type  -- NULL if no default
END
```

The LEFT JOIN condition:
```sql
LEFT JOIN field_definitions fd
  ON fd.entity_type_id = er.entity_type_id
 AND fd.field_key = $field_key_param
 AND fd.schema_version <= er.schema_version
 AND fd.retired_at IS NULL
```

> [!NOTE]
> The coercion respects the retirement lifecycle: a field retired at version 3
> still participates in aggregations for records at versions 1–2 (where it was
> active). The `retired_at IS NULL` filter is deliberately **not** applied when
> coercing historical records — the LEFT JOIN checks existence at the record's
> pinned version, not current retirement status. See the builder implementation
> for the exact predicate.

**Correction to the above**: The LEFT JOIN must check whether the field existed at the record's version, regardless of current retirement status. The correct condition for aggregation is:

```sql
LEFT JOIN LATERAL (
  SELECT id, default_value
    FROM field_definitions fd
   WHERE fd.entity_type_id = er.entity_type_id
     AND fd.field_key = $field_key_param
     AND fd.schema_version <= er.schema_version
   ORDER BY fd.schema_version DESC
   LIMIT 1
) fd_match ON TRUE
```

This finds the field_definition row with the highest `schema_version <= record.schema_version` for the requested field_key. If no row exists, the field didn't exist at that version → NULL. If `retired_at IS NOT NULL` on the matched row, the field was retired before or at that version — but the record may still carry data for it (written before retirement), so we still extract `data->>field_key` if present.

---

### Q2 — Report Definition: Code-Defined vs Data-Defined vs Hybrid

#### Options Evaluated

| Option | Flexibility | Security | Complexity | Config-not-code |
|--------|-------------|----------|------------|-----------------|
| **(a) Code-defined only** | ❌ Zero tenant customization. Every report shape needs a release. | ✅ No injection surface | ✅ Simple | ❌ Violates philosophy |
| **(b) Data-defined** | ✅ Maximum flexibility | ❌ Tenant-defined JSONB becomes a query DSL → injection and DOS surface | ❌ Needs a query language, parser, sandbox | ✅ Config-driven |
| **(c) Hybrid — templates** ✅ | ✅ Covers the 90% case — tenants pick template + entity_type + fields | ✅ Templates are code-audited; tenants supply only field_keys and filter values (parameterized) | ✅ Moderate | ✅ Templates are config, parameters are data |

**Decision: (c) Hybrid — parameterizable templates.**

**Template types** (code-defined, enumerated in a CHECK constraint):

| Template slug | Description | Parameters |
|---------------|-------------|------------|
| `count_by_field` | COUNT grouped by a single enum/text field | `group_field`, optional `filters` |
| `sum_by_field` | SUM of a numeric field, optionally grouped | `sum_field`, optional `group_field`, optional `filters` |
| `timeline` | COUNT or SUM bucketed by a date/datetime field | `date_field`, `bucket` (day/week/month), optional `value_field`, optional `filters` |
| `field_distribution` | Value distribution histogram for a single field | `target_field`, optional `filters` |
| `record_list` | Filtered, paginated record listing with field selection | `fields[]`, optional `filters`, `sort_field`, `sort_dir` |

Each template maps to a builder function in the SQL generation layer.

**Storage**: `report_definitions` table (tenant-scoped). Schema in §3.

---

### Q3 — Query Interface Surface

#### Options Evaluated

| Option | Type safety | Security | Extensibility | Q2 fit |
|--------|------------|----------|---------------|--------|
| **(a) Generic `generateReport`** | ⚠️ One big union type | ⚠️ All field_keys flow through one function | ✅ Open | ⚠️ Loose coupling to templates |
| **(b) Per-report-type functions** | ✅ Strong per-function types | ✅ Each function has a constrained input | ❌ Adding a template = adding an export + updating all callers | ❌ Callers must know visualization type |
| **(c) SQL generation layer** ✅ | ✅ Types enforced at `ReportQuery` construction | ✅ All field_keys are parameterized; SQL is never tenant-visible | ✅ New template → new builder path, same executor | ✅ Each template produces a `ReportQuery` |

**Decision: (c) SQL generation layer.**

The public API is a single entry point:

```
executeReport(session, reportDefinitionId) → ReportResult
executeAdHocReport(session, params: AdHocReportParams) → ReportResult
```

Internally:
1. Load `report_definitions` row → extract `template_type` + `parameters`.
2. Template resolver maps `template_type` to a builder function.
3. Builder function validates parameters, constructs a `ReportQuery` (typed internal struct).
4. SQL generator transforms `ReportQuery` into parameterized SQL + bind values.
5. SQL is executed via `withTenantContext`.
6. Result is shaped into a `ReportResult`.

---

### Q4 — Cross-Entity-Type Reporting

**Decision: (a) Explicitly out of scope for Round 4.**

**Rationale**: Cross-entity JOINs on JSONB reference fields (`data->>'ref_field' = target.id`) require:
- A reference resolution layer that validates traversal depth and prevents recursive JOINs.
- Correct handling of retired reference fields (the `constraints.ref_entity_type` may point to a deactivated entity type).
- JOIN fan-out management (a reference field on 100K records joining to another 100K-row table is a performance cliff).
- Permission checks on both entity types (the user must have `read` on both).

None of these are solved problems in the current codebase. Building them into the reporting engine prematurely would create correctness risks and performance cliffs that are difficult to debug. The `reference` field_type and `constraints.ref_entity_type` structure in the schema are sufficient to support a future cross-entity layer — no schema changes are needed.

---

### Q5 — Performance and Caching Strategy

#### Options Evaluated

| Option | Freshness | Timeout risk | Connection load | Complexity | Infra fit |
|--------|-----------|-------------|-----------------|------------|-----------|
| **(a) Index-only** | ✅ Live | ❌ Complex aggregations timeout on Vercel (10s/60s limits) | ❌ Long queries hold connections | ✅ Zero new infra | ⚠️ Scaling trap |
| **(b) Materialized views** | ⚠️ Stale between refreshes | ✅ Fast reads | ✅ Refresh is one query | ❌ Per-(tenant, entity_type) view management, DDL at runtime | ❌ Neon doesn't support concurrent refresh on all plans; DDL from app code is an operational risk |
| **(c) App-layer cache** | ⚠️ Stale until invalidated | ✅ Fast reads | ✅ | ✅ Moderate — one table + event hook | ✅ |
| **(d) Hybrid** ✅ | ✅ Live for simple; cached for heavy | ✅ Heavy queries never run in the request path | ✅ | ✅ Moderate | ✅ Extends existing cron + events |

**Decision: (d) Hybrid.**

**Classification rule** (applied by the template resolver at query time):

| Template | Strategy |
|----------|----------|
| `count_by_field` | **Live** — COUNT + GROUP BY on a single indexed field. The composite GIN index + expression indexes handle this well. |
| `record_list` | **Live** — paginated SELECT with index-backed ORDER BY. |
| `sum_by_field` | **Cached** — SUM over JSONB-extracted numerics requires a full scan within the tenant+type partition. |
| `timeline` | **Cached** — date bucketing + aggregation is a heavy scan. |
| `field_distribution` | **Cached** — full-column scan for value distribution. |

**Cache lifecycle**:
1. **Write**: When `executeReport` runs a cached template, it stores the result in `report_cache` with a TTL.
2. **Read**: Subsequent calls check `report_cache` first. If `computed_at + ttl_seconds > now()` → return cached result.
3. **Invalidation**: Entity mutations dispatch a `'invalidate_report_cache'` action_type via the event_subscriptions system. The executor sets `is_stale = TRUE` on matching `report_cache` rows.
4. **Refresh**: A `refreshReport(session, reportDefinitionId)` endpoint recomputes the report and replaces the cache entry. This can be called on-demand by the user or by a future cron job.

> [!IMPORTANT]
> For Round 4, cache invalidation via `event_subscriptions` is a **stub**:
> the `invalidate_report_cache` action_type is registered in the executor
> registry but the executor itself only marks cache rows stale (it does NOT
> auto-recompute). Auto-recomputation on a schedule is out of scope — see §8.

---

## 3. Dependency Map — New Tables

### 3.1 `report_definitions`

Tenant-scoped table storing parameterized report configurations.

```
report_definitions
├── tenant_id         UUID NOT NULL FK → organizations(id) ON DELETE CASCADE
├── id                UUID NOT NULL DEFAULT gen_random_uuid()
├── name              TEXT NOT NULL
├── description       TEXT NOT NULL DEFAULT ''
├── entity_type_id    UUID NOT NULL  -- FK → entity_types(tenant_id, id)
├── template_type     TEXT NOT NULL CHECK (template_type IN (
│                         'count_by_field', 'sum_by_field', 'timeline',
│                         'field_distribution', 'record_list'
│                     ))
├── parameters        JSONB NOT NULL DEFAULT '{}'
│                     -- Template-specific parameters:
│                     -- count_by_field:     { "group_field": "status", "filters": [...] }
│                     -- sum_by_field:       { "sum_field": "amount", "group_field": "category", "filters": [...] }
│                     -- timeline:           { "date_field": "created_at", "bucket": "month", "value_field": "amount", "filters": [...] }
│                     -- field_distribution: { "target_field": "status", "filters": [...] }
│                     -- record_list:        { "fields": ["name","status"], "filters": [...], "sort_field": "created_at", "sort_dir": "desc" }
├── is_active         BOOLEAN NOT NULL DEFAULT TRUE
├── created_by        UUID
├── created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
├── updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
│
├── PRIMARY KEY (tenant_id, id)
├── FOREIGN KEY (tenant_id, entity_type_id) → entity_types(tenant_id, id) ON DELETE CASCADE
├── UNIQUE (tenant_id, name)
```

| Property | Value |
|----------|-------|
| RLS required | **Yes** — standard four-policy tenant isolation pattern |
| Partition required | **No** — low row volume per tenant (dozens, not millions) |
| Writes owned by | `lib/reporting/definitions.ts` |

**Indexes**:
- PK `(tenant_id, id)` — B-tree (implicit)
- `UNIQUE (tenant_id, name)` — B-tree
- `idx_report_defs_entity_type ON report_definitions (tenant_id, entity_type_id) WHERE is_active = TRUE` — lookup by entity type

---

### 3.2 `report_cache`

Stores precomputed report results for heavy templates.

```
report_cache
├── tenant_id              UUID NOT NULL FK → organizations(id) ON DELETE CASCADE
├── id                     UUID NOT NULL DEFAULT gen_random_uuid()
├── report_definition_id   UUID NOT NULL  -- FK → report_definitions(tenant_id, id)
├── result                 JSONB NOT NULL DEFAULT '{}'
├── row_count              INT NOT NULL DEFAULT 0          -- number of entity_records aggregated
├── computed_at            TIMESTAMPTZ NOT NULL DEFAULT now()
├── ttl_seconds            INT NOT NULL DEFAULT 300        -- 5 minutes default
├── is_stale               BOOLEAN NOT NULL DEFAULT FALSE  -- set TRUE by invalidation
├── computed_by            UUID                            -- user who triggered computation, NULL = system
│
├── PRIMARY KEY (tenant_id, id)
├── FOREIGN KEY (tenant_id, report_definition_id) → report_definitions(tenant_id, id) ON DELETE CASCADE
├── UNIQUE (tenant_id, report_definition_id)       -- one cached result per report definition
```

| Property | Value |
|----------|-------|
| RLS required | **Yes** — standard four-policy tenant isolation pattern |
| Partition required | **No** — at most one row per `report_definition`, low volume |
| Writes owned by | `lib/reporting/cache.ts` |

**Indexes**:
- PK `(tenant_id, id)` — B-tree (implicit)
- `UNIQUE (tenant_id, report_definition_id)` — B-tree (fast cache lookup)
- `idx_report_cache_stale ON report_cache (tenant_id, is_stale) WHERE is_stale = TRUE` — partial index for invalidation sweeps

---

## 4. File / Function Map

All new files live under `lib/reporting/`. No existing files are modified except:
- `lib/events/actions/registry.ts` — add `invalidate_report_cache` executor
- `lib/events/types.ts` — add `'invalidate_report_cache'` to `action_type` union
- `app/api/cron/process-events/route.ts` — no changes needed (generic processor)

### 4.1 New Files

---

#### [types.ts](file:///home/nickson/Projects/MIS/lib/reporting/types.ts) `[NEW]`

**Responsibility**: Shared TypeScript types for the reporting layer.

| Export | Responsibility |
|--------|---------------|
| `ReportTemplateType` | String literal union: `'count_by_field' \| 'sum_by_field' \| 'timeline' \| 'field_distribution' \| 'record_list'` |
| `ReportDefinitionRow` | Typed interface matching `report_definitions` table columns |
| `ReportCacheRow` | Typed interface matching `report_cache` table columns |
| `ReportQuery` | Internal struct representing a fully resolved, parameterized query: `{ sql: string; params: unknown[]; resultShape: ResultShapeDescriptor }` |
| `FilterCondition` | `{ field_key: string; operator: FilterOperator; value: unknown }` |
| `FilterOperator` | `'eq' \| 'neq' \| 'gt' \| 'gte' \| 'lt' \| 'lte' \| 'in' \| 'contains'` |
| `ReportResult` | `{ data: Record<string, unknown>[]; metadata: ReportMetadata }` |
| `ReportMetadata` | `{ report_definition_id: string; template_type: ReportTemplateType; entity_type_id: string; computed_at: string; from_cache: boolean; row_count: number; is_stale: boolean }` |
| `AdHocReportParams` | `{ entity_type_id: string; template_type: ReportTemplateType; parameters: Record<string, unknown> }` |
| `CountByFieldParams` | Typed params for `count_by_field` template |
| `SumByFieldParams` | Typed params for `sum_by_field` template |
| `TimelineParams` | Typed params for `timeline` template |
| `FieldDistributionParams` | Typed params for `field_distribution` template |
| `RecordListParams` | Typed params for `record_list` template |

**Imports**: None (pure types).

---

#### [definitions.ts](file:///home/nickson/Projects/MIS/lib/reporting/definitions.ts) `[NEW]`

**Responsibility**: CRUD for report_definitions table.

| Export | Responsibility |
|--------|---------------|
| `createReportDefinition(session, params)` | Validates template_type + parameters against the template's expected shape, validates that referenced field_keys exist in `field_definitions` for the target entity_type, INSERTs into `report_definitions`. Requires `entity_record:read` permission on the entity type. |
| `updateReportDefinition(session, definitionId, params)` | Updates parameters/name/description. Re-validates field_keys. |
| `deleteReportDefinition(session, definitionId)` | Hard DELETE. Also DELETEs the corresponding `report_cache` row (CASCADE). |
| `getReportDefinition(session, definitionId)` | Returns a single `ReportDefinitionRow` or null. |
| `listReportDefinitions(session, entityTypeId?)` | Returns all active definitions, optionally filtered by entity type. |

**Imports**: `withTenantContext` from `lib/db/withTenant`, `writeAuditLog` from `lib/db/audit`, `requireEntityAccess` pattern from `lib/auth/permissions`, `SessionPayload` from `lib/auth/session`, types from `./types`.

---

#### [field-resolver.ts](file:///home/nickson/Projects/MIS/lib/reporting/field-resolver.ts) `[NEW]`

**Responsibility**: Loads and validates field_definitions for use in report queries. Central point for the cross-version coercion logic.

| Export | Responsibility |
|--------|---------------|
| `resolveFieldForReport(client, entityTypeId, fieldKey)` | Loads the `field_definitions` row(s) for a given field_key across all schema versions. Returns `{ field_key, field_type, default_value, min_version, max_version, is_currently_retired }`. Used by the query builder to determine the correct SQL cast type and coercion default. |
| `validateReportFieldKeys(client, entityTypeId, fieldKeys)` | Batch validation: confirms all requested field_keys exist in `field_definitions` for the given entity type (any version). Returns validation errors for unknown keys. |
| `getFieldSqlType(fieldType)` | Maps `field_definitions.field_type` → Postgres cast target (`TEXT`, `NUMERIC`, `INTEGER`, `BOOLEAN`, `TIMESTAMPTZ`, `JSONB`). Pure function, no DB access. |

**Imports**: `PoolClient` from `pg`, types from `./types`.

---

#### [query-builder.ts](file:///home/nickson/Projects/MIS/lib/reporting/query-builder.ts) `[NEW]`

**Responsibility**: Transforms a `ReportDefinitionRow` (template_type + parameters) into a parameterized `ReportQuery`. This is the SQL generation core. Each template type has a dedicated builder function.

| Export | Responsibility |
|--------|---------------|
| `buildReportQuery(client, definition)` | Dispatcher: reads `definition.template_type`, calls the appropriate template-specific builder, returns a `ReportQuery`. Validates that all referenced field_keys exist via `field-resolver.ts`. |

**Internal (non-exported) functions**:

| Function | Responsibility |
|----------|---------------|
| `buildCountByField(client, entityTypeId, params)` | Generates: `SELECT data->>$1 AS group_key, COUNT(*) AS count FROM entity_records WHERE ... GROUP BY group_key`. Includes the cross-version coercion LEFT JOIN. |
| `buildSumByField(client, entityTypeId, params)` | Generates: `SELECT ... (data->>$1)::NUMERIC AS value, SUM(...) ... GROUP BY ...`. Casts based on `getFieldSqlType`. |
| `buildTimeline(client, entityTypeId, params)` | Generates: `SELECT date_trunc($bucket, (data->>$1)::TIMESTAMPTZ) AS bucket, COUNT(*) or SUM(...) ...`. |
| `buildFieldDistribution(client, entityTypeId, params)` | Generates: `SELECT data->>$1 AS value, COUNT(*) AS count ... GROUP BY value ORDER BY count DESC`. |
| `buildRecordList(client, entityTypeId, params)` | Generates: `SELECT id, data, created_at ... WHERE ... ORDER BY ... LIMIT ... OFFSET ...`. Selects only the requested fields from the JSONB data. |
| `buildFilterClauses(filters, startParamIndex)` | Converts `FilterCondition[]` into SQL WHERE clauses with bind parameters. All field_keys go through `resolveFieldForReport` to get the correct cast. **This is the primary injection mitigation point** — see §6. |

**Imports**: `PoolClient` from `pg`, `resolveFieldForReport`, `validateReportFieldKeys`, `getFieldSqlType` from `./field-resolver`, types from `./types`.

---

#### [executor.ts](file:///home/nickson/Projects/MIS/lib/reporting/executor.ts) `[NEW]`

**Responsibility**: Public API entry points. Orchestrates cache check → query build → SQL execution → result shaping.

| Export | Responsibility |
|--------|---------------|
| `executeReport(session, reportDefinitionId)` | Main entry point for saved reports. Loads the definition, checks permissions, checks cache (for cached templates), builds query if needed, executes via `withTenantContext`, shapes result, writes to cache if applicable. Returns `ReportResult`. |
| `executeAdHocReport(session, params: AdHocReportParams)` | Entry point for unsaved (ad-hoc) reports. Validates params inline (no definition row), builds + executes query, returns `ReportResult`. Does NOT cache. |
| `refreshReport(session, reportDefinitionId)` | Force-recomputes a cached report regardless of TTL. Replaces the `report_cache` row. Returns the fresh `ReportResult`. |

**Imports**: `withTenantContext` from `lib/db/withTenant`, `requireEntityAccess` pattern from `lib/auth/permissions`, `SessionPayload` from `lib/auth/session`, `buildReportQuery` from `./query-builder`, `readCache`, `writeCache` from `./cache`, `getReportDefinition` from `./definitions`, types from `./types`.

---

#### [cache.ts](file:///home/nickson/Projects/MIS/lib/reporting/cache.ts) `[NEW]`

**Responsibility**: Read/write operations on the `report_cache` table.

| Export | Responsibility |
|--------|---------------|
| `readCache(client, reportDefinitionId)` | Returns the cached `ReportCacheRow` if it exists, is not stale, and `computed_at + ttl_seconds > now()`. Returns null otherwise. |
| `writeCache(client, reportDefinitionId, result, rowCount, ttlSeconds, computedBy)` | UPSERT (INSERT ... ON CONFLICT UPDATE) into `report_cache`. |
| `invalidateCacheForEntityType(client, entityTypeId)` | Sets `is_stale = TRUE` on all `report_cache` rows whose `report_definition_id` references the given entity type. Used by the `invalidate_report_cache` event executor. |
| `deleteCacheForDefinition(client, reportDefinitionId)` | Hard DELETE of the cache row. Called when a report definition is deleted. |

**Imports**: `PoolClient` from `pg`, types from `./types`.

---

#### [invalidate-cache.ts](file:///home/nickson/Projects/MIS/lib/events/actions/invalidate-cache.ts) `[NEW]`

**Responsibility**: Event executor for the `invalidate_report_cache` action_type. Registered in the action executor registry.

| Export | Responsibility |
|--------|---------------|
| `executeInvalidateReportCache(subscription, event, logId, client)` | Reads the entity_type_id from the event, calls `invalidateCacheForEntityType(client, entityTypeId)`. Returns `ActionResult` with success status. |

**Imports**: `ActionExecutor`, `ActionResult` from `lib/events/types`, `invalidateCacheForEntityType` from `lib/reporting/cache`.

---

### 4.2 Modified Files

#### [registry.ts](file:///home/nickson/Projects/MIS/lib/events/actions/registry.ts) `[MODIFY]`

**Change**: Add `invalidate_report_cache: executeInvalidateReportCache` to `EXECUTOR_MAP`. Import from `./invalidate-cache`.

#### [types.ts](file:///home/nickson/Projects/MIS/lib/events/types.ts) `[MODIFY]`

**Change**: Add `'invalidate_report_cache'` to the `action_type` union on `EventSubscriptionRow`.

---

### 4.3 New Route Handlers

#### `app/api/reports/route.ts` `[NEW]`

**Responsibility**: Route Handler for report CRUD and execution.

| Method | Path | Responsibility |
|--------|------|---------------|
| `GET` | `/api/reports` | List report definitions (optional `?entity_type_id=` filter). Calls `listReportDefinitions`. |
| `POST` | `/api/reports` | Create a report definition. Calls `createReportDefinition`. |

#### `app/api/reports/[id]/route.ts` `[NEW]`

| Method | Path | Responsibility |
|--------|------|---------------|
| `GET` | `/api/reports/:id` | Get a single report definition. Calls `getReportDefinition`. |
| `PUT` | `/api/reports/:id` | Update a report definition. Calls `updateReportDefinition`. |
| `DELETE` | `/api/reports/:id` | Delete a report definition. Calls `deleteReportDefinition`. |

#### `app/api/reports/[id]/execute/route.ts` `[NEW]`

| Method | Path | Responsibility |
|--------|------|---------------|
| `POST` | `/api/reports/:id/execute` | Execute a saved report. Calls `executeReport`. |

#### `app/api/reports/[id]/refresh/route.ts` `[NEW]`

| Method | Path | Responsibility |
|--------|------|---------------|
| `POST` | `/api/reports/:id/refresh` | Force-refresh a cached report. Calls `refreshReport`. |

#### `app/api/reports/adhoc/route.ts` `[NEW]`

| Method | Path | Responsibility |
|--------|------|---------------|
| `POST` | `/api/reports/adhoc` | Execute an ad-hoc report (not saved). Calls `executeAdHocReport`. |

---

## 5. Query Pipeline Diagram

Trace of a single `POST /api/reports/:id/execute` request:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  1. ROUTE HANDLER  (app/api/reports/[id]/execute/route.ts)                  │
│     ├── Extract session from request (getSessionFromRequest)                │
│     ├── Validate :id param is UUID                                          │
│     └── Call executeReport(session, reportDefinitionId)                     │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼─────────────────────────────────────────┐
│  2. EXECUTOR  (lib/reporting/executor.ts :: executeReport)                  │
│     ├── 2a. Load report_definitions row                                     │
│     │       └── withTenantContext(session.tenantId, ...)                     │
│     │           ├── SET LOCAL app.current_tenant_id = $1  ◄── RLS enforced  │
│     │           └── SELECT * FROM report_definitions WHERE id = $2          │
│     │               └── RLS: tenant_id = current_tenant_id() ◄── isolation  │
│     │                                                                       │
│     ├── 2b. Check entity-type read permission                               │
│     │       └── requireEntityAccess(session, entityTypeId, 'read')          │
│     │           └── getEffectivePermissions → canOnEntityType               │
│     │                                                                       │
│     ├── 2c. Determine query strategy (live vs cached)                       │
│     │       └── TEMPLATE_STRATEGY_MAP[definition.template_type]             │
│     │           ├── If 'cached' → check cache first:                        │
│     │           │     └── readCache(client, reportDefinitionId)              │
│     │           │         ├── Cache HIT (valid + not stale) → return early   │
│     │           │         └── Cache MISS → continue to 2d                   │
│     │           └── If 'live' → continue to 2d                              │
│     │                                                                       │
│     ├── 2d. Build query                                                     │
│     │       └── buildReportQuery(client, definition)                        │
│     │           ├── resolveFieldForReport(client, entityTypeId, fieldKey)    │
│     │           │   └── SELECT ... FROM field_definitions WHERE ...          │
│     │           │       └── RLS: tenant_id = current_tenant_id()            │
│     │           ├── validateReportFieldKeys(client, entityTypeId, keys)     │
│     │           └── Construct ReportQuery { sql, params, resultShape }      │
│     │               └── All field_keys validated against field_definitions  │
│     │               └── All field_keys placed as $N bind params, NEVER      │
│     │                   interpolated into SQL                               │
│     │                                                                       │
│     ├── 2e. Execute query                                                   │
│     │       └── client.query(reportQuery.sql, reportQuery.params)           │
│     │           └── RLS: entity_records filtered by tenant_id automatically │
│     │                                                                       │
│     ├── 2f. Shape result into ReportResult                                  │
│     │                                                                       │
│     ├── 2g. Write to cache (if cached strategy)                             │
│     │       └── writeCache(client, definitionId, result, ...)               │
│     │                                                                       │
│     └── 2h. Return ReportResult to route handler                            │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼─────────────────────────────────────────┐
│  3. ROUTE HANDLER                                                           │
│     └── Return NextResponse.json(result, { status: 200 })                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Key observations**:
- **RLS enforcement**: Steps 2a, 2d, and 2e all run inside `withTenantContext`, which sets `SET LOCAL app.current_tenant_id`. Every SELECT on `report_definitions`, `field_definitions`, and `entity_records` is RLS-filtered.
- **Permission check**: Step 2b uses the same `requireEntityAccess` pattern as `records.ts`. The user needs `read` on the entity type to run a report.
- **Cache check**: Happens inside the same `withTenantContext` transaction (step 2c), so the cache read is also RLS-protected.
- **Field_definitions loading**: Step 2d loads field metadata to validate field_keys and determine SQL types. This is the cross-version coercion point.

> [!NOTE]
> The entire pipeline runs in a **single `withTenantContext` call** — one
> BEGIN/SET LOCAL/COMMIT cycle. This is critical for Neon transaction-pooling
> mode: the RLS context must not leak across connections.

---

## 6. Security Surface Analysis

### 6.1 Injection Points

Every point where a tenant-supplied value touches SQL is listed below.

| # | Tenant-supplied value | Where it enters SQL | Mitigation |
|---|----------------------|--------------------|-----------| 
| S1 | `field_key` (from `report_definitions.parameters`) | `data->>$N` expressions in SELECT/WHERE/GROUP BY | **Allowlist validation**: before the field_key reaches the query builder, `validateReportFieldKeys` confirms it exists in `field_definitions` for the target entity type. Only field_keys that pass validation are used. The field_key is then placed as a **bind parameter** (`$N`) in the `->>` operator: `data->>$1`. PostgreSQL's `->>` operator accepts a text parameter for the key name — it does NOT require string interpolation. |
| S2 | `filter value` (from `parameters.filters[].value`) | `WHERE data->>$N = $M` or `WHERE (data->>$N)::TYPE OP $M` | **Bind parameters**: filter values are always passed as `$N` bind parameters, never interpolated. Type casting is determined by `getFieldSqlType()` using the validated field_type from `field_definitions`, not from tenant input. |
| S3 | `entity_type_id` (from `report_definitions.entity_type_id`) | `WHERE entity_type_id = $N` | **Bind parameter**: UUID passed as `$N`. Additionally validated to exist in `entity_types` by the FK constraint on `report_definitions`. |
| S4 | `entity_type slug` (in route handler URL params) | Not used directly in SQL — `entity_type_id` (UUID) is used instead | **N/A**: slugs are resolved to UUIDs before entering the reporting layer. |
| S5 | `template_type` (from `report_definitions.template_type`) | Determines which builder function runs (switch/map) | **Enumeration**: validated against the `ReportTemplateType` union before use. Invalid values throw before any SQL is generated. Also enforced by the CHECK constraint on the table. |
| S6 | `sort_field` (from `record_list` parameters) | `ORDER BY data->>$N` | **Same as S1**: validated against `field_definitions`, passed as bind parameter. |
| S7 | `bucket` (from `timeline` parameters) | `date_trunc($N, ...)` | **Enumeration**: validated against a hardcoded allowlist `['day', 'week', 'month', 'quarter', 'year']`. Passed as bind parameter to `date_trunc()`. |
| S8 | `sort_dir` (from `record_list` parameters) | `ORDER BY ... ASC/DESC` | **Enumeration**: validated against `['asc', 'desc']`. The literal string `ASC` or `DESC` is appended to SQL — NOT interpolated from user input. The builder maps validated input to the constant string. |
| S9 | `filter operator` (from `parameters.filters[].operator`) | `=`, `!=`, `>`, `>=`, `<`, `<=`, `IN`, `@>` | **Enumeration**: validated against `FilterOperator` union. Each operator maps to a hardcoded SQL operator string. Not interpolated from tenant input. |

### 6.2 JSONB `field_key` — Deep Dive

The `data->>$1` pattern deserves special attention because `field_key` values like `'; DROP TABLE --` could be dangerous if interpolated.

**Mitigation chain**:

1. **Allowlist**: `validateReportFieldKeys` queries `field_definitions` to confirm the field_key exists. A malicious string that isn't a real field_key is rejected before SQL generation.

2. **Bind parameter**: Even if validation were bypassed, the field_key is placed as a PostgreSQL bind parameter (`$N`), not string-concatenated. The query looks like:
   ```sql
   SELECT data->>$1 AS value FROM entity_records WHERE ...
   ```
   PostgreSQL's `->>` operator treats `$1` as a key name within the JSONB document — it cannot break out of the `->>` context via bind parameters.

3. **No dynamic SQL**: The query builder never uses string template literals for field_keys. All SQL is constructed by concatenating known-safe SQL fragments with `$N` placeholders.

### 6.3 Permission Boundary

- **Entity-type access**: Every report execution checks `canOnEntityType(perms, entityTypeId, 'read')`. A user without `read` on the entity type gets HTTP 403, regardless of whether a `report_definitions` row exists.
- **Report definition ownership**: Report definitions are tenant-scoped via RLS. A user in Tenant A cannot see or execute a report defined by Tenant B — the SELECT simply returns zero rows.
- **Cache isolation**: `report_cache` rows are also tenant-scoped and RLS-protected. Cache reads and writes go through `withTenantContext`.

---

## 7. Decisions Expensive to Reverse

### 🔒 1. `report_definitions.template_type` CHECK Constraint Vocabulary

**Why it's hard to reverse**: Once tenants have created report definitions against template types like `count_by_field` or `timeline`, renaming or removing a template type requires a data migration across all tenants' `report_definitions` rows. Adding new template types to the CHECK constraint is non-breaking; removing or renaming is breaking.

**Confidence**: High. The five template types cover the common patterns for management dashboards. New types can be added without affecting existing definitions.

### 🔒 2. `report_definitions.parameters` JSONB Shape Per Template Type

**Why it's hard to reverse**: The `parameters` JSONB shape is implicitly versioned by `template_type`. If the expected shape for (e.g.) `sum_by_field` changes (adding a required key, renaming a key), all existing rows of that template type need migration. The application validates parameters at write time, so a shape change that makes existing parameters invalid would break existing reports.

**Confidence**: Moderate. The parameter shapes are intentionally minimal (2–4 keys per template). Over-engineering the initial parameter set creates unnecessary migration risk. Start minimal, extend by adding optional keys.

### 🔒 3. Single-Tenant-Scoped Cache (One Cache Row Per Report Definition)

**Why it's hard to reverse**: The `UNIQUE (tenant_id, report_definition_id)` constraint enforces one cached result per report. If future requirements need per-user or per-filter-variant caching, this constraint must be dropped and the cache key design rethought — all existing cache rows would need migration or deletion.

**Confidence**: High for Round 4. Per-user caching is unnecessary for management dashboards (the same report shows the same data to all users with read access). Per-filter-variant caching is a future concern that can be addressed by extending the cache key.

### 🟢 4. Coerce-at-Query-Time Strategy (Q1)

**Why it's low-risk to reverse**: This strategy has no persistent state — it's purely a query-time behavior. Switching to write-time projection or materialized views later does not require migrating any data in `report_definitions` or `report_cache`. The reporting layer's SQL generation simply changes.

**Confidence**: High. The coercion logic is isolated in `query-builder.ts` and `field-resolver.ts`.

### 🟢 5. Event-Based Cache Invalidation Stub

**Why it's low-risk to reverse**: The `invalidate_report_cache` executor is a simple UPDATE that sets `is_stale = TRUE`. Removing or replacing it has no impact on existing `event_subscriptions` data (tenants would need to create subscriptions with this action_type, which is a tenant-initiated action). If no subscriptions exist, the executor is never called.

---

## 8. Explicitly Out of Scope for Round 4

The following features are natural extensions of the reporting engine but **must not be built** in Round 4. They are listed here so the implementation pass does not gold-plate.

| Feature | Reason for deferral |
|---------|-------------------|
| **Cross-entity-type reporting** (Q4) | Requires a reference resolution layer, permission checks on multiple entity types, and JOIN fan-out management. See Q4 analysis. |
| **Scheduled/cron-based report recomputation** | The `refreshReport` endpoint handles on-demand refresh. Automatic cron-based refresh is a future optimization that requires a new cron route and tenant-configurable schedules. |
| **Report export (CSV, PDF)** | Presentation-layer concern. The reporting engine returns structured JSON; serialization to file formats belongs in a future export layer. |
| **Report sharing / access control beyond entity-type read** | Currently, anyone with `read` on the entity type can execute any report on it. Fine-grained report-level permissions (e.g., "only managers can see the salary SUM report") are deferred. |
| **Dashboard composition** | Combining multiple report definitions into a single dashboard view is a UI concern. The API returns individual report results; dashboard layout and composition belong in the frontend. |
| **Real-time / websocket report updates** | Push-based updates when underlying data changes. The current model is poll-based (re-execute or refresh). |
| **Custom aggregation functions beyond SUM/COUNT** | AVG, MIN, MAX, MEDIAN, PERCENTILE are natural extensions but add parameter complexity. Add them as new template types in a future round. |
| **Tenant-defined custom template types** | Tenants cannot create new template shapes — only parameterize existing ones. Custom templates require a safe query DSL, which is a major undertaking. |
| **Cross-tenant analytics / platform-level reporting** | Reports that aggregate across tenants (e.g., "total records across all clinics") require the admin pool and bypass RLS. This is a platform-admin feature, not a tenant feature. |
| **Soft-delete support in report queries** | `entity_records` has no `deleted_at` column. If soft-delete is added in a future round, the reporting layer's WHERE clauses must be updated to exclude soft-deleted records. |
| **Report versioning / history** | Tracking changes to report definitions over time (who changed the parameters, when). Currently, only the latest state is stored. |
| **Pagination for aggregation results** | COUNT/SUM/GROUP BY results are returned in full. For entity types with very high cardinality on the grouped field, this could produce large result sets. Pagination of aggregation results is deferred. |

---

*End of Round 4 architecture blueprint.*

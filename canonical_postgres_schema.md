# Multi-Tenant MIS — Canonical PostgreSQL Schema

> [!IMPORTANT]
> This document is the single source of truth for the data layer. Every DDL
> statement is deployment-ready. Rationale sections explain *why*, not *what*.
> Decisions flagged 🔒 are expensive to reverse after data is in production.

---

## Table of Contents

1. [Prerequisites & Conventions](#1-prerequisites--conventions)
2. [Core Schema DDL](#2-core-schema-ddl)
3. [Row-Level Security Policies](#3-row-level-security-policies)
4. [Extension Layer — Soft (JSONB)](#4-extension-layer--soft-jsonb)
5. [Extension Layer — Hard (Schema Registry)](#5-extension-layer--hard-schema-registry)
6. [Workflow Hooks (Event Subscriptions)](#6-workflow-hooks-event-subscriptions)
7. [Indexing Strategy Summary](#7-indexing-strategy-summary)
8. [Architectural Rationale](#8-architectural-rationale)
9. [Decisions Expensive to Reverse](#9-decisions-expensive-to-reverse)

---

## 1. Prerequisites & Conventions

```sql
-- All objects live in the public schema.
-- One shared schema for all tenants (see rationale §8.1).
-- UUIDs everywhere — avoids sequential-ID enumeration and simplifies
-- cross-system data exchange.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "btree_gin";  -- composite GIN indexes

-- Convention: every tenant-scoped table has tenant_id as the FIRST column
-- in its primary key and in every unique constraint. This keeps the
-- physical row layout clustered by tenant when using the default PK index.
```

---

## 2. Core Schema DDL

### 2.0 `org_types` (reference table)

```sql
CREATE TABLE org_types (
    slug            TEXT PRIMARY KEY,
    display_name    TEXT NOT NULL,
    default_settings JSONB NOT NULL DEFAULT '{}'
);

COMMENT ON TABLE org_types IS
    'Runtime-extensible reference table for organization types. '
    'Replaces a CHECK constraint so new org types can be added without DDL.';

-- Seed rows (platform-defined defaults).
INSERT INTO org_types (slug, display_name, default_settings) VALUES
    ('school',       'School', '{}'),
    ('clinic',       'Clinic', '{}'),
    ('ngo',          'NGO', '{}'),
    ('civic_agency', 'Civic Agency', '{}'),
    ('other',        'Other', '{}');
```

### 2.1 `organizations` (tenants)

```sql
CREATE TABLE organizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT NOT NULL UNIQUE,                    -- URL-safe identifier
    display_name    TEXT NOT NULL,
    org_type        TEXT NOT NULL REFERENCES org_types(slug),  -- FK to reference table
    metadata        JSONB NOT NULL DEFAULT '{}',             -- soft-extension point
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE organizations IS
    'Root tenant table. Every row-level-secured table references this.';

CREATE INDEX idx_organizations_org_type ON organizations (org_type);
CREATE INDEX idx_organizations_metadata ON organizations USING GIN (metadata);
```

### 2.2 `users`

```sql
CREATE TABLE users (
    tenant_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id              UUID NOT NULL DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    password_hash   TEXT,                                    -- NULL for SSO-only users
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    metadata        JSONB NOT NULL DEFAULT '{}',             -- soft-extension point
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, email)
);

COMMENT ON COLUMN users.metadata IS
    'Tenant-specific profile fields. See §4 for indexing pattern.';

CREATE INDEX idx_users_email ON users (email);               -- cross-tenant lookup (admin)
CREATE INDEX idx_users_metadata ON users USING GIN (metadata);
```

### 2.3 `roles`

```sql
CREATE TABLE roles (
    tenant_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id              UUID NOT NULL DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    is_system       BOOLEAN NOT NULL DEFAULT FALSE,          -- TRUE = immutable by tenant admins
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, name)
);
```

### 2.4 `permissions` (global atoms)

```sql
-- Permissions are system-defined atoms; the platform team controls this table.
-- Tenants compose these into roles, and may also compose tenant-scoped
-- overrides from tenant_permission_overrides (§2.8).

CREATE TABLE permissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codename        TEXT NOT NULL UNIQUE,                     -- e.g. 'user:write'
    description     TEXT NOT NULL DEFAULT '',
    resource        TEXT NOT NULL,                            -- e.g. 'user', 'entity_record'
    action          TEXT NOT NULL CHECK (action IN (
                        'create', 'read', 'update', 'delete', 'manage'
                    )),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE permissions IS
    'Global permission atoms. Not tenant-scoped — shared across all tenants. '
    'Tenants can extend (not replace) this set via tenant_permission_overrides.';

CREATE UNIQUE INDEX idx_permissions_resource_action ON permissions (resource, action);
```

### 2.5 `role_permissions` (join table)

```sql
-- A role can reference EITHER a global permission OR a tenant-scoped override.
-- Exactly one of (permission_id, override_id) must be non-NULL.

CREATE TABLE role_permissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    role_id         UUID NOT NULL,
    permission_id   UUID REFERENCES permissions(id) ON DELETE CASCADE,
    override_id     UUID,                                     -- FK added after §2.8 table creation

    FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id) ON DELETE CASCADE,

    CONSTRAINT exactly_one_permission_source CHECK (
        (permission_id IS NOT NULL AND override_id IS NULL) OR
        (permission_id IS NULL     AND override_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX idx_role_permissions_global
    ON role_permissions (tenant_id, role_id, permission_id)
    WHERE permission_id IS NOT NULL;

CREATE UNIQUE INDEX idx_role_permissions_override
    ON role_permissions (tenant_id, role_id, override_id)
    WHERE override_id IS NOT NULL;

COMMENT ON TABLE role_permissions IS
    'Links roles to either global permissions or tenant-scoped overrides. '
    'The XOR constraint ensures each row references exactly one source.';
```

### 2.6 `user_roles` (join table)

```sql
CREATE TABLE user_roles (
    tenant_id       UUID NOT NULL,
    user_id         UUID NOT NULL,
    role_id         UUID NOT NULL,
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    assigned_by     UUID,                                    -- NULL = system-assigned

    PRIMARY KEY (tenant_id, user_id, role_id),
    FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id)   ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id)   ON DELETE CASCADE
);
```

### 2.7 `audit_log`

```sql
-- 🔒 PARTITION KEY LOCKED: (created_at)
-- Child partitions are NOT created here — defer to pg_partman or a
-- scheduled job when row volume justifies it.  The PARTITION BY clause
-- is declared now so the table is born partition-ready; adding it later
-- requires a full table rewrite.

CREATE TABLE audit_log (
    id              UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    actor_id        UUID,                                    -- NULL = system action
    action          TEXT NOT NULL,                            -- 'user.created', 'entity.updated', …
    entity_type     TEXT NOT NULL,                            -- table name or custom entity type
    entity_id       UUID,                                    -- NULL for batch/system events
    old_state       JSONB,                                   -- snapshot before mutation (nullable)
    new_state       JSONB,                                   -- snapshot after mutation  (nullable)
    ip_address      INET,
    context         JSONB NOT NULL DEFAULT '{}',              -- request-id, session info, etc.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Create a default partition to catch all rows until range partitions
-- are provisioned.  This prevents INSERT failures.
CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;

COMMENT ON TABLE audit_log IS
    'Append-only, partition-ready. The default partition absorbs all rows '
    'until range partitions (e.g. monthly) are created by pg_partman or a '
    'scheduled job. Partition key: (created_at).';

CREATE INDEX idx_audit_log_tenant_created
    ON audit_log (tenant_id, created_at DESC);

CREATE INDEX idx_audit_log_entity
    ON audit_log (tenant_id, entity_type, entity_id);
```

### 2.8 `tenant_permission_overrides`

```sql
-- Additive tenant-scoped permission atoms.  These extend — never replace —
-- the global permissions table.  A tenant that manages custom entity types
-- (e.g. "patient", "asset") can define fine-grained permissions for them
-- here, then compose those overrides into roles via role_permissions.

CREATE TABLE tenant_permission_overrides (
    tenant_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id              UUID NOT NULL DEFAULT gen_random_uuid(),
    codename        TEXT NOT NULL,                            -- e.g. 'patient:approve'
    description     TEXT NOT NULL DEFAULT '',
    resource        TEXT NOT NULL,                            -- custom entity_type slug or resource name
    action          TEXT NOT NULL,                            -- unconstrained — tenants define the vocabulary
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, codename)
);

COMMENT ON TABLE tenant_permission_overrides IS
    'Additive permission atoms scoped to a single tenant. These are composed '
    'into roles exactly like global permissions, via role_permissions.override_id. '
    'The platform never reads this table for its own authorization checks — only '
    'tenant-defined workflows and custom entity access control use these.';

-- Complete the FK from role_permissions now that the table exists.
ALTER TABLE role_permissions
    ADD CONSTRAINT fk_role_permissions_override
    FOREIGN KEY (tenant_id, override_id)
    REFERENCES tenant_permission_overrides(tenant_id, id)
    ON DELETE CASCADE;

CREATE INDEX idx_tpo_resource ON tenant_permission_overrides (tenant_id, resource);

ALTER TABLE tenant_permission_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_permission_overrides FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON tenant_permission_overrides
    FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_insert ON tenant_permission_overrides
    FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_update ON tenant_permission_overrides
    FOR UPDATE USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_delete ON tenant_permission_overrides
    FOR DELETE USING (tenant_id = current_tenant_id());
```

---

## 3. Row-Level Security Policies

```sql
-- ---------------------------------------------------------------
-- Tenant-isolation pattern: every connection sets a session var
--   SET app.current_tenant_id = '<uuid>';
-- RLS policies read this var via current_setting().
-- ---------------------------------------------------------------

-- Helper: immutable function for use inside policies.
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID
LANGUAGE sql STABLE
AS $$
    SELECT current_setting('app.current_tenant_id', TRUE)::UUID;
$$;


-- === Enable RLS on all tenant-scoped tables ===

ALTER TABLE users                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_permission_overrides ENABLE ROW LEVEL SECURITY;


-- === Example policies (users table — same pattern for all others) ===

-- Tenant members see only their own tenant's rows.
CREATE POLICY tenant_isolation_select ON users
    FOR SELECT
    USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation_insert ON users
    FOR INSERT
    WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation_update ON users
    FOR UPDATE
    USING  (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation_delete ON users
    FOR DELETE
    USING (tenant_id = current_tenant_id());


-- === Super-admin bypass ===
-- A separate Postgres role (e.g. 'mis_admin') owns the tables and is
-- NOT subject to RLS (table owners bypass RLS by default).  The
-- application role ('mis_app') has RLS enforced.

-- Ensure the application role cannot bypass RLS:
ALTER TABLE users FORCE ROW LEVEL SECURITY;
-- Repeat FORCE for every tenant-scoped table.

ALTER TABLE roles                       FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions            FORCE ROW LEVEL SECURITY;
ALTER TABLE user_roles                  FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log                   FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_permission_overrides FORCE ROW LEVEL SECURITY;
```

> [!NOTE]
> Apply the identical four-policy pattern (`tenant_isolation_select`,
> `_insert`, `_update`, `_delete`) to **every tenant-scoped table**
> defined below in the extension layer. The policies are identical; only
> the table name changes.

---

## 4. Extension Layer — Soft (JSONB)

The `metadata JSONB` column on `organizations`, `users`, and `roles`
is the first-class extension point. Here is the documented pattern for
graduating a JSONB key to a query-hot column.

### 4.1 Pattern: Expression Index on a Hot JSONB Key

```sql
-- Scenario: a school tenant stores `metadata->>'student_id'` on every
-- user and wants fast equality lookups.

-- Step 1: Create an expression index (zero DDL change to the table).
CREATE INDEX idx_users_metadata_student_id
    ON users ( (metadata->>'student_id') )
    WHERE metadata ? 'student_id';

-- Step 2 (optional escalation): If the key is used in JOINs or needs
-- type safety, promote it to a GENERATED column.
ALTER TABLE users
    ADD COLUMN student_id TEXT
    GENERATED ALWAYS AS (metadata->>'student_id') STORED;

-- The generated column is physically stored, inherits the GIN index
-- coverage, and can be independently indexed with a plain B-tree:
CREATE INDEX idx_users_student_id ON users (tenant_id, student_id);
```

> [!TIP]
> **When to use each tier:**
>
> | Tier | Use when… | Migration needed? |
> |---|---|---|
> | Raw `metadata->>` query | Rare / ad-hoc queries | No |
> | Expression index | Frequent filtering, no JOINs | No (DDL on index only) |
> | Generated column + B-tree | JOINs, aggregations, type enforcement | Yes (non-breaking `ADD COLUMN`) |

### 4.2 Validation Responsibility

JSONB metadata is **validated at the application layer** (JSON Schema
or equivalent). Postgres `CHECK` constraints on JSONB are possible but
become unmanageable across tenants with different shapes. The
field_definitions registry (§5) stores the canonical schema for
validation.

---

## 5. Extension Layer — Hard (Schema Registry)

This is the mechanism that allows tenants to define **entirely new entity
types** at runtime, without any core migration.

### 5.1 `entity_types`

```sql
CREATE TABLE entity_types (
    tenant_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id              UUID NOT NULL DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,                            -- e.g. 'patient', 'asset'
    slug            TEXT NOT NULL,                            -- URL-safe: 'patient'
    description     TEXT NOT NULL DEFAULT '',
    current_version INT  NOT NULL DEFAULT 1,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, slug)
);

ALTER TABLE entity_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_types FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON entity_types
    FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_insert ON entity_types
    FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_update ON entity_types
    FOR UPDATE USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_delete ON entity_types
    FOR DELETE USING (tenant_id = current_tenant_id());
```

### 5.2 `field_definitions`

```sql
CREATE TABLE field_definitions (
    tenant_id       UUID NOT NULL,
    entity_type_id  UUID NOT NULL,
    id              UUID NOT NULL DEFAULT gen_random_uuid(),
    schema_version  INT  NOT NULL DEFAULT 1,                 -- version this field belongs to
    field_key       TEXT NOT NULL,                            -- stable machine name
    display_name    TEXT NOT NULL,
    field_type      TEXT NOT NULL CHECK (field_type IN (
                        'text', 'integer', 'decimal', 'boolean',
                        'date', 'datetime', 'enum', 'json',
                        'reference', 'file'
                    )),
    is_required     BOOLEAN NOT NULL DEFAULT FALSE,
    is_indexed      BOOLEAN NOT NULL DEFAULT FALSE,          -- app layer creates expression indexes
    sort_order      INT NOT NULL DEFAULT 0,
    default_value   JSONB,                                   -- type-matched default
    constraints     JSONB NOT NULL DEFAULT '{}',              -- min, max, pattern, enum_values, ref_entity_type, etc.
    retired_at      TIMESTAMPTZ,                             -- soft-delete; NULL = active
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, entity_type_id)
        REFERENCES entity_types(tenant_id, id) ON DELETE CASCADE,
    UNIQUE (tenant_id, entity_type_id, schema_version, field_key)
);

COMMENT ON COLUMN field_definitions.schema_version IS
    'Ties each field to the entity_type version that introduced it. '
    'Historical entity_records reference the version they were written against, '
    'so old records remain valid even after schema edits.';

ALTER TABLE field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_definitions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON field_definitions
    FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_insert ON field_definitions
    FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_update ON field_definitions
    FOR UPDATE USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_delete ON field_definitions
    FOR DELETE USING (tenant_id = current_tenant_id());

CREATE INDEX idx_field_defs_entity_version
    ON field_definitions (tenant_id, entity_type_id, schema_version);
```

### 5.3 `entity_records`

```sql
CREATE TABLE entity_records (
    tenant_id       UUID NOT NULL,
    entity_type_id  UUID NOT NULL,
    id              UUID NOT NULL DEFAULT gen_random_uuid(),
    schema_version  INT  NOT NULL,                           -- version of the schema at write time
    data            JSONB NOT NULL DEFAULT '{}',              -- field_key → value
    created_by      UUID,
    updated_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, entity_type_id)
        REFERENCES entity_types(tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE entity_records IS
    'Stores instances of tenant-defined entity types. '
    'The data column holds values keyed by field_key from field_definitions. '
    'schema_version pins the record to the field set it was created under.';

COMMENT ON COLUMN entity_records.schema_version IS
    'Immutable after INSERT. When a tenant modifies their entity schema, '
    'entity_types.current_version is incremented and new field_definitions rows '
    'are added. Existing records keep their original schema_version, so they '
    'can always be validated against the field_definitions that were active '
    'when they were created.';

-- Primary query path: list records of a given type within a tenant.
CREATE INDEX idx_entity_records_type
    ON entity_records (tenant_id, entity_type_id, created_at DESC);

-- Full JSONB search within a tenant's records.
CREATE INDEX idx_entity_records_data
    ON entity_records USING GIN (data);

-- Composite GIN for queries that filter on tenant + type + JSONB key simultaneously.
CREATE INDEX idx_entity_records_composite
    ON entity_records USING GIN (tenant_id, entity_type_id, data)
    WITH (fastupdate = off);

ALTER TABLE entity_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_records FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON entity_records
    FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_insert ON entity_records
    FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_update ON entity_records
    FOR UPDATE USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_delete ON entity_records
    FOR DELETE USING (tenant_id = current_tenant_id());
```

### 5.4 Schema Versioning — Lifecycle

```
 Tenant creates entity type "Patient"
     → entity_types row: current_version = 1
     → field_definitions rows: schema_version = 1
     → entity_records: schema_version = 1

 Tenant adds a new field "blood_type"
     → entity_types.current_version → 2
     → new field_definitions row: schema_version = 2, field_key = 'blood_type'
     → old field_definitions rows remain at schema_version = 1
     → new entity_records written with schema_version = 2
     → old entity_records keep schema_version = 1 (still valid against v1 fields)

 Tenant retires field "middle_name"
     → field_definitions.retired_at = now() on that row
     → entity_types.current_version → 3
     → new records no longer include "middle_name"
     → old records that have "middle_name" remain valid (v1 or v2 schema)
```

> [!IMPORTANT]
> Field definitions are **append-and-retire**, never mutated in place.
> This is the key invariant that makes historical records always valid.

### 5.5 `role_entity_type_permissions`

```sql
CREATE TABLE role_entity_type_permissions (
    tenant_id       UUID NOT NULL,
    role_id         UUID NOT NULL,
    entity_type_id  UUID NOT NULL,
    action          TEXT NOT NULL CHECK (action IN (
                        'create', 'read', 'update', 'delete', 'manage'
                    )),

    PRIMARY KEY (tenant_id, role_id, entity_type_id, action),
    FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, entity_type_id) REFERENCES entity_types(tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE role_entity_type_permissions IS
    'Layers fine-grained custom-entity access on top of the existing global entity_record permission atom.';

ALTER TABLE role_entity_type_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_entity_type_permissions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON role_entity_type_permissions
    FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_insert ON role_entity_type_permissions
    FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_update ON role_entity_type_permissions
    FOR UPDATE USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_delete ON role_entity_type_permissions
    FOR DELETE USING (tenant_id = current_tenant_id());
```

---

## 6. Workflow Hooks (Event Subscriptions)

```sql
CREATE TABLE event_subscriptions (
    tenant_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id              UUID NOT NULL DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',

    -- What triggers this hook
    source_type     TEXT NOT NULL CHECK (source_type IN (
                        'core_entity', 'custom_entity'
                    )),
    source_target   TEXT NOT NULL,                            -- table name or entity_type slug
    event           TEXT NOT NULL CHECK (event IN (
                        'created', 'updated', 'deleted',
                        'status_changed', 'field_changed'
                    )),
    event_filter    JSONB NOT NULL DEFAULT '{}',              -- e.g. {"field": "status", "from": "draft", "to": "published"}

    -- What happens
    action_type     TEXT NOT NULL CHECK (action_type IN (
                        'webhook', 'internal_notification',
                        'field_update', 'create_record',
                        'send_email_template'
                    )),
    action_config   JSONB NOT NULL DEFAULT '{}',              -- type-specific payload
    -- webhook:              {"url": "...", "method": "POST", "headers": {...}, "retry_count": 3}
    -- internal_notification: {"channel": "in_app", "template_id": "..."}
    -- field_update:          {"target_field": "status", "value": "approved"}
    -- create_record:         {"entity_type_slug": "audit_entry", "template": {...}}
    -- send_email_template:   {"template_id": "...", "recipient_field": "email"}

    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    priority        INT NOT NULL DEFAULT 100,                 -- lower = fires first
    max_retries     INT NOT NULL DEFAULT 3,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, name)
);

COMMENT ON TABLE event_subscriptions IS
    'Declarative workflow hooks. The application''s event dispatcher reads '
    'active subscriptions matching an event and executes actions sequentially '
    'by priority. No tenant-supplied code is executed — only config-driven '
    'action types are supported.';

CREATE INDEX idx_event_subs_lookup
    ON event_subscriptions (tenant_id, source_type, source_target, event)
    WHERE is_active = TRUE;

ALTER TABLE event_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_subscriptions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON event_subscriptions
    FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_insert ON event_subscriptions
    FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_update ON event_subscriptions
    FOR UPDATE USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_delete ON event_subscriptions
    FOR DELETE USING (tenant_id = current_tenant_id());
```

### 6.1 Event Execution Log

```sql
CREATE TABLE event_execution_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL,
    trigger_event   TEXT NOT NULL,
    trigger_entity_type TEXT NOT NULL,
    trigger_entity_id   UUID,
    status          TEXT NOT NULL CHECK (status IN (
                        'pending', 'running', 'succeeded', 'failed', 'retrying'
                    )) DEFAULT 'pending',
    attempt         INT NOT NULL DEFAULT 1,
    request_payload JSONB,
    response_payload JSONB,
    error_message   TEXT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE event_execution_log IS
    'Append-only execution trace for event_subscriptions. '
    'Enables debugging, retry tracking, and audit of automated actions.';

CREATE INDEX idx_event_exec_log_sub
    ON event_execution_log (tenant_id, subscription_id, created_at DESC);

CREATE INDEX idx_event_exec_log_status
    ON event_execution_log (status)
    WHERE status IN ('pending', 'running', 'retrying');

ALTER TABLE event_execution_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_execution_log FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON event_execution_log
    FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_insert ON event_execution_log
    FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
```

---

## 7. Indexing Strategy Summary

| Table | Index | Type | Purpose |
|---|---|---|---|
| `org_types` | PK `(slug)` | B-tree | Reference table lookups |
| `organizations` | `idx_organizations_org_type` | B-tree | Filter tenants by type (FK) |
| `organizations` | `idx_organizations_metadata` | GIN | Ad-hoc metadata queries |
| `users` | PK `(tenant_id, id)` | B-tree | Tenant-first clustering |
| `users` | `(tenant_id, email)` UNIQUE | B-tree | Login lookup within tenant |
| `users` | `idx_users_email` | B-tree | Cross-tenant admin lookup |
| `users` | `idx_users_metadata` | GIN | Tenant-specific field queries |
| `tenant_permission_overrides` | PK `(tenant_id, id)` + UNIQUE `(tenant_id, codename)` | B-tree | Override lookup |
| `tenant_permission_overrides` | `idx_tpo_resource` | B-tree | Filter overrides by resource |
| `field_definitions` | `idx_field_defs_entity_version` | B-tree | Schema resolution |
| `entity_records` | `idx_entity_records_type` | B-tree | List records by type, newest first |
| `entity_records` | `idx_entity_records_data` | GIN | Full JSONB search |
| `entity_records` | `idx_entity_records_composite` | GIN (btree_gin) | Combined tenant + type + data filter |
| `role_entity_type_permissions` | PK `(tenant_id, role_id, entity_type_id, action)` | B-tree | Fine-grained access lookup |
| `audit_log` | `idx_audit_log_tenant_created` | B-tree | Timeline view per tenant |
| `audit_log` | `idx_audit_log_entity` | B-tree | Entity history lookup |
| `event_subscriptions` | `idx_event_subs_lookup` | B-tree (partial) | Dispatcher hot path |
| `event_execution_log` | `idx_event_exec_log_sub` | B-tree | Subscription execution history |
| `event_execution_log` | `idx_event_exec_log_status` | B-tree (partial) | Retry queue polling |

> [!TIP]
> **Dynamic expression indexes**: When a tenant marks a field_definition
> as `is_indexed = TRUE`, the application should create an expression
> index:
> ```sql
> CREATE INDEX CONCURRENTLY idx_er_<tenant_slug>_<field_key>
>     ON entity_records ( (data->>'{field_key}') )
>     WHERE tenant_id = '{tenant_id}' AND entity_type_id = '{entity_type_id}';
> ```
> The `WHERE` clause scopes the index to a single tenant+type, keeping it
> small and fast to maintain. `CONCURRENTLY` avoids locking production.

---

## 8. Architectural Rationale

### 8.1 Shared Schema vs. Schema-per-Tenant

| Approach | Pros | Cons |
|---|---|---|
| **Shared schema (chosen)** | Single migration path, simple connection pooling, uniform monitoring, RLS handles isolation | Noisy-neighbor risk on large tables, tenant data co-located |
| Schema-per-tenant | Hard physical isolation, per-tenant backup/restore | Migration fan-out, connection-pool explosion, `search_path` juggling, `pg_dump` per tenant |
| Database-per-tenant | Strongest isolation | Operational nightmare at scale, no cross-tenant queries for platform analytics |

**Decision**: Shared schema with RLS. The MIS serves structurally *different*
organizations, but the structural differences are handled by the extension
layer, not by forking the physical schema. Shared schema keeps the
operational surface area minimal and lets us use a single connection pool.

Noisy-neighbor risk is mitigated by:
- `tenant_id`-leading composite indexes (Postgres can skip-scan by tenant).
- `audit_log` is declared with `PARTITION BY RANGE (created_at)` from day one
  (partition key locked in), with a default partition absorbing all rows until
  monthly/quarterly children are provisioned.

### 8.1.1 Partition Key Choice for `audit_log`

| Candidate key | Pros | Cons |
|---|---|---|
| `created_at` (chosen) | Natural retention boundary, time-range pruning for dashboards/reports, simple pg_partman setup | Cross-tenant queries within a partition still scan all tenants (mitigated by `tenant_id`-leading indexes) |
| `tenant_id` | Perfect per-tenant isolation, per-tenant backup | Unbounded partition count as tenants grow, no time-based pruning |
| `(tenant_id, created_at)` | Best of both | Sub-partitioning complexity, operational overhead |

**Decision**: For `audit_log`, partition by `created_at` only. The `tenant_id`-leading
B-tree indexes handle tenant isolation at the index level; partitioning
handles retention and bulk-scan performance at the storage level.
Sub-partitioning by `tenant_id` can be added later to individual
partitions if a single partition becomes too large.
Note: If `entity_records` requires partitioning later due to noisy neighbors, it should use `PARTITION BY HASH (tenant_id)`.

### 8.2 JSONB Metadata vs. EAV

| Approach | Pros | Cons |
|---|---|---|
| **JSONB columns (chosen)** | Single read per entity, GIN-indexable, expression indexes for hot keys, native Postgres operators | No foreign-key enforcement on nested values, schema drift if validation is lax |
| EAV (Entity-Attribute-Value) | Explicit rows per attribute, easier to enforce per-attribute constraints | JOIN explosion for reads, poor query-plan performance, pagination is painful |

**Decision**: JSONB for soft extensions on core tables, plus the
`field_definitions` / `entity_records` registry for hard extensions.

The registry is *technically* an EAV at the storage level (the `data`
column stores all fields in one JSONB blob), but it avoids the classic
EAV pitfalls because:
1. A record's data is a **single JSONB document**, not N rows — so reads
   are O(1) not O(fields).
2. Schema metadata lives in `field_definitions`, not baked into each
   value row.
3. GIN indexes on `data` give us key-existence and containment queries
   without JOINs.

### 8.3 Where Validation Sits

| Layer | Responsibility |
|---|---|
| **Postgres** | Referential integrity (FKs), tenant isolation (RLS), type enforcement on core columns (`CHECK`), uniqueness constraints |
| **Application** | JSONB shape validation against `field_definitions`, business rules (e.g., "a clinic user must have a license_number"), `enum` value validation from `field_definitions.constraints` |

**Reasoning**: Putting JSONB validation in the database (e.g., via `CHECK`
constraints with `jsonb_typeof`) creates an M×N explosion — M tenants ×
N entity types — and makes migrations untenable. The database enforces
*structural* invariants (this column is not null, this FK exists); the
application enforces *semantic* invariants (this JSONB field matches the
tenant's current schema version).

### 8.4 Schema Versioning Strategy

Append-and-retire was chosen over in-place mutation because:
1. **Historical validity**: A record written under schema v2 can always
   be fully validated by loading v2's field_definitions — no guesswork.
2. **No backfill required**: When a tenant adds or retires a field, zero
   existing records need to be touched.
3. **Audit friendliness**: The audit_log can store `schema_version` in
   its `context` and an auditor can reconstruct the schema that was active
   at the time of any change.

Trade-off: read-time schema resolution requires a join to
`field_definitions WHERE schema_version <= record.schema_version`. This
is acceptable because the field_definitions table is small per tenant
(typically <100 rows) and heavily cached.

### 8.5 Event Subscriptions — Config, Not Code

Tenant-defined reactions are stored as **declarative configuration**
(`action_type` + `action_config`) rather than arbitrary code (lambdas,
scripts) because:
1. **Security**: No tenant-supplied code runs inside the database or
   application process.
2. **Auditability**: Every possible action type is enumerable and
   testable by the platform team.
3. **Versioning**: Adding a new `action_type` is a platform release, not
   a tenant migration.

The `event_filter` JSONB allows conditional firing (e.g., "only when
status changes from X to Y") without introducing a DSL or expression
evaluator.

---

## 9. Decisions Expensive to Reverse

> [!CAUTION]
> The following decisions are **structurally load-bearing** once data is
> in production. Reversing any of them requires a data migration across
> all tenants.

### 🔒 1. UUID Primary Keys Everywhere

**Why it's hard to reverse**: Every FK, every index, every audit_log
entry, and every external system integration stores UUIDs. Migrating to
BIGINT later requires rewriting every table and all downstream consumers.

**Confidence**: High. UUIDs avoid enumeration attacks, simplify
distributed ID generation, and make cross-system data imports idempotent.

### 🔒 2. `tenant_id` as Leading Column in Composite Primary Keys

**Why it's hard to reverse**: The physical row ordering on disk (via the
PK's B-tree) clusters rows by tenant. Changing this to `(id)` or `(id,
tenant_id)` later requires a full table rewrite and invalidates every
composite FK.

**Confidence**: High. This is the standard pattern for shared-schema
multi-tenancy and is essential for RLS performance (index scan by
tenant_id is always a prefix scan). Note: `audit_log` is a deliberate
exception, using `(id, created_at)` to optimize for time-range partitioning.

### 🔒 3. Shared Schema (vs. Schema-per-Tenant)

**Why it's hard to reverse**: Moving to schema-per-tenant after shared-
schema launch means splitting every table's data by tenant_id, creating
N schemas, rewriting every query to use `search_path`, and redesigning
the connection pool. Effectively a rewrite.

**Confidence**: High for up to ~1,000 tenants. Re-evaluate if a single
tenant accounts for >30% of total row volume, at which point physical
partitioning by tenant_id on hot tables is a better lever.

### 🔒 4. JSONB `data` Column for Entity Records (vs. Separate Columns per Field)

**Why it's hard to reverse**: Migrating from a single JSONB column to
dynamically-generated columns means `ALTER TABLE ADD COLUMN` for every
field_definition, backfilling every record, and changing every read/write
path. Doable but painful.

**Confidence**: High. Dynamic columns defeat the purpose of the schema
registry pattern. JSONB is the right trade-off for tenant-defined schemas.

### 🔒 5. Append-and-Retire Schema Versioning (Never Mutate field_definitions)

**Why it's hard to reverse**: If you allow in-place mutation of
field_definitions, you lose the ability to validate historical records.
Switching from append-and-retire to mutable-in-place requires either
discarding historical validation or backfilling a version log — both are
complex.

**Confidence**: High. This is a strict improvement over mutable schemas
and the storage overhead (extra rows in field_definitions) is negligible.

### 🟢 6. Permissions: Global Atoms + Additive Tenant Overrides + Custom Entity Access

**Design**: The global `permissions` table remains the platform-owned
permission vocabulary. The `tenant_permission_overrides` table (§2.8)
lets tenants define *additional* permission atoms scoped to their own
custom entity types, without touching the global table. `role_entity_type_permissions`
(§5.5) layers fine-grained access directly on custom entities. `role_permissions`
accepts either source via an XOR constraint.

**Why this is low-risk**: The override and custom-entity tables are purely additive — they
cannot shadow or replace global permissions. Removing them later only requires dropping the
`tenant_permission_overrides` and `role_entity_type_permissions` tables, and the `override_id`
column on `role_permissions`. No global permission data is affected.

**Confidence**: High. This satisfies the requirement for tenant-defined
permissions on custom entity types without compromising the integrity of
the platform-defined permission set.

### 🔒 7. Partition Key on `audit_log`

**Why it's hard to reverse**: `PARTITION BY` is part of the `CREATE TABLE`
statement. Changing the partition key later requires creating a new
partitioned table with the new key, copying all data, and swapping names.
For multi-billion-row tables this is a multi-hour operation with downtime.

**Confidence**: High. For `audit_log`, `created_at` is the natural retention and pruning
axis. The `tenant_id`-leading indexes handle tenant isolation at the
index level independently of the partition key. Note: If `entity_records` requires partitioning later, it should use `PARTITION BY HASH (tenant_id)`.

---

*End of schema design document.*

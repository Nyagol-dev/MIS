-- Migration: Round 6 Platform Admin Layer
--
-- This migration is purely additive-only relative to the Round 1-5 schema.
-- It implements:
-- 1. platform_admins table: A platform-level identity store outside tenant scoping.
-- 2. platform_audit_log table: A platform-level audit log partitioned by created_at.
--
-- No RLS policies are added to either table, as access control is handled
-- entirely via database pool/role selection. Access is explicitly revoked
-- for the mis_app role.

-- === 1. platform_admins ===
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

-- Access control: REVOKE access from mis_app role for defense-in-depth
REVOKE ALL ON platform_admins FROM mis_app;


-- === 2. platform_audit_log ===
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

-- Access control: REVOKE access from mis_app role on both the parent and default partition
REVOKE ALL ON platform_audit_log FROM mis_app;
REVOKE ALL ON platform_audit_log_default FROM mis_app;

-- Migration: Round 4 Reporting Tables
-- Creates report_definitions and report_cache tables with RLS and indexes.

-- === 1. report_definitions ===
CREATE TABLE report_definitions (
    tenant_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id              UUID NOT NULL DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    entity_type_id  UUID NOT NULL,
    template_type   TEXT NOT NULL CHECK (template_type IN (
                        'count_by_field', 'sum_by_field', 'timeline',
                        'field_distribution', 'record_list'
                    )),
    parameters      JSONB NOT NULL DEFAULT '{}',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, entity_type_id) REFERENCES entity_types(tenant_id, id) ON DELETE CASCADE,
    UNIQUE (tenant_id, name)
);

CREATE INDEX idx_report_defs_entity_type 
    ON report_definitions (tenant_id, entity_type_id) 
    WHERE is_active = TRUE;

-- Enable and force RLS
ALTER TABLE report_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_definitions FORCE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY tenant_isolation_select ON report_definitions
    FOR SELECT USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation_insert ON report_definitions
    FOR INSERT WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation_update ON report_definitions
    FOR UPDATE USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation_delete ON report_definitions
    FOR DELETE USING (tenant_id = current_tenant_id());


-- === 2. report_cache ===
CREATE TABLE report_cache (
    tenant_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id                     UUID NOT NULL DEFAULT gen_random_uuid(),
    report_definition_id   UUID NOT NULL,
    result                 JSONB NOT NULL DEFAULT '{}',
    row_count              INT NOT NULL DEFAULT 0,
    computed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    ttl_seconds            INT NOT NULL DEFAULT 300,
    is_stale               BOOLEAN NOT NULL DEFAULT FALSE,
    computed_by            UUID,

    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, report_definition_id) REFERENCES report_definitions(tenant_id, id) ON DELETE CASCADE,
    UNIQUE (tenant_id, report_definition_id)
);

CREATE INDEX idx_report_cache_stale 
    ON report_cache (tenant_id, is_stale) 
    WHERE is_stale = TRUE;

-- Enable and force RLS
ALTER TABLE report_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_cache FORCE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY tenant_isolation_select ON report_cache
    FOR SELECT USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation_insert ON report_cache
    FOR INSERT WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation_update ON report_cache
    FOR UPDATE USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation_delete ON report_cache
    FOR DELETE USING (tenant_id = current_tenant_id());

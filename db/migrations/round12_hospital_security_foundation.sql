-- Round 12: repair tenant RLS and establish the first single-hospital
-- configuration/security primitives. Additive and safe for an existing DB.

-- RLS was forced on these tables in the base schema but policies were omitted.
DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['roles', 'role_permissions', 'user_roles', 'audit_log'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = table_name AND policyname = 'tenant_isolation_select') THEN
      EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (tenant_id = current_tenant_id())', table_name);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = table_name AND policyname = 'tenant_isolation_insert') THEN
      EXECUTE format('CREATE POLICY tenant_isolation_insert ON %I FOR INSERT WITH CHECK (tenant_id = current_tenant_id())', table_name);
    END IF;
    IF table_name <> 'audit_log' THEN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = table_name AND policyname = 'tenant_isolation_update') THEN
        EXECUTE format('CREATE POLICY tenant_isolation_update ON %I FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', table_name);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = table_name AND policyname = 'tenant_isolation_delete') THEN
        EXECUTE format('CREATE POLICY tenant_isolation_delete ON %I FOR DELETE USING (tenant_id = current_tenant_id())', table_name);
      END IF;
    END IF;
  END LOOP;
END
$$;

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS previous_hash BYTEA;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS row_hash BYTEA;

-- Audit chains are serialized per tenant inside the writer's transaction.
-- Hash input is deterministic JSONB text and includes every audited field.
CREATE OR REPLACE FUNCTION public.audit_log_chain_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  last_hash BYTEA;
  canonical_payload TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text, 874139));

  SELECT row_hash INTO last_hash
    FROM public.audit_log
   WHERE tenant_id = NEW.tenant_id
     AND row_hash IS NOT NULL
   ORDER BY created_at DESC, id DESC
   LIMIT 1;

  NEW.previous_hash := last_hash;
  canonical_payload := jsonb_build_object(
    'id', NEW.id,
    'tenant_id', NEW.tenant_id,
    'actor_id', NEW.actor_id,
    'action', NEW.action,
    'entity_type', NEW.entity_type,
    'entity_id', NEW.entity_id,
    'old_state', NEW.old_state,
    'new_state', NEW.new_state,
    'ip_address', NEW.ip_address,
    'context', NEW.context,
    'created_at', NEW.created_at,
    'previous_hash', encode(NEW.previous_hash, 'hex')
  )::text;
  NEW.row_hash := digest(coalesce(NEW.previous_hash, ''::bytea) || convert_to(canonical_payload, 'UTF8'), 'sha256');
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.reject_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = '55000';
END
$$;

DROP TRIGGER IF EXISTS audit_log_chain_insert ON audit_log;
CREATE TRIGGER audit_log_chain_insert
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_chain_insert();

DROP TRIGGER IF EXISTS audit_log_reject_update_delete ON audit_log;
CREATE TRIGGER audit_log_reject_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION public.reject_audit_log_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON audit_log, audit_log_default FROM mis_app;
GRANT SELECT, INSERT ON audit_log, audit_log_default TO mis_app;
REVOKE ALL ON FUNCTION public.audit_log_chain_insert() FROM PUBLIC;

-- Hospital profile is one row per tenant. It contains operational identifiers
-- only; secrets are stored by reference in the credential service.
CREATE TABLE IF NOT EXISTS hospital_settings (
  tenant_id UUID PRIMARY KEY REFERENCES organizations(id),
  facility_id TEXT,
  keph_level SMALLINT CHECK (keph_level IN (4, 5, 6)),
  facility_ownership TEXT CHECK (facility_ownership IN ('public', 'private', 'faith_based')),
  kmpdc_licence_reference TEXT,
  locale TEXT NOT NULL DEFAULT 'en-KE',
  time_zone TEXT NOT NULL DEFAULT 'Africa/Nairobi',
  currency CHAR(3) NOT NULL DEFAULT 'KES',
  uses_24_hour_clock BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departments (
  tenant_id UUID NOT NULL REFERENCES organizations(id),
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  parent_id UUID,
  name TEXT NOT NULL,
  department_type TEXT NOT NULL CHECK (department_type IN ('clinical', 'clinical_support', 'administrative')),
  head_user_id UUID,
  deputy_head_user_id UUID,
  location TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, name),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES departments(tenant_id, id),
  FOREIGN KEY (tenant_id, head_user_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, deputy_head_user_id) REFERENCES users(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS department_members (
  tenant_id UUID NOT NULL,
  department_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role_id UUID,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  PRIMARY KEY (tenant_id, department_id, user_id),
  FOREIGN KEY (tenant_id, department_id) REFERENCES departments(tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS hospital_modules (
  tenant_id UUID NOT NULL REFERENCES organizations(id),
  module_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  enabled_at TIMESTAMPTZ,
  enabled_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, module_key),
  FOREIGN KEY (tenant_id, enabled_by) REFERENCES users(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS user_sessions (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idle_expires_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_address INET,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_active
  ON user_sessions (tenant_id, user_id, idle_expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS user_mfa_credentials (
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  secret_ciphertext BYTEA,
  encryption_key_version SMALLINT,
  enabled_at TIMESTAMPTZ,
  recovery_code_hashes TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id)
);

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'hospital_settings', 'departments', 'department_members',
    'hospital_modules', 'user_sessions', 'user_mfa_credentials'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (tenant_id = current_tenant_id())', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation_insert ON %I FOR INSERT WITH CHECK (tenant_id = current_tenant_id())', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation_update ON %I FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation_delete ON %I FOR DELETE USING (tenant_id = current_tenant_id())', table_name);
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE ON hospital_settings, departments, department_members,
  hospital_modules, user_sessions, user_mfa_credentials TO mis_app;

-- A deployment may add the hospital-specific org type without removing legacy
-- reference rows; tenant creation remains a separately controlled operation.
INSERT INTO org_types (slug, display_name, default_settings)
VALUES ('hospital', 'Hospital', '{"locale":"en-KE","timeZone":"Africa/Nairobi","currency":"KES"}')
ON CONFLICT (slug) DO NOTHING;

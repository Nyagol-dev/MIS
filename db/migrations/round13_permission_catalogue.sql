-- Round 13: Permission catalogue, scoped RBAC, care-team and break-glass foundation.
-- Additive and safe for an existing DB. Requires round12 to be applied first.

-- ─── 1. Add scope column to role_permissions ─────────────────────────────────
-- Scope controls how wide a permission grant reaches:
--   own       → only the user's own resources
--   assigned  → resources assigned to the user (care-team relationship)
--   department → resources within the user's department(s)
--   hospital   → all resources in the hospital
ALTER TABLE role_permissions
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'hospital'
  CHECK (scope IN ('own', 'assigned', 'department', 'hospital'));

COMMENT ON COLUMN role_permissions.scope IS
  'Scope of the permission grant. Narrower scopes restrict access to own/assigned/department resources. '
  'Default is "hospital" for backward compatibility with pre-scope role assignments.';

-- ─── 2. Extend the permissions CHECK constraint for hospital actions ─────────
-- The existing CHECK only allows create/read/update/delete/manage.
-- Extended actions (verify, submit, approve, dispense, administer) are mapped
-- to 'manage' in the DB but distinguished by codename in the application layer.
-- No schema change needed — the codename already carries the full semantics.

-- ─── 3. Add staff metadata columns to users ──────────────────────────────────
-- Professional licence tracking for clinical staff (§4.2)
ALTER TABLE users ADD COLUMN IF NOT EXISTS licence_number TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS licence_type TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS licence_expiry DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS national_id_hash TEXT;

COMMENT ON COLUMN users.licence_number IS
  'Professional licence number (KMPDC, NCK, PPB, etc.)';
COMMENT ON COLUMN users.licence_type IS
  'Licence type code (e.g., KMPDC, NCK, PPB, KNHTL)';
COMMENT ON COLUMN users.licence_expiry IS
  'Licence expiry date for automated alerts';
COMMENT ON COLUMN users.national_id_hash IS
  'HMAC blind index of national ID for lookup without storing plaintext';

-- ─── 4. Add MFA enforcement flag ────────────────────────────────────────────
-- Whether MFA is required for login with this role's permissions.
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN users.auth_version IS
  'Incremented on password change, MFA reset, or role change. JWTs issued before '
  'this version are invalid, providing server-side session revocation.';

-- ─── 5. Care team assignments (§4.1 Layer 3) ────────────────────────────────
-- Links a staff member to a patient via an encounter, appointment, order, or
-- referral. The authz module checks this to allow clinical record access.
CREATE TABLE IF NOT EXISTS care_team_assignments (
  tenant_id       UUID NOT NULL,
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  patient_id      UUID NOT NULL,
  user_id         UUID NOT NULL,
  department_id   UUID,
  encounter_id    UUID,
  role            TEXT NOT NULL DEFAULT 'member',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by     UUID,
  ended_at        TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, department_id) REFERENCES departments(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_care_team_patient
  ON care_team_assignments (tenant_id, patient_id, is_active)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_care_team_user
  ON care_team_assignments (tenant_id, user_id, is_active)
  WHERE is_active = TRUE;

-- RLS for care_team_assignments
ALTER TABLE care_team_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_team_assignments FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'care_team_assignments' AND policyname = 'tenant_isolation_select') THEN
    CREATE POLICY tenant_isolation_select ON care_team_assignments FOR SELECT USING (tenant_id = current_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'care_team_assignments' AND policyname = 'tenant_isolation_insert') THEN
    CREATE POLICY tenant_isolation_insert ON care_team_assignments FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'care_team_assignments' AND policyname = 'tenant_isolation_update') THEN
    CREATE POLICY tenant_isolation_update ON care_team_assignments FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'care_team_assignments' AND policyname = 'tenant_isolation_delete') THEN
    CREATE POLICY tenant_isolation_delete ON care_team_assignments FOR DELETE USING (tenant_id = current_tenant_id());
  END IF;
END $$;

-- ─── 6. Break-glass grants (§4.5) ───────────────────────────────────────────
-- Emergency access to patient records without a care-team relationship.
CREATE TABLE IF NOT EXISTS break_glass_grants (
  tenant_id       UUID NOT NULL,
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  patient_id      UUID NOT NULL,
  reason_code     TEXT NOT NULL,
  reason_text     TEXT NOT NULL DEFAULT '',
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  reviewed_by     UUID,
  reviewed_at     TIMESTAMPTZ,
  review_outcome  TEXT CHECK (review_outcome IN ('justified', 'unjustified', 'pending')),
  review_notes    TEXT,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, reviewed_by) REFERENCES users(tenant_id, id)
);

COMMENT ON TABLE break_glass_grants IS
  'Emergency access grants for patient records outside a care-team relationship. '
  'Each grant is time-limited and must be reviewed by a Clinical Director or DPO.';

CREATE INDEX IF NOT EXISTS idx_break_glass_active
  ON break_glass_grants (tenant_id, user_id, patient_id, is_active)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_break_glass_review
  ON break_glass_grants (tenant_id, review_outcome)
  WHERE review_outcome = 'pending' OR review_outcome IS NULL;

-- RLS for break_glass_grants
ALTER TABLE break_glass_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE break_glass_grants FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'break_glass_grants' AND policyname = 'tenant_isolation_select') THEN
    CREATE POLICY tenant_isolation_select ON break_glass_grants FOR SELECT USING (tenant_id = current_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'break_glass_grants' AND policyname = 'tenant_isolation_insert') THEN
    CREATE POLICY tenant_isolation_insert ON break_glass_grants FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'break_glass_grants' AND policyname = 'tenant_isolation_update') THEN
    CREATE POLICY tenant_isolation_update ON break_glass_grants FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;
-- No DELETE policy — break-glass grants must never be deleted.

-- ─── 7. Access review queue (§4.5) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS access_reviews (
  tenant_id       UUID NOT NULL,
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  break_glass_id  UUID,
  review_type     TEXT NOT NULL CHECK (review_type IN ('break_glass', 'anomaly', 'vip_access', 'after_hours')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'resolved')),
  assigned_to     UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  resolution_notes TEXT,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, break_glass_id) REFERENCES break_glass_grants(tenant_id, id),
  FOREIGN KEY (tenant_id, assigned_to) REFERENCES users(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_access_reviews_pending
  ON access_reviews (tenant_id, status)
  WHERE status IN ('pending', 'in_progress');

-- RLS for access_reviews
ALTER TABLE access_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_reviews FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'access_reviews' AND policyname = 'tenant_isolation_select') THEN
    CREATE POLICY tenant_isolation_select ON access_reviews FOR SELECT USING (tenant_id = current_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'access_reviews' AND policyname = 'tenant_isolation_insert') THEN
    CREATE POLICY tenant_isolation_insert ON access_reviews FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'access_reviews' AND policyname = 'tenant_isolation_update') THEN
    CREATE POLICY tenant_isolation_update ON access_reviews FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

-- ─── 8. Grants ──────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON care_team_assignments TO mis_app;
GRANT SELECT, INSERT, UPDATE ON break_glass_grants TO mis_app;
GRANT SELECT, INSERT, UPDATE ON access_reviews TO mis_app;

-- Round 14: Phase 2 - Patient registration, appointments, triage, OPD.

CREATE TABLE IF NOT EXISTS patients (
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  dob DATE NOT NULL,
  gender TEXT NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS patient_identifiers (
  tenant_id UUID NOT NULL,
  patient_id UUID NOT NULL,
  identifier_type TEXT NOT NULL CHECK (identifier_type IN ('national_id', 'birth_cert', 'passport', 'alien_id', 'sha_number', 'cr_id')),
  identifier_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, patient_id, identifier_type),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS patient_contacts (
  tenant_id UUID NOT NULL,
  patient_id UUID NOT NULL,
  phone TEXT,
  address TEXT,
  next_of_kin_name TEXT,
  next_of_kin_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, patient_id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS patient_consents (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL,
  purpose TEXT NOT NULL,
  method TEXT NOT NULL,
  witness TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS encounters (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL,
  department_id UUID NOT NULL,
  encounter_type TEXT NOT NULL DEFAULT 'outpatient',
  status TEXT NOT NULL CHECK (status IN ('planned', 'arrived', 'triaged', 'in_progress', 'discharged', 'cancelled')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_by UUID,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, department_id) REFERENCES departments(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS triage_records (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL,
  temperature DECIMAL(4, 1),
  blood_pressure TEXT,
  heart_rate INT,
  respiratory_rate INT,
  oxygen_saturation DECIMAL(5, 2),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES encounters(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS clinical_notes (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL,
  patient_id UUID NOT NULL,
  author_id UUID NOT NULL,
  note_type TEXT NOT NULL,
  content TEXT NOT NULL,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  parent_note_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES encounters(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, author_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, parent_note_id) REFERENCES clinical_notes(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS diagnoses (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL,
  patient_id UUID NOT NULL,
  icd11_code TEXT NOT NULL,
  icd11_title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('provisional', 'confirmed')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES encounters(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS allergies (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL,
  allergen TEXT NOT NULL,
  reaction TEXT,
  severity TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'resolved')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id)
);

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'patients', 'patient_identifiers', 'patient_contacts', 'patient_consents',
    'encounters', 'triage_records', 'clinical_notes', 'diagnoses', 'allergies'
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

GRANT SELECT, INSERT, UPDATE, DELETE ON patients, patient_identifiers, patient_contacts, patient_consents, encounters, triage_records, clinical_notes, diagnoses, allergies TO mis_app;

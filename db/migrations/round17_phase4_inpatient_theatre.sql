-- Round 17: Phase 4 - Inpatient and Theatre

CREATE TABLE IF NOT EXISTS wards (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  department_id UUID,
  capacity INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, department_id) REFERENCES departments(tenant_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS beds (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  ward_id UUID NOT NULL,
  bed_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'cleaning', 'maintenance')),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, ward_id) REFERENCES wards(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admissions (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL,
  encounter_id UUID NOT NULL,
  admitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  admitted_by UUID NOT NULL,
  discharged_at TIMESTAMPTZ,
  discharged_by UUID,
  discharge_reason TEXT,
  status TEXT NOT NULL DEFAULT 'admitted' CHECK (status IN ('admitted', 'transferred', 'discharged', 'deceased')),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES encounters(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, admitted_by) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, discharged_by) REFERENCES users(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS bed_assignments (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  admission_id UUID NOT NULL,
  bed_id UUID NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID NOT NULL,
  released_at TIMESTAMPTZ,
  released_by UUID,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, admission_id) REFERENCES admissions(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, bed_id) REFERENCES beds(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, assigned_by) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, released_by) REFERENCES users(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS nursing_notes (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  admission_id UUID NOT NULL,
  note_text TEXT NOT NULL,
  author_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, admission_id) REFERENCES admissions(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, author_id) REFERENCES users(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS mar_entries (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  admission_id UUID NOT NULL,
  drug_code TEXT NOT NULL,
  dose TEXT NOT NULL,
  route TEXT NOT NULL,
  administered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  administered_by UUID NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'administered' CHECK (status IN ('administered', 'omitted')),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, admission_id) REFERENCES admissions(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, administered_by) REFERENCES users(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS theatre_cases (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL,
  encounter_id UUID NOT NULL,
  procedure_code TEXT NOT NULL,
  procedure_name TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  surgeon_id UUID NOT NULL,
  anaesthetist_id UUID,
  notes TEXT,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES encounters(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, surgeon_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, anaesthetist_id) REFERENCES users(tenant_id, id)
);

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'wards', 'beds', 'admissions', 'bed_assignments',
    'nursing_notes', 'mar_entries', 'theatre_cases'
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

GRANT SELECT, INSERT, UPDATE, DELETE ON wards, beds, admissions, bed_assignments, nursing_notes, mar_entries, theatre_cases TO mis_app;

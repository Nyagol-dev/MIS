-- Round 15: Add indexes for Patient Dashboard widgets

CREATE INDEX IF NOT EXISTS idx_encounters_patient_started 
ON encounters(tenant_id, patient_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_clinical_notes_patient_created 
ON clinical_notes(tenant_id, patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_triage_encounter 
ON triage_records(tenant_id, encounter_id);

CREATE INDEX IF NOT EXISTS idx_diagnoses_patient_created
ON diagnoses(tenant_id, patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_allergies_patient
ON allergies(tenant_id, patient_id);

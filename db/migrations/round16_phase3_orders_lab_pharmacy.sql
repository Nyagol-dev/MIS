-- Round 16: Phase 3 - Orders, Laboratory, Radiology, Pharmacy

CREATE TABLE IF NOT EXISTS orders (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL,
  encounter_id UUID NOT NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('lab', 'radiology', 'prescription', 'procedure', 'referral')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'requested', 'in_progress', 'completed', 'cancelled')),
  ordered_by UUID NOT NULL,
  ordered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES encounters(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, ordered_by) REFERENCES users(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS order_items (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  item_code TEXT NOT NULL,
  item_name TEXT NOT NULL,
  quantity INT DEFAULT 1,
  notes TEXT,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lab_samples (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  sample_type TEXT NOT NULL,
  collected_by UUID,
  collected_at TIMESTAMPTZ,
  accession_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'collected', 'received', 'processed', 'rejected')),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, collected_by) REFERENCES users(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS lab_results (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  sample_id UUID NOT NULL,
  test_code TEXT NOT NULL,
  test_name TEXT NOT NULL,
  result_value TEXT NOT NULL,
  reference_range TEXT,
  units TEXT,
  is_critical BOOLEAN NOT NULL DEFAULT FALSE,
  verified_by UUID,
  verified_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, sample_id) REFERENCES lab_samples(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, verified_by) REFERENCES users(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS imaging_reports (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  report_text TEXT NOT NULL,
  dicom_study_uid TEXT,
  reported_by UUID NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, reported_by) REFERENCES users(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS stock_batches (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  batch_number TEXT NOT NULL,
  expiry_date DATE NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS dispenses (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  patient_id UUID NOT NULL,
  dispensed_by UUID NOT NULL,
  dispensed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, dispensed_by) REFERENCES users(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS controlled_drug_register (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  dispense_id UUID NOT NULL,
  drug_code TEXT NOT NULL,
  quantity INT NOT NULL,
  balance_before INT NOT NULL,
  balance_after INT NOT NULL,
  recorded_by UUID NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  witness_id UUID,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, dispense_id) REFERENCES dispenses(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, witness_id) REFERENCES users(tenant_id, id)
);

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'orders', 'order_items', 'lab_samples', 'lab_results',
    'imaging_reports', 'stock_batches', 'dispenses', 'controlled_drug_register'
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

GRANT SELECT, INSERT, UPDATE, DELETE ON orders, order_items, lab_samples, lab_results, imaging_reports, stock_batches, dispenses, controlled_drug_register TO mis_app;

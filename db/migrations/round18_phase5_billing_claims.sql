-- Round 18: Phase 5 - Billing and SHA Claims

-- 1. Remove SaaS Billing Tables
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS billing_plans CASCADE;
DROP TABLE IF EXISTS payment_requests CASCADE;
DROP TABLE IF EXISTS invoice_line_items CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS billing_customers CASCADE;

-- 2. Service Catalogue and Price Lists
CREATE TABLE IF NOT EXISTS service_catalogue (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  code TEXT NOT NULL, -- e.g., ICD-11 extension or internal code
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('consultation', 'lab', 'radiology', 'pharmacy', 'procedure', 'bed', 'other')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS price_lists (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'KES',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS price_list_items (
  tenant_id UUID NOT NULL,
  price_list_id UUID NOT NULL,
  service_id UUID NOT NULL,
  price_minor_units BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, price_list_id, service_id),
  FOREIGN KEY (tenant_id, price_list_id) REFERENCES price_lists(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id) REFERENCES service_catalogue(tenant_id, id) ON DELETE CASCADE
);

-- 3. Patient Billing (Invoices, Lines, Payments, Waivers)
CREATE TABLE IF NOT EXISTS invoices (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL,
  encounter_id UUID,
  invoice_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'paid', 'void', 'partially_paid')),
  subtotal_minor_units BIGINT NOT NULL DEFAULT 0,
  tax_minor_units BIGINT NOT NULL DEFAULT 0,
  total_minor_units BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'KES',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, invoice_number),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES encounters(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL,
  service_id UUID NOT NULL,
  description TEXT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  unit_price_minor_units BIGINT NOT NULL,
  total_minor_units BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id) REFERENCES service_catalogue(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS payments (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL,
  patient_id UUID NOT NULL,
  provider_slug TEXT NOT NULL CHECK (provider_slug IN ('cash', 'mpesa', 'card')),
  provider_payment_id TEXT,
  amount_minor_units BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'KES',
  status TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'pending', 'succeeded', 'failed', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS waivers (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL,
  amount_minor_units BIGINT NOT NULL,
  reason TEXT NOT NULL,
  approved_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, approved_by) REFERENCES users(tenant_id, id)
);

-- 4. Insurance and Claims
CREATE TABLE IF NOT EXISTS coverages (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL,
  payer_name TEXT NOT NULL, -- e.g. SHA, NHIF, private
  member_number TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS preauths (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  coverage_id UUID NOT NULL,
  encounter_id UUID NOT NULL,
  auth_code TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_limit_minor_units BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, coverage_id) REFERENCES coverages(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES encounters(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS claims (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL,
  encounter_id UUID NOT NULL,
  coverage_id UUID NOT NULL,
  claim_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'processing', 'paid', 'rejected', 'partially_paid')),
  total_minor_units BIGINT NOT NULL,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, claim_number),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES encounters(tenant_id, id),
  FOREIGN KEY (tenant_id, coverage_id) REFERENCES coverages(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS claim_lines (
  tenant_id UUID NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL,
  service_id UUID NOT NULL,
  amount_minor_units BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, claim_id) REFERENCES claims(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id) REFERENCES service_catalogue(tenant_id, id)
);

-- RLS Enablement
DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'service_catalogue', 'price_lists', 'price_list_items',
    'invoices', 'invoice_lines', 'payments', 'waivers',
    'coverages', 'preauths', 'claims', 'claim_lines'
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

GRANT SELECT, INSERT, UPDATE, DELETE ON service_catalogue, price_lists, price_list_items, invoices, invoice_lines, payments, waivers, coverages, preauths, claims, claim_lines TO mis_app;

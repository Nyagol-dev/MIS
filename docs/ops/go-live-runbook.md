# Hospital HMIS Production Go-Live & Cutover Runbook

**Document Reference:** OPS-GOLIVE-HMIS-2026-V1  
**Target Facility:** Level 4 / 5 / 6 Kenyan Hospital  
**System Evaluated:** Nexus Hospital Management Information System (HMIS)  
**Deployment Target:** Single-Hospital Production Environment  
**Effective Date:** October 2026  

---

## 1. Pre-Flight Verification & Infrastructure Checklist

Complete these checks prior to initiating production deployment:

### 1.1 Environment Configuration (.env.production)
Verify that all mandatory production environment variables are configured with high-entropy cryptographic secrets:

- [ ] `DATABASE_URL_APP`: Connection string using `mis_app` role (`NOBYPASSRLS`).
- [ ] `DATABASE_URL_ADMIN`: Connection string using `mis_admin` role (`BYPASSRLS`, restricted).
- [ ] `SESSION_SECRET`: ≥ 64-character random string for signing JWT session tokens.
- [ ] `BILLING_ENCRYPTION_KEY`: 32-byte hex-encoded key for AES-256-GCM field encryption.
- [ ] `CRON_SECRET`: High-entropy bearer secret for authorizing Vercel/system cron jobs.
- [ ] `DEFAULT_TENANT_SLUG`: The exact slug of the single hospital (e.g. `county-general-hospital`).
- [ ] `ALLOW_TENANT_REGISTRATION`: **Must be set to `false`** to disable public tenant creation.
- [ ] `NEXT_PUBLIC_APP_URL`: Production HTTPS URL with strict TLS 1.3 certificate.

---

## 2. Database Migration & Initialization

Execute database migrations in order using the plain-SQL migration runner:

```powershell
# Run the migration runner
npm run db:migrate
```

Verify that all baseline rounds and hospital-hardening migrations are applied:
- `db/schema.sql` (Base tables)
- `db/migrations/foundation_audit_hardening.sql` (Audit triggers and hash-chaining)
- `db/migrations/round12_*.sql` to `round18_*.sql` (Clinical, pharmacy, inpatient, billing, HIM, and HIE outbox tables)

---

## 3. Hospital Provisioning & Initial Setup

### Step 3.1: Seed Single Hospital Organization
```sql
-- Ensure single hospital tenant exists
INSERT INTO organizations (id, name, slug, org_type)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'County Referral & Teaching Hospital',
  'county-general-hospital',
  'hospital'
)
ON CONFLICT (slug) DO NOTHING;

-- Seed hospital facility settings
INSERT INTO hospital_settings (
  tenant_id,
  mfl_code,
  keph_level,
  kmpdc_licence_number,
  facility_name,
  county,
  sub_county
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  '12345',
  5,
  'KMPDC/HOSP/2026/089',
  'County Referral & Teaching Hospital',
  'Nairobi',
  'Central'
)
ON CONFLICT (tenant_id) DO UPDATE 
SET mfl_code = EXCLUDED.mfl_code,
    keph_level = EXCLUDED.keph_level;
```

### Step 3.2: Bootstrap Two Active Hospital Administrators (Two-Person Rule)
As mandated by § 4.3 of the Master Specification, the system requires at least two active administrators:

```powershell
# Bootstrap Primary Hospital Administrator
npx tsx scripts/bootstrap-staff.ts --email="admin1@hospital.go.ke" --name="Dr. Jane Mutua" --role="hospital_admin"

# Bootstrap Secondary Hospital Administrator
npx tsx scripts/bootstrap-staff.ts --email="admin2@hospital.go.ke" --name="Mr. David Ochieng" --role="hospital_admin"
```

Each administrator receives a one-time onboarding link to set their password and configure mandatory Multi-Factor Authentication (TOTP).

### Step 3.3: Configure Department Hierarchy
Populate default clinical and operational departments:
- **Clinical:** Outpatient Department (OPD), Inpatient Department (IPD), Casualty / Emergency, Maternity & MCH, Surgical Theatre.
- **Clinical Support:** Laboratory, Pharmacy, Radiology & Imaging.
- **Operational & Finance:** Accounts & Billing, Health Information Management (HIM), General Stores.

---

## 4. End-to-End Smoke Test Verification

Execute this clinical validation sequence on production before opening doors to patients:

1. **Patient Registration:** Register a synthetic test patient (`Jane Doe Test`); verify MPI duplicate detection fires when re-registering with identical National ID.
2. **Triage Assessment:** Record vitals (BP, Heart Rate, Temp); verify patient safety banner updates.
3. **OPD Consultation:** Doctor creates encounter; codes diagnosis using ICD-11 search (`1A00`); records allergy to Penicillin. Confirm allergy badge displays persistently.
4. **Orders (CPOE):** Order Full Blood Count (Lab) and Paracetamol (Pharmacy).
5. **Lab Workflow:** Lab Technologist accessions sample, enters results, and marks verified.
6. **Pharmacy Dispense:** Pharmacist verifies prescription, overrides allergy with documented clinical reason, and dispenses batch.
7. **Billing & Payment:** Cashier opens shift; verifies auto-generated invoice containing lab and medication items; simulates payment collection; prints receipt.
8. **Audit Verification:** Inspect `audit_log` to confirm every read, write, and dispense operation produced an immutable, hash-chained audit record.

---

## 5. Go-Live Sign-Off Protocol

| Role | Officer Name | Sign-Off Signature | Date / Time |
|---|---|---|---|
| **Medical Superintendent** | _______________________ | ___________________ | ___________ |
| **Head of ICT / Security** | _______________________ | ___________________ | ___________ |
| **Hospital Administrator 1** | _______________________ | ___________________ | ___________ |
| **Hospital Administrator 2** | _______________________ | ___________________ | ___________ |
| **Data Protection Officer** | _______________________ | ___________________ | ___________ |

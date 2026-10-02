# Progressive Patient Dashboard (Step 1 Report)

## 1. What Exists vs. What is Missing

### ✅ **Currently Exist in Codebase / Schema:**
- **Patients/MPI:** `patients`, `patient_identifiers`, `patient_contacts`, `patient_consents` (created in Round 14)
- **Encounters/Visits:** `encounters`, `triage_records` (created in Round 14)
- **Diagnoses (ICD-11):** `diagnoses` (created in Round 14)
- **Allergies:** `allergies` (created in Round 14)
- **Clinical Notes:** `clinical_notes` (created in Round 14)
- **Authorization & Security:** Central authorization module (`lib/authz/check.ts`), Role-Based Access Control (`roles`, `role_permissions`), `break_glass_grants`, `access_reviews`, and `care_team_assignments` all exist (created in Round 13). 
- **Read-Auditing Foundation:** `audit_log` exists with a tamper-proof hashing chain. (Requires explicit instrumentation on GET endpoints).

### ❌ **Missing (To be stubbed/deferred or added):**
- **Admissions/Beds:** Tables for wards, beds, admissions, and bed assignments are missing. 
- **Orders:** No clinical provider order entry (CPOE) tables yet (lab/radiology orders).
- **Prescriptions/MAR:** No tables for medications, prescriptions, or medication administration records.
- **Lab Results:** No laboratory sample or result tables.
- **Referrals:** No referral-tracking tables.
- **Patient Context Function:** The central `getPatientContext` helper to score/resolve the patient layout state is not yet implemented.
- **Widget Registry:** The dynamic loading grid and registry for clinical widgets are not yet implemented.

## 2. Proposed Dashboard Route
The dashboard should live at:
`app/(tenant)/patients/[patientId]/page.tsx`

**Reused components:**
- Wrap in the existing `layout.tsx` from `app/(tenant)` to inherit the sidebar and `SessionGuard`.
- We will reuse standard UI primitives (Card, Button, input components).
- We will integrate the newly built `PatientBanner` component to be persistently sticky at the top of the `[patientId]` route hierarchy (or within `[patientId]/layout.tsx`).

## 3. Proposed Migrations for Dashboard Prerequisites
Since the dashboard relies heavily on querying clinical history effectively, I propose creating the following migration (`round15_patient_dashboard_support.sql`):

1. **Indexes for Dashboard Queries:** Add specialized indexes to speed up the widgets:
   - `CREATE INDEX idx_encounters_patient_started ON encounters(tenant_id, patient_id, started_at DESC);`
   - `CREATE INDEX idx_clinical_notes_patient_created ON clinical_notes(tenant_id, patient_id, created_at DESC);`
   - `CREATE INDEX idx_triage_encounter ON triage_records(tenant_id, encounter_id);`
   
2. *(Deferred)* We will explicitly **not** create Admissions, Orders, Prescriptions, Lab Results, or Referrals tables in this migration. Instead, their respective dashboard widgets will be registered as **disabled stubs** (e.g., "Laboratory Module not enabled") until those clinical modules are built in future phases, as requested.

---
**Status:** Awaiting Approval to proceed to Step 2 (Building the Context resolver, Widget Registry, and Layout).

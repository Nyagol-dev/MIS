# MASTER PROMPT: Convert Nexus MIS into a Hospital Management Information System (HMIS) for Kenya

>  Do not skip Phase 0. Read section 1A first.

---

## 0. Your role and how to work

You are a senior full-stack engineer and health-IT security architect. You are converting an existing multi-tenant, multipurpose MIS ("Nexus MIS") into a hospital-grade HMIS for **one single Kenyan hospital** (this is not a product for a group or fleet of hospitals). Patient safety, patient privacy and auditability outrank speed and feature count.

**Verified facts about the existing codebase** (from a pre-audit of the repo zip; re-verify them yourself, and correct this document where the code disagrees):
- Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, `pg`, `jose` (JWT), `argon2`, `stripe`. Deployed on Vercel with PostgreSQL (Neon). No test framework is installed yet.
- **Tenant column is `tenant_id`** (not `tenant_id`), always first in composite primary keys. Tenant root table is `organizations` (with `org_types`, which already seeds `clinic`). RLS policy helper is `current_tenant_id()` reading `app.current_tenant_id`, set transaction-locally by `withTenantContext()` in `lib/db/withTenant.ts`. Request code must only touch the DB through that wrapper.
- Two DB roles: `mis_app` (`NOBYPASSRLS`, used for tenant requests) and `mis_admin` (`BYPASSRLS`, platform admin + slug resolution only). Preserve this split.
- **Generic entity engine:** `entity_types`, `field_definitions`, `entity_records` (JSONB `data`), `role_entity_type_permissions`, with API under `app/api/entities/**`, logic in `lib/entities/**`, UI in `app/(tenant)/entities/**` and `components/entities/**`. This is the "multipurpose" core.
- **Permissions:** global `permissions` atoms (`action` limited by CHECK to create/read/update/delete/manage) + `tenant_permission_overrides` + per-entity-type grants. Resolved in `lib/auth/permissions.ts`. Tenant admin is gated by `user:manage` / `tenant:admin` (`lib/auth/requireTenantAdmin.ts`). New tenants get one system role, "Workspace administrator" (`lib/platform/tenants.ts`).
- **Auth:** org slug + email + password (argon2id), one-time setup tokens (`user_password_setup_tokens`, 24 h), login throttling (`auth_login_attempts`), stateless HS256 JWT in an httpOnly cookie, **7-day default TTL, no sessions table**. Edge `middleware.ts` verifies the JWT only. Platform admins are a separate identity (`platform_admins`, `platform_audit_log`, hidden from `mis_app`).
- **Other subsystems:** event subscriptions + processor (cron every minute, `vercel.json`) with actions `webhook`, `internal_notification`, `field_update`, `create_record`, `send_email_template` (stub, no provider), `invalidate_report_cache`; reporting engine (`lib/reporting/**`, including an ad-hoc report endpoint); billing (`lib/billing/**`: plans, subscriptions, invoices, payments, M-Pesa STK + Stripe providers, AES-256-GCM credential encryption with a single static `BILLING_ENCRYPTION_KEY`); M-Pesa/Stripe webhooks and an M-Pesa polling cron.
- Schema in `db/schema.sql` + `db/migrations/round*.sql` (applied manually in order via `psql`; no migration runner). Design docs in `Documentation/` (round blueprints) can be mined for intent.

**Working rules**
1. **Phase 0 is read-only.** Audit the repo, then produce a gap analysis (format in section 12) and **stop for my approval** before writing feature code.
2. Work phase by phase (section 11). Each phase ends with: migrations, tests passing, `npm run lint` + `npm run build` clean, docs updated, and a short summary of what changed and what is deferred.
3. Never weaken existing tenant isolation. Every new table gets `tenant_id` as the first column of its primary key, RLS policies for select/insert/update/delete, and tests.
4. All schema changes go through new migrations. Never edit applied migrations. Never run destructive operations (drop, truncate, data rewrite) without asking.
5. **Use synthetic data only.** Never put real patient data in seeds, fixtures, screenshots, logs or tests.
6. Prefer extending existing patterns (auth, RLS helpers, permission checks, event bus, encryption helper) over inventing parallel ones.
7. If a requirement here conflicts with something you find in the code, say so explicitly and propose a resolution rather than silently choosing.
8. Do not claim the product is "DHA-certified" or "SHA-compliant" anywhere in UI or docs. Certification is an external process; we are building to be certifiable.

---

## 1. Product definition

**What it is:** a web-based HMIS for **one hospital**. The codebase stays multi-tenant under the hood (see the deployment decision below), but production runs exactly one tenant. It covers the patient journey from registration to discharge and billing, including SHA (Social Health Authority) claims, with strong privacy controls and a tamper-evident audit trail.

**Primary users:** hospital administrators, department heads, doctors/clinical officers, nurses, pharmacists, lab and radiology staff, registration/front desk, cashiers/billing, insurance/claims officers, health records officers, auditors/compliance (DPO), store/inventory staff, IT support.

**Deployment decision (single hospital):** keep `tenant_id` on every table and keep row-level security. Do **not** rip multi-tenancy out: it is already working, it is defence in depth, and a rewrite would add risk for no benefit. Instead run it as a **single-tenant deployment**:
- One `organizations` row (the hospital) created once at install; after that, **tenant creation is disabled** (remove or hard-gate the create-tenant UI/API in `app/(platform)/platform/tenants/**` and `app/api/platform/tenants/**`; allow re-enabling only through an explicit environment flag in a maintenance window).
- The login screen no longer asks for an organisation slug: resolve the single tenant from a server-side setting (e.g., `DEFAULT_TENANT_SLUG`), while keeping the slug-resolution path through `mis_admin` working and tested. Staff only enter email + password (+ MFA).
- Remove SaaS billing (plans, subscriptions, customers, invoices for tenants), see section 7. The hospital is not a paying "customer" inside its own system.
- If a second hospital ever appears, give it its **own separate deployment and database** rather than a second tenant in this one. State that in `docs/architecture.md`.
- No hospital groups, no multi-facility hierarchy, no cross-facility data sharing, no facility switcher. If the hospital has satellite clinics or outreach points, model them as **locations on departments**, not as separate facilities.

**Hospital level:** record the hospital's KEPH level (4, 5 or 6) and MFL/facility ID in a single `hospital_settings` row. Use it to default which modules are on (e.g., IPD, theatre, maternity); admins can adjust within section 8.

**Locale defaults:** English (Swahili-ready i18n), time zone Africa/Nairobi, currency KES, phone format +254, 24-hour clock option.

**Settled:** single hospital only. **Still to confirm with me before Phase 1** (list them back in the gap analysis): public vs private/faith-based; hospital level and which departments exist today; hosting region/data residency; whether we are pursuing DHA certification now or designing for it; whether the hospital already runs any HMIS whose data must be migrated.

---

## 1A. Pre-audit findings (confirm each one, then fix in Phase 1 before building clinical features)

These were found by reading the code and SQL. Confirm each against the live database and code; some may already be patched outside the repo.

**Critical for a system holding patient data**
1. **Audit log is not append-only or tamper-evident.** `audit_log` has `updated_at`, and migration `round10_app_role_grants.sql` grants `SELECT, INSERT, UPDATE, DELETE` on all tables to `mis_app`, so the app role can alter or delete audit rows. There is no hash chain. Fix: revoke UPDATE/DELETE, add blocking triggers, add hash chaining, and keep the partition strategy.
2. **Reads are not audited.** `writeAuditLog` is called only on create/update/delete (e.g., `lib/entities/records.ts`); `getEntityRecord` / `listEntityRecords` and report execution do not write audit events. Hospitals need read-access logging.
3. **Missing RLS policies in the repo SQL.** `roles`, `role_permissions`, `user_roles` and `audit_log` have `ENABLE` + `FORCE ROW LEVEL SECURITY` but I found **no `CREATE POLICY` for them** in `db/schema.sql` or the migrations (the schema comment says "same pattern for all others", but only `users` got policies). With `FORCE` and no policy, `mis_app` is denied by default. Either the live DB was patched manually, or fresh installs break. Verify against the live DB, then add explicit policies via a migration so the repo reproduces production.
4. **Sessions cannot be revoked and never go idle.** Stateless JWT, 7-day default TTL, no `jti`, no sessions table, no server-side invalidation on logout, deactivation or role change. Fix: server-side session table (or token version on the user), short idle and absolute timeouts, revoke on logout/deactivation/role change, session list for admins.
5. **No MFA anywhere** (tenant users or platform admins).
6. **Event `webhook` action sends the full mutation event (including record data) to any configured URL** (`lib/events/actions/webhook.ts`) with no allow-list, no SSRF protection and no PHI filter. Patient data could leave the system. Fix: disable for clinical data, or require an allow-listed host, payload minimisation, and an approval step.
7. **Ad-hoc reports** (`app/api/reports/adhoc`, `lib/reporting/query-builder.ts`) let users query record data across fields. Review for permission scope, row limits, export controls, and PHI exposure; add audit on every execution.
8. **Authorization is flat.** Permission `action` is limited to create/read/update/delete/manage (CHECK constraint) with no scope (own/assigned/department/hospital), no department concept and no care-team check. Tenant bootstrap creates a single "Workspace administrator" role with `user:manage` + `tenant:admin`, which means admin and clinical access cannot yet be separated.
9. **Encryption helper is billing-specific:** one static `BILLING_ENCRYPTION_KEY`, no key versioning/rotation, module-load throw if unset, encrypts a `Record<string,string>` blob. Generalise into a versioned field-encryption service (keep AES-256-GCM) before storing PHI; keep billing credentials working.
10. **Clinical data in JSONB entity records is unsuitable for the clinical core:** no foreign keys to patients/encounters, no DB-level constraints, no per-field encryption, no immutability, GIN-indexed raw `data` (searchable PHI), and updates/deletes are allowed. Decision required (see section 9).

**Hardening and hygiene**
11. `entity_records` and others permit hard `DELETE` through RLS delete policies; clinical and financial tables must not.
12. Login rate limiting keys on `X-Forwarded-For`/`X-Real-IP`; fine behind Vercel's proxy, but document it and add per-account lockout and alerting.
13. `send_email_template` is a stub; there is no outbound notification provider, so there is currently no way to send appointment reminders or alerts.
14. No automated tests, no CI, no migration runner (migrations are applied by hand in README order). Add a test framework, a plain-SQL migration runner with a `schema_migrations` table, and CI.
15. Stray one-off scripts at repo root (`fix_params.js`, `fix_session.js`) and `Documentation/` files that contain a local developer path; review and remove or move.
16. `middleware.ts` with Next.js 16: check whether the framework's current convention (a renamed `proxy` file) is expected and whether a deprecation warning is shown; keep behaviour identical if you migrate it.

---

## 2. Regulatory and standards context (Kenya) — design inputs

Treat the following as requirements to design for. Items marked **(verify)** are from secondary sources; flag anything you cannot confirm and put it on the open-questions list rather than guessing. I am not a lawyer; a Kenyan health-data lawyer should review the final compliance pack.

- **Data Protection Act 2019:** health data is sensitive personal data. Needs lawful basis/consent, data minimisation, purpose limitation, data-subject rights (access, correction), breach notification workflow (design for notification of the regulator within 72 hours **(verify)**), and registration of the data controller/processor with the Office of the Data Protection Commissioner (ODPC). A Data Protection Impact Assessment (DPIA) is expected.
- **Digital Health Act 2023 and the Digital Health (Health Information Management Procedures) Regulations 2025:** health facilities must use a digital health solution **certified by the Digital Health Agency (DHA)**; health data must be protected across its lifecycle; access only when authorized by the client or the data controller; multi-factor authentication for access to sensitive health data; backups restricted to authorized personnel for disaster recovery; retention of health data held in the national system for a minimum of 20 years — adopt **20 years as the default retention for clinical records** **(verify exact scope)**.
- **DHA certification framework (as reported):** self-attestation report (Form HMIS 4), ODPC registration, DPIA, a security/privacy/confidentiality policy, interoperability testing, and a technical checklist (reported as ~26 components) across Client Registry, Facility Registry, Health Worker Registry, eligibility check and claims integration. Standards expected: **FHIR** for exchange, **HL7** message handling, **ICD-11** diagnosis coding, **SNOMED CT** terminology, alignment with the national product catalogue. Integration goes through DHA's **AfyaLink / Health Information Exchange (HIE)**. Unofficial middleware is reported not to satisfy certification, so integrate directly against the published APIs. **(verify)**
- **SHA (Social Health Authority) context:** SHA replaced NHIF on 1 Oct 2024. Providers are moving from the SHA Provider Portal to HMIS-based claims. Timelines have been shifting: SHA extended the HMIS compliance deadline to 30 Sep 2026 and the Ministry has reported a further transition deadline of 30 Oct 2026 for Level 5/6, faith-based and private facilities **(verify current dates in the gap analysis; do not hard-code dates in the product)**. Contracting for 2026–2029 requires a DHA-certified, integrated HMIS. SHA has had large fraud losses from fake claims, so expect claims to be validated against clinical data and flagged for unusual patterns. **Design implication: every claim line must trace back to a real clinical encounter, order or dispense event in our system.**
- **Claims integration details (from DHA/AfyaLink docs):** claims are submitted as valid FHIR **Bundle** JSON (Organization, Coverage, Patient, Practitioner, Claim, etc.); each claim ID must be unique and resubmitting the same ID is treated as an idempotent duplicate; validate patient (Client Registry ID), facility (Facility ID from the Facility Registry) and practitioner (Health Worker Registry ID) before submission; ICD-11 diagnosis codes are mandatory; payer callback endpoints must be POST, secured with basic auth and optionally IP allow-listing; separate dev/UAT/prod terminology-server endpoints per environment. A reported 7-day submission window exists after which claims are flagged **(verify)**.
- **Registry integration data:** Client Registry mandatory fields (CR ID, national ID, full names, DOB, gender, phone) and a consent workflow (capture consent before processing; store it linked to the patient; age-appropriate consent); Facility Registry details cached locally; Health Worker Registry (names, licence numbers, registration number, national ID, specialization). The reported SHA flow also expects biometric-verified patient verification — build a **biometric verification adapter interface** with a mock implementation; do not hard-code a vendor.

Put all of the above into `docs/compliance/` as: `regulatory-matrix.md` (requirement → where it is implemented → status), `dpia-draft.md`, `security-policy-draft.md`, `dha-certification-checklist.md`.

---

## 3. Tenancy and organisational model

Keep the existing tenant = organisation concept, renamed in UI as **Hospital**. Add:

```
hospital (the one tenant; `hospital_settings` holds MFL/facility ID, KEPH level, KMPDC licence info, SHA/HIE credentials reference)
 └─ department (hierarchical via parent_id; e.g., Outpatient, Inpatient, Maternity, Lab, Pharmacy, Radiology, Theatre, Accounts, HR, Records, ICT)
     └─ unit / ward / clinic / room / bed (as needed; optional `location` for satellite points)
```

- `department.type`: `clinical` | `clinical_support` | `administrative`.
- `department.head_user_id` and optional `deputy_head_user_id`. A department can be deactivated, never hard-deleted once it has any linked records.
- A staff member can belong to multiple departments with a per-department role.
- All tables carry `tenant_id` (the single hospital); department-scoped tables also carry `department_id`.

---

## 4. Roles, permissions and power structure

### 4.1 Authorization model (layered)

Implement **one central policy module** (`lib/authz/`) and route every check through it. No ad-hoc `if (user.role === ...)` in routes or components. Three layers, all must pass:

1. **Tenant isolation** — PostgreSQL RLS on `tenant_id` (existing; keep as is).
2. **RBAC** — permission strings in the form `resource:action` (e.g., `patient:read`, `encounter:write`, `lab_result:verify`, `claim:submit`, `department:manage`, `audit:read`) with a **scope**: `own` | `assigned` | `department` | `hospital`.
3. **Contextual rules (ABAC / care relationship)** — clinical record access also requires a legitimate relationship: the user is on the patient's **care team** (active encounter, appointment, order or referral involving them or their department) **or** holds a role with explicit scope over that department/facility, **or** uses audited break-glass (4.5).

Permissions come from a **permission catalogue** in code (single source of truth), seeded into the DB. **System roles** are templates that are immutable; admins may **clone** them into custom roles. Hard rule: **a user can never grant a permission or scope they do not themselves hold** (no privilege escalation), and cannot edit their own roles.

### 4.2 System roles (starting set)

| Role | Core scope |
|---|---|
| **System Owner / Vendor Support** (platform area; today's "platform admin") | Deployment health, module flags, integration status, one-time provisioning. With one hospital this is the developer/vendor account: keep it to 1–2 people, MFA mandatory, ideally IP-restricted. **No access to patient data.** Support access only via time-boxed, hospital-approved, fully audited session (4.6). |
| **Hospital Admin** | Org configuration and people management (4.3). Operational, not clinical. |
| **Medical Superintendent / Clinical Director** | Hospital-wide clinical oversight, clinical governance reports, approves clinical policy/protocol changes, clinical break-glass reviews. |
| **Department Head** | Powers over their own department only (4.4). |
| **Doctor / Clinical Officer** | Full clinical documentation and orders for patients under their care team; prescribe; request lab/radiology; discharge. |
| **Nurse / Midwife** | Triage, vitals, nursing notes, medication administration record, bed/ward actions, limited orders per protocol. |
| **Pharmacist** | Review/dispense prescriptions, stock, controlled-drug register, interaction/allergy override with reason. |
| **Lab Technologist** | Receive samples, enter/verify results; sees only order context needed. |
| **Radiologist / Radiographer** | Imaging orders, reports. |
| **Registration / Front Desk** | Register patients, search MPI, appointments, queue, capture consent. No clinical notes. |
| **Cashier / Billing Officer** | Invoices, payments (cash, M-Pesa STK Push), receipts, deposits, end-of-day reconciliation. Sees billing data, not clinical notes. |
| **Insurance / Claims Officer** | Eligibility checks, pre-auth, claim assembly/submission/tracking; sees only the minimum clinical data attached to claims. |
| **Health Records Officer (HIM)** | Record completeness, coding (ICD-11), amendments workflow, release-of-information, archiving. |
| **Store / Inventory Officer** | Stock, requisitions, procurement receiving. No patient data. |
| **HR / Admin Officer** | Staff records, rosters, leave, licence expiry tracking. No patient data. |
| **Compliance / DPO / Auditor** | Read-only access to audit logs, consent records, access reports, data-subject requests. No clinical content by default. |
| **IT Support** | System health, user lockouts/resets (not role grants), integration status. No PHI. |

### 4.3 Hospital Admin powers (and limits)

**Can:**
- Create, rename, reorder, merge and **deactivate departments** (and wards/units/clinics); **assign or replace department heads and deputies**.
- Create and deactivate staff accounts; issue one-time setup links; force password/MFA reset; manage staff licence details (KMPDC/NCK/PPB etc.) and expiry alerts.
- Assign system roles; **create custom roles** by cloning and trimming system roles within the escalation rule; set per-department role assignments.
- Configure wards/beds, service catalogue, price lists, insurer/scheme setup, SHA/HIE credentials (encrypted at rest, write-only in UI), notification templates, working hours, session timeout within allowed bounds, retention settings (never below the legal minimum).
- View operational dashboards and the audit log viewer (own tenant).

**Cannot (separation of duties):**
- Read clinical notes/results by default. Admin clinical access requires the same audited break-glass flow as anyone else.
- Edit or delete clinical records, financial postings or audit entries.
- Approve their own requests (role elevations, discounts/waivers, deletions).
- Impersonate other users.
- Disable audit logging, MFA enforcement, or lower retention below the minimum.

**Safeguards:** at least **two active Hospital Admins** required per tenant (block deactivating the last one); changes to admin-level roles require a **second admin's approval** (two-person rule); every change writes an audit event with before/after.

### 4.4 Department Head powers (scoped to own department)

**Can:** view and manage their department's staff roster and shifts; approve department leave, requisitions, overtime and schedule swaps; see department patient lists and workload; view **department-level aggregate** dashboards and KPIs; review the department's access/audit report; request role changes for their staff (routed to Admin for approval); approve department-level overrides (e.g., stock emergency issue); nominate/revoke delegated acting head with an end date; for clinical departments, review documentation completeness and sign off protocols.

**Cannot:** create/edit roles or permission catalogue; add or remove departments; see other departments' patients or staff data (except via care-team relationship); grant themselves wider scope; access billing configuration; delete records. A department head who is also a clinician uses their **clinician role** for patient care, and their **head role** for management; the two do not merge silently.

### 4.5 Break-glass (emergency access)

If a user without a care relationship needs a record in an emergency: require a **reason (coded + free text)**, grant **time-limited** access (e.g., 1–4 hours, configurable), display a persistent "break-glass session" banner, **notify** the patient's primary clinician/department head and the DPO, and put it into a **mandatory post-hoc review queue** (Clinical Director/DPO must mark justified or not). Repeated unjustified use triggers alerts. Special-category records (4.7) require elevated approval unless life-threatening emergency is declared.

### 4.6 Platform support access

Platform admins have no default tenant data access. Support sessions: requested by platform staff, **approved by a tenant Hospital Admin**, time-boxed, read-only unless explicitly extended, masked PHI by default, fully audited and visible to the tenant.

### 4.7 Special-category and restricted records

Per-patient and per-encounter **confidentiality levels**: `normal`, `restricted`, `very_restricted` (e.g., staff-as-patient/VIP, HIV, mental health, reproductive health, gender-based violence, minors' sensitive notes — make the category list configurable per tenant). Restricted records: hidden from search results for non-care-team users, require explicit care-team membership or break-glass with approval, separate permission (`patient_restricted:read`), and extra audit detail.

### 4.8 Permission matrix deliverable

Produce `docs/security/permission-matrix.md` (role × module × action × scope) generated from the catalogue, and **auto-generate role-matrix tests from it**: for each role, assert allowed actions succeed and every other action returns 403, including cross-department and cross-tenant attempts (IDOR tests).

---

## 5. Security requirements

**Authentication and sessions**
- Keep org-slug + email + password and one-time setup links. Add **MFA (TOTP) mandatory** for all clinical, billing, admin and platform roles; recovery codes; admin-initiated MFA reset with audit.
- Password policy (length-based, breached-password check optional), lockout/backoff, rate limiting on auth and sensitive endpoints, secure cookies (HttpOnly, Secure, SameSite), session rotation on privilege change, **idle auto-lock** (default 10–15 min, configurable) with quick re-authentication that preserves unsaved clinical notes locally in memory only, concurrent-session visibility and remote revoke.
- Optional per-tenant IP allow-list and device trust for admin roles.

**Data protection**
- TLS everywhere; encryption at rest (managed DB) **plus application-level field encryption (AES-256-GCM, reuse the existing helper)** for high-risk identifiers (national ID, phone, address, insurance numbers, special-category notes). Support key versioning/rotation. Keep search possible via blind indexes (HMAC) where needed.
- **No PHI** in logs, URLs, query strings, error messages, analytics, cron payloads, or client-side storage. SMS/notification content must contain **no clinical detail**.
- Exports/prints require a permission, a purpose, are watermarked with user + timestamp, and are audited. Rate-limit bulk reads to detect scraping.
- Backups: encrypted, access restricted, **restore tested** and documented (RPO/RTO targets in `docs/ops/dr.md`).
- Retention: clinical records default 20 years; **no hard deletes** of clinical or financial data — use soft-delete, versioned amendments and legal-hold flags. Data-subject deletion/correction requests handled via a controlled workflow that respects legal retention.

**Audit (non-negotiable)**
- Append-only, **tamper-evident** audit log (hash-chained rows; DB privileges and triggers that block UPDATE/DELETE). Log every **read** of patient data (not just writes), plus create/update/amend, print/export, login/logout/failed login, MFA events, permission and role changes, break-glass, consent changes, integration calls (SHA/HIE) and admin config changes.
- Fields: actor, role at the time, department, patient (if any), resource type/id, action, reason, IP, user agent, request id, timestamp, prev_hash/hash.
- Audit viewer with filters and **"who accessed this patient"** report (also available as a patient-facing access history on request). Anomaly alerts (after-hours access, VIP lookups, mass lookups, same-surname/self/colleague lookups).
- Add an automated test that fails the build if any route returning PHI does not write an audit event.

**Application hardening:** strict CSP and security headers, input validation (zod or equivalent) on every route, parameterised queries only, server-side authorization on every API and server action (never rely on hidden UI), CSRF protection, dependency scanning (`npm audit` in CI), secret management via env/Vercel, no secrets in repo, safe file upload (type/size/AV scan hook, private storage, signed short-lived URLs).

**Consent and privacy:** consent capture and withdrawal per purpose (treatment, insurance claims, HIE sharing, SMS reminders, research/de-identified analytics), stored with timestamp, method and witness; guardian consent for minors; consent checked before HIE sharing; privacy notice template.

**Incident response:** breach register + workflow (detect → contain → assess → notify regulator/patients as required → post-mortem) with templates in `docs/security/incident-response.md`.

---

## 6. What to ADD (hospital modules)

Build modules behind per-tenant **feature flags** (section 8). Each module: schema + RLS, API, UI, permissions, audit events, tests, seed data.

1. **Patient registration and Master Patient Index (MPI):** demographics, national ID/birth cert/passport/alien ID, next of kin, guardian for minors, SHA number, CR ID (Client Registry), photo (optional), duplicate detection (fuzzy name + DOB + phone), merge with full reversible audit, unknown/emergency patient registration (temporary ID, later reconciled), two-identifier verification, patient identity banner.
2. **Appointments, queue and triage:** booking, walk-ins, department queues, visit types, triage (vitals, MEWS/PEWS-style scoring configurable), priority escalation.
3. **Outpatient (OPD) clinical documentation:** structured encounter (complaints, history, exam, assessment, plan), **ICD-11 diagnosis search/coding**, problem list, allergies (allergy banner everywhere), immunisation and chronic-condition flags, clinical templates per specialty, e-signature/lock with addendum-only amendments.
4. **Orders (CPOE):** lab, radiology, procedures, prescriptions, referrals; order status tracking; result acknowledgement by ordering clinician; critical-result alerts.
5. **Laboratory (LIS):** sample collection/labelling, accession numbers, worklists, result entry with reference ranges and units, technologist entry → verification → release workflow, critical value flagging, TAT metrics, QC log.
6. **Radiology:** orders, scheduling, reports, link-out to PACS (URL/DICOM viewer adapter), template reports.
7. **Pharmacy and dispensing:** formulary aligned to the national product catalogue, e-prescription → dispense, batch/expiry tracking, FEFO, drug-allergy and interaction checks (with override + reason), controlled-drug register, returns, stock-outs and reorder levels.
8. **Inpatient (IPD):** admission/transfer/discharge (ADT), wards and bed management/occupancy, nursing notes and care plans, **medication administration record (MAR)**, vitals charting, intake/output, doctor ward rounds, discharge summary, death notification workflow.
9. **Theatre and procedures:** scheduling, WHO surgical safety checklist, operation notes, consumables charging.
10. **Maternity / MCH (light first release):** ANC/PNC visits, delivery record, immunisation schedule, growth monitoring. (Phase-able; keep minimal until core is stable.)
11. **Billing and revenue cycle:** service catalogue + versioned price lists, auto-charging from orders/dispense/bed-days, invoices, deposits/advance payments, **M-Pesa STK Push (repurpose existing integration) + cash/card**, receipts, refunds and **waivers/discounts requiring approval**, patient statements, cashier shift close and daily reconciliation, debtor/credit control. No edits to posted transactions — reversals only.
12. **Insurance and SHA claims:** coverage records, **eligibility verification**, pre-authorization, claim assembly from encounters/orders/dispenses, **ICD-11 + service-code validation**, FHIR Claim Bundle generation, submission, status tracking, rejection/resubmission with idempotent claim IDs, SLA/aging dashboard, reconciliation of payments to claims, fraud-guard checks (claim line without matching clinical event is blocked). Other insurers via a generic adapter.
13. **Registry and HIE integration layer (`lib/integrations/dha/`):** Client Registry, Facility Registry, Health Worker Registry, eligibility, claims, with retries, idempotency, circuit breaker, dead-letter queue, full request/response audit (PHI-safe), environment config (dev/UAT/prod), mock servers for local/CI. FHIR R4 mapping layer for Patient, Encounter, Condition, Observation, MedicationRequest, ServiceRequest, DiagnosticReport, Claim, Coverage, Practitioner, Organization.
14. **Referrals (in/out):** referral letters, status, feedback.
15. **Inventory, store and procurement (general stores):** requisitions (dept head approves), issues, receiving, stock take. Reuse existing generic inventory if present.
16. **HR and rostering for clinical staff:** licence tracking and expiry alerts, shifts/rosters, on-call, leave. Reuse existing people/HR features where they exist.
17. **Health Records (HIM) workspace:** chart completeness, coding queue, amendment requests, release-of-information log, archival.
18. **Reporting and statutory returns:** operational dashboards per role; clinical quality indicators; financial and claims reports; **aggregate MOH/DHIS2-style facility returns** (workload, OPD/IPD summaries, immunisation, maternal health) generated from de-identified aggregates — confirm current report definitions **(verify)** before implementing.
19. **Notifications:** provider-agnostic adapter (SMS first; email later) for appointment reminders and result-ready alerts with **no clinical content**; in-app task inbox for clinicians.
20. **Patient-facing portal (later phase, optional):** appointments, bills, consent management, access history. Do not start until Phases 1–6 are solid.
21. **Clinical safety UX:** persistent patient banner (name, age/sex, ID, allergies, alerts), wrong-patient prevention, confirmation on high-risk actions, read-only emergency summary, and **downtime procedures** (printable downtime forms and a read-only emergency record view) because connectivity in many facilities is unreliable. Design for low bandwidth and graceful degradation.

---

## 7. What to REMOVE, HIDE or REPURPOSE

Classify **every** existing module/route/table/nav item as **KEEP / ADAPT / REMOVE / PLATFORM-ONLY** in the Phase 0 report, with a one-line justification. Defaults to apply unless the audit shows a reason not to:

- **REMOVE or hide from tenant UI:** the generic **entity builder as a tenant-facing feature** (`app/(tenant)/entities/**`, `components/entities/**`, `app/api/entities/**` field/type creation) for anything clinical or financial; keep it, if at all, behind a platform feature flag for low-risk reference lists (e.g., custom dropdown lists) with no PHI. Remove the marketing/demo pages that describe the product as a generic MIS (`app/page.tsx`, `app/features`, `app/how-it-works`, `components/marketing/**`) and rewrite them for hospitals. Remove non-hospital `org_types` (`school`, `ngo`, `civic_agency`) from tenant-facing selection and add `hospital`, `health_centre`, `clinic`. Disable the `webhook` event action for tenants (finding 6) and any tenant-facing export that bypasses export permissions and audit. Remove `fix_params.js` / `fix_session.js` if unused.
- **ADAPT:** `users` → **Staff** (add licence data, departments, MFA); a new typed **Patients** (MPI) domain alongside it (do not model patients as entity records); "organisation/workspace" → **Hospital**; generic roles/permissions → the catalogue in section 4; generic reports → role-based hospital dashboards; event subscriptions → internal domain events (e.g., `order.placed`, `result.verified`, `claim.rejected`) feeding notifications and tasks, **with no PHI in event payloads sent outside the system**; existing M-Pesa STK Push provider (`lib/billing/providers/mpesa.ts`) → patient payment collection via a new patient-billing domain, kept in its own domain; existing AES-256-GCM helper → field-level PHI encryption; existing user management → staff management with licence data.
- **REMOVE (single hospital, no SaaS):** tenant-facing SaaS billing: `app/api/billing/{plans,subscriptions,customers,invoices}/**`, `lib/billing/{plans,subscriptions,usage}.ts`, and the related UI and tables, once you have confirmed what they currently do. **Salvage, do not delete blindly:** the M-Pesa provider (`lib/billing/providers/mpesa.ts`), the payment-request/webhook plumbing and polling cron, invoice numbering (`tenant_invoice_sequences`), and the credential-encryption pattern. Move these into a new patient-billing domain. Drop the Stripe provider and its webhook unless the hospital explicitly wants card payments.
- **PLATFORM-ONLY (keep, minimised):** platform admin identity and login, one-time tenant provisioning (then locked), module flags, health/status. Platform admins never see PHI.
- **KEEP:** `withTenantContext`, RLS architecture, `NOBYPASSRLS` app role, one-time setup links, platform/tenant separation, migrations workflow, Tailwind-based institutional design language.
- **Terminology pass:** replace generic labels throughout the UI and docs with hospital terminology.

---

## 8. Module flags (single hospital)

Add a simple `hospital_modules` table (one row per module, enabled/disabled, enabled_at, enabled_by). Module flags must be enforced **server-side** (API 404/403 when disabled), not only in navigation. Purpose: **phased go-live** (turn on Registration/OPD first, then Lab/Pharmacy, then IPD, then Billing/SHA) and hiding modules the hospital does not run (e.g., theatre, maternity). The Hospital Admin can toggle clinical and operational modules; security-critical controls (audit, MFA, encryption, retention minimums) are never toggleable. No facility profiles or per-facility flags.

---

## 9. Data model guidance (starting point; refine after audit)

**Decision (apply unless the audit shows a strong reason not to): use dedicated, typed relational tables for the clinical, pharmacy, lab, billing and claims domains, not the JSONB entity engine.** The entity engine stays as an optional platform-flagged feature for non-PHI configuration lists. Reasons: foreign keys to patient/encounter, DB constraints, immutability and versioning, per-field encryption, indexable codes (ICD-11), and FHIR mapping. Reuse the engine's good ideas (schema versioning, per-type permissions) where they help, but not its storage model for PHI.


New/changed core tables (all with `tenant_id`, timestamps, `created_by`, soft-delete where applicable, RLS):
`hospital_settings, departments, department_members, roles, role_permissions, user_roles (with department scope), permission_catalogue, care_team_assignments, break_glass_grants, access_reviews, patients (+ patient_identifiers, patient_contacts, patient_consents), visits/encounters, triage_records, clinical_notes (versioned, locked/addenda), diagnoses (ICD-11), allergies, orders (+ order_items), lab_samples/lab_results, imaging_orders/reports, prescriptions/dispenses/stock_batches/controlled_drug_register, admissions/bed_assignments/wards/beds, nursing_notes/mar_entries, theatre_cases, referrals, service_catalogue/price_lists, invoices/invoice_lines/payments/refunds/waivers, coverages/preauths/claims/claim_lines/claim_submissions/claim_responses, integration_outbox/dead_letters, audit_log (append-only, hash-chained), notifications, hospital_modules, retention_policies, legal_holds, incident_register`.

Rules: clinical notes and posted financial entries are **immutable** (corrections via versioned amendments/reversals); every clinical row links to `patient_id` + `encounter_id` + authoring user + department; avoid storing PHI in JSON blobs that bypass field encryption; add indexes for MPI search and audit queries; use database constraints (FKs, checks) liberally.

---

## 10. Quality bar and testing

- **Isolation tests:** tenant A can never read/write tenant B (every table, every API).
- **Authorization tests:** generated from the permission matrix; include department-scope and care-team negative tests; escalation-prevention tests (user cannot grant what they lack, cannot edit own role, cannot remove last admin).
- **Audit tests:** every PHI-returning route emits an audit event; audit table rejects UPDATE/DELETE; hash chain verification job passes.
- **Security tests:** IDOR, mass-assignment, rate limiting, MFA enforcement, session timeout, CSP headers, no-PHI-in-logs scan.
- **Clinical logic tests:** drug-allergy checks, critical-result flow, duplicate patient detection, claim bundle validation (ICD-11 required, unique claim IDs, idempotent resubmit), billing immutability/reversals.
- **Integration tests** against mock DHA/SHA servers; contract tests for FHIR bundles.
- CI: lint, type-check, tests, `npm audit`, migration check. Keep `npm run build` green at the end of every phase.
- Accessibility (WCAG 2.1 AA), keyboard-first flows for registration and billing, responsive for tablets at ward/bedside.

---

## 11. Phased roadmap (stop for my review at the end of each phase)

**Phase 0 — Verify and plan (read-only).** A pre-audit already exists in section 1A. Confirm or refute every finding, extend it, and deliver the gap analysis (section 12). No code changes except adding `docs/`.

**Phase 1 — Fix the foundation, then org structure, roles, security.** First close section 1A items 1–9 (audit immutability + read auditing, missing RLS policies, session store + idle timeout, MFA, webhook lockdown, report controls, scoped authz, versioned field encryption), set up tests/CI and a migration runner, then build: departments/heads (single hospital), permission catalogue, system + custom roles, central `authz` module, care-team model, break-glass, MFA, session hardening, append-only hash-chained audit log + viewer, module flags, lock tenant creation + hide org slug on login, remove SaaS billing, terminology pass, removal/hiding per section 7. *Acceptance:* admin can create departments and assign heads; department head sees only own department; permission-matrix tests green; audit coverage test green; last-admin and escalation rules enforced.

**Phase 2 — Patient registration, appointments, triage, OPD.** MPI with dedupe, consent capture, ICD-11 coding, allergies, clinical notes with lock/amend, patient banner. *Acceptance:* full OPD visit end-to-end with audit trail and role restrictions.

**Phase 3 — Orders, Laboratory, Radiology, Pharmacy.** CPOE, LIS, dispensing, stock, controlled drugs, safety checks.

**Phase 4 — Inpatient and theatre.** ADT, beds, nursing/MAR, discharge, theatre scheduling.

**Phase 5 — Billing and SHA claims.** Charging, payments (M-Pesa STK), waivers with approval, reconciliation, eligibility, pre-auth, FHIR claim bundles, tracking, fraud-guard.

**Phase 6 — Registry/HIE integration, reporting, HIM workspace, notifications.** Client/Facility/Health Worker registry adapters, FHIR mapping, statutory/aggregate reports, records workspace.

**Phase 7 — Hardening and certification pack.** Pen-test checklist, DR drill, performance tests, compliance docs (regulatory matrix, DPIA, security policy, certification checklist), training material, go-live and downtime runbooks. Optional: Phase 8 patient portal and maternity expansion.

---

## 12. Phase 0 deliverable format

Create `docs/hospital-conversion/00-gap-analysis.md` containing:
1. **Codebase map:** tables, routes, roles/permissions as they exist today, RLS approach, integrations, cron jobs, env vars.
2. **Keep/Adapt/Remove/Platform-only table** for every module, route group and table, with justification.
3. **Gap list** against sections 3–6 (what exists, what is missing, effort S/M/L).
4. **Risks and conflicts** (e.g., places where PHI might leak, RLS gaps, hard-deletes, missing audit, secrets handling, email absence implications for password setup).
5. **Proposed migration plan** for Phase 1 (ordered migrations, backwards-compatibility notes).
6. **Open questions** for me (the assumptions in section 1 and every **(verify)** item in section 2 that you could not confirm from code or docs).
7. **Estimated sequencing** and what you recommend deferring.

Then **stop and wait for my approval.**

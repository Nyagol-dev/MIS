# Nexus MIS → Hospital MIS: Phase 0 gap analysis

**Status:** Repository-only audit, 2 October 2026. No application files, SQL, migrations, or live data were changed/read. The only Phase 0 deliverable is this document. No database connection was attempted; live-schema and environment assertions remain unverified. This is an engineering assessment, not legal or regulatory advice.

## 1. Codebase map

### Stack and runtime

- Next.js 16.3.7 App Router, React 19.2.4, TypeScript 5, Tailwind 4, Node `pg`, `jose` 6, `argon2`, Stripe SDK. PostgreSQL schema and migrations are under `db/`; the repository does not identify the deployed database provider or hosting region conclusively.
- Scripts: `dev`, `build`, `start`, `lint`, `bootstrap:platform-admin`. No test runner, type-check script, CI definition, or migration runner is present in `package.json`/the root inventory. Dependencies are installed locally, but no commands that modify/build application outputs were run for this read-only audit.
- `middleware.ts` exports `middleware()` and verifies JWTs via `jose`; Next 16.3.7 version and expected convention should be checked with build/runtime warning output in Phase 1. Middleware does not query the DB.
- `.env.example` names `DATABASE_URL_APP`, `DATABASE_URL_ADMIN`, `PGSSLMODE`, `SESSION_SECRET`, `BILLING_ENCRYPTION_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`, optional Stripe and M-Pesa variables. `.env.local` exists but was deliberately not read. Actual production variables and secret management are unknown.
- `vercel.json` schedules `/api/cron/process-events` every minute. An M-Pesa poll route exists, but no corresponding cron entry appears in `vercel.json`.

### Database and tenancy

- Base tables in `db/schema.sql`: `org_types`, `organizations`, `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, partitioned `audit_log` with a default partition, `tenant_permission_overrides`, `entity_types`, `field_definitions`, `entity_records`, `role_entity_type_permissions`, `event_subscriptions`, `event_execution_log`.
- Migrations (README order): `round3_event_log_update_policy.sql`, `round4_reporting_tables.sql`, `round6_platform_admin_layer.sql`, `round8_billing_tables.sql`, `round9_auth_credentials.sql`, `round10_app_role_grants.sql`, `round11_roles_updated_at.sql`. Added tables include reporting/cache, platform identities/audit, billing provider/customer/plan/subscription/invoice/payment/webhook data, and setup/login credential data.
- Tenant-owned tables generally use `tenant_id`; several composite keys begin with it. `organizations` is the tenant root. `org_types` seeds `school`, `ngo`, `civic_agency`, and `clinic`; there are no hospital/health-centre seeds in the inspected schema.
- `withTenantContext()` in `lib/db/withTenant.ts` wraps app-pool work in a transaction and uses transaction-local `app.current_tenant_id`. Request/domain code often uses this path. Exceptions are intentional or notable: login resolves a public slug with the admin pool then verifies the tenant user; setup-token SQL functions and platform flows have dedicated paths; cron/payment code has cross-tenant orchestration. Every such use needs review so `mis_admin` remains limited to slug resolution/platform duties and tenant work still enters a tenant context.
- The README says `mis_app` is NOBYPASSRLS and `mis_admin` is BYPASSRLS. This is documented, not verified against a live cluster. `round10_app_role_grants.sql` grants `SELECT, INSERT, UPDATE, DELETE` on all tables to `mis_app` before revoking platform-only tables.
- RLS is enabled and forced in the base schema on `users`, `roles`, `role_permissions`, `user_roles`, `audit_log`, and `tenant_permission_overrides`. Explicit four-operation tenant policies are defined for `users` and `tenant_permission_overrides`. No `CREATE POLICY` for `roles`, `role_permissions`, `user_roles`, or `audit_log` appears in the repository SQL/migrations. With FORCE RLS, the app role is denied by default on those tables unless the live database differs. Audit evidence strongly supports pre-audit finding 3.
- `entity_types`, `field_definitions`, `entity_records`, `role_entity_type_permissions`, event tables and migration-added tenant tables generally have tenant RLS policies. Policy completeness and policy correctness still require systematic inventory/testing.

### Routes and modules

- Pages: public marketing `/`, `/features`, `/how-it-works`; auth `/login`, `/accept-invite`, `/platform/login`; tenant `/dashboard`, `/users`, `/roles`, `/entities` and dynamic entity type/record pages; platform `/platform/dashboard`, `/platform/tenants`, `/platform/admins`.
- API groups: `/api/auth/{login,logout,setup-password}`, `/api/users`, `/api/roles`, `/api/entities` (types, fields, records), `/api/reports` (definitions, execute, refresh, adhoc), `/api/billing/{plans,subscriptions,customers,invoices,payments}`, `/api/platform/{login,tenants,admins}`, `/api/webhooks/{stripe,mpesa}`, `/api/cron/{process-events,poll-mpesa-pending}`.
- Auth: organisation slug + email + password, Argon2 password hashing, one-time setup tokens (24-hour expiry in brief/repo), `mis_session` httpOnly JWT cookie and configurable `SESSION_TTL_SECONDS` default. No session table, JWT revocation ID/version, idle timeout or MFA flow found. Logout clears client cookie only. Platform admin identity is separate.
- Permissions: global `permissions` with `resource:action` codenames and a CHECK-constrained action set (`create/read/update/delete/manage`); tenant permission overrides; role assignment; entity-type action grants. Tenant administrator routes use `user:manage`/`tenant:admin`. No department, own/assigned/department/hospital scope, care-team relationship, break-glass, second-admin approval, last-admin protection, or central `lib/authz/` catalogue is present in inspected code.
- Generic entity engine stores records as JSONB; GIN indexing and update/delete RLS policies exist. Create/update/delete audit calls are present in entity logic; get/list paths in `lib/entities/records.ts` have no corresponding read-audit call.
- Event engine supports `webhook`, `internal_notification`, `field_update`, `create_record`, `send_email_template`, `invalidate_report_cache`. `webhook.ts` directly fetches configured URL and serializes the complete mutation event; no host allow-list, SSRF guard or PHI filtering is visible. Email action is a stub. Events/processor run every minute via the configured Vercel cron.
- Reporting engine uses definitions, cache, field resolver, executor, and adhoc query builder over JSONB entity fields. Query construction has field/operator allowlists and bind parameters. Every execution still needs auth scope, row/export limits, PHI review and audit coverage. No statutory DHIS2-style returns or de-identified aggregates exist.
- Billing includes tenant-facing SaaS plans/subscriptions/customers/invoices plus M-Pesa and Stripe providers, payment callbacks/polling, tenant invoice sequences and AES-256-GCM credential encryption. No patient billing/claims domain exists.
- `fix_params.js` and `fix_session.js` are root scripts; usage and safety were not established. `Documentation/` includes architecture/round blueprints; paths and content should be checked for local machine references before keeping.

## 2. Keep / Adapt / Remove / Platform-only inventory

Classifications below cover every current route family and repository table; modules that do not exist yet are listed in the gap list, not misrepresented as current modules.

### Route groups and product modules

| Current item | Classification | Reason |
|---|---|---|
| `app/(auth)/login`, `app/api/auth/login` | ADAPT | Keep password + one-time setup; resolve sole hospital server-side and add MFA/session controls. |
| `app/(auth)/accept-invite`, `app/api/auth/setup-password`, `app/api/auth/logout` | ADAPT | Retain setup flow; add audited MFA, session creation/revocation and session policy. |
| `app/(auth)/platform/login`, `app/api/platform/login` | PLATFORM-ONLY | Separate platform identity; no PHI access; MFA mandatory. |
| `app/(tenant)/dashboard` | ADAPT | Replace generic workspace dashboard with role/module-aware hospital dashboards. |
| `app/(tenant)/users`, `/api/users` | ADAPT | Staff registry, departments, licence, MFA and scoped role administration. |
| `app/(tenant)/roles`, `/api/roles` | ADAPT | Catalogue-backed scoped RBAC, immutable templates, escalation and two-person safeguards. |
| `app/(tenant)/entities/**`, `/api/entities/**` | REMOVE from tenant UI/API for clinical or financial use; optionally PLATFORM-ONLY for non-PHI reference configuration | JSONB engine lacks clinical constraints, encryption and amendment model; disable tenant builder. |
| `app/api/reports/**` | ADAPT | Retain after scope, audit, export controls, aggregation and PHI checks; adhoc endpoint is especially sensitive. |
| `app/api/billing/{plans,subscriptions,customers,invoices}/**` | REMOVE after use/data review | Tenant-facing SaaS billing has no fit in single-hospital operations. Do not drop existing data without an approved migration/retention plan. |
| `app/api/billing/payments`, `app/api/webhooks/mpesa/**`, M-Pesa poll route | ADAPT | Preserve payment rail plumbing for patient payments in a distinct patient-billing domain. |
| `app/api/webhooks/stripe/**`, Stripe provider | REMOVE unless hospital explicitly selects card payments | SaaS/card provider has no confirmed patient-payment requirement. |
| `app/api/cron/process-events`, event subscription UI/API if present | ADAPT / lockdown | Keep internal domain events, notification/task processing; disable tenant webhook action pending safe design. |
| `app/api/platform/tenants/**`, `app/(platform)/platform/tenants` | PLATFORM-ONLY, then hard-gate after provisioning | One-time provisioning remains controlled maintenance capability; ordinary create-tenant disabled. |
| `app/api/platform/admins/**`, `app/(platform)/platform/admins` | PLATFORM-ONLY | Minimal deployment support identity; no patient data. |
| `app/(platform)/platform/dashboard` | PLATFORM-ONLY | Health/status and module/integration status only; no PHI. |
| `/`, `/features`, `/how-it-works`, `components/marketing/**` | REMOVE or rewrite | Generic MIS marketing does not describe the hospital product. |
| `middleware.ts` | KEEP / ADAPT | Preserve edge JWT route gating; verify Next convention and maintain equivalent behavior. |
| `scripts/bootstrap-platform-admin.ts` | PLATFORM-ONLY | Keep guarded initial platform bootstrap. |
| `fix_params.js`, `fix_session.js` | REMOVE if confirmed unused | One-off scripts have unknown purpose; inspect/recover intent before removal. |
| `vercel.json` event cron | ADAPT | Keep required schedules only; define/verify secure M-Pesa poll scheduling. |

### Tables and database objects

| Table/object | Classification | Reason |
|---|---|---|
| `org_types`, `organizations` | ADAPT | Rename tenant-facing terminology to Hospital; limit choices to hospital/health centre/clinic and lock routine provisioning. |
| `users` | ADAPT | Staff identity, departments, professional licence, MFA and access lifecycle. |
| `roles`, `permissions`, `role_permissions`, `user_roles`, `tenant_permission_overrides`, `role_entity_type_permissions` | ADAPT | Replace/extend with central permission catalogue, scope, department membership and care-context checks. Fix missing RLS before relying on app role. |
| `audit_log`, `audit_log_default` | KEEP / HARDEN | Preserve partitioning; add append-only privilege/trigger protection, hash chain and comprehensive read/access events. |
| `entity_types`, `field_definitions`, `entity_records` | PLATFORM-ONLY / REMOVE tenant clinical use | Optional non-PHI reference lists only; no patient record storage. |
| `event_subscriptions`, `event_execution_log` | ADAPT | Internal events/task processing; no external PHI payloads or unrestricted user-configured URLs. |
| `report_definitions`, `report_cache` | ADAPT | Keep with aggregate-first designs, row controls, access audit and PHI-safe cache policy. |
| `platform_admins`, `platform_audit_log`, default partition | PLATFORM-ONLY | Separate system support audit and identity; keep away from `mis_app`. |
| `tenant_invoice_sequences` | ADAPT | Reuse numbering for patient billing after ownership/domain redesign. |
| `tenant_provider_configs` | ADAPT | Reuse encrypted M-Pesa credentials; migrate into versioned secret/credential service and patient billing. |
| `billing_customers` | REMOVE SaaS semantics; ADAPT only if safe patient-billing migration is designed | Existing customer identity shape is not the new MPI; do not equate or migrate blindly. |
| `billing_plans`, `subscriptions` | REMOVE after data-retention and dependency review | SaaS plans/subscriptions are not hospital patient care records. |
| `invoices`, `invoice_line_items` | REMOVE from SaaS domain; ADAPT only through explicit patient-finance migration | Patient invoices require immutable posted entries, reversals, encounter links and new authorization. |
| `payment_requests`, `payment_webhook_events` | ADAPT | Preserve provider callbacks/idempotency where useful; audit and bind to patient invoice/payment domain. |
| `user_password_setup_tokens`, `platform_admin_password_setup_tokens`, `auth_login_attempts` | KEEP / ADAPT | Keep one-time setup and throttling; add MFA recovery and session controls; audit auth events. |
| `schema_migrations` (not present) | ADD | Migration runner ledger required; bootstrap existing installations without reapplying historical scripts. |
| All proposed hospital/clinical tables (`hospital_settings`, departments, patients, encounters, orders, results, pharmacy, ADT, claims, integrations, etc.) | ADD | No typed clinical domain schema currently exists. Add incrementally with tenant RLS and constraints. |

## 3. Gaps against the hospital requirements (Sections 2–6)

Effort is a rough engineering estimate for the capability, not a schedule commitment. **S** small, **M** medium, **L** large / cross-cutting.

| Area | Current evidence / gap | Effort |
|---|---|---|
| Kenya legal/regulatory readiness | No compliance matrix, DPIA, security policy, certification checklist or incident workflow found. Legal duties and current DHA/SHA technical rules need primary-source and counsel confirmation. | L |
| Single-hospital setup | Tenant architecture is reusable, but UI/API create multiple organisations and login asks for org slug. Hospital settings, one-hospital enforcement and department hierarchy absent. | M |
| Roles and separation of duties | Basic tenant roles and permission atoms exist; clinical/admin separation, scopes, departments, care team, escalation prevention, immutable system templates, two-admin approval and last-admin safeguard absent. | L |
| Patient data and consent | No MPI, patient identifiers/contacts/guardian, consent, deduplication/merge or restricted-record model. JSONB entity storage is unsuitable for clinical core. | L |
| Clinical workflows | No appointments, queue, triage, OPD, diagnoses/ICD-11, allergies, signed/amended notes, order/result workflows, critical alerts, pharmacy, IPD, theatre, maternity or referrals. | L |
| Billing and claims | SaaS billing exists; patient billing, reversals/immutable postings, waiver approval, eligibility, SHA claims/FHIR bundles, idempotency tied to clinical events absent. | L |
| DHA/HIE and registries | No adapter layer, FHIR mapping, retry/dead-letter/circuit breaker, mock integration or registry validation. | L |
| Security architecture | MFA, revocable sessions, idle lock, role/scope authz, break-glass, support approval, key versioning and field encryption absent. Login source throttling exists but depends on trusted proxy headers; per-account lockout/alerts are not demonstrated. | L |
| Audit and privacy | Writes audited in some entity/billing paths; patient reads, reports, auth, MFA, print/export, permission, consent and integration access coverage absent. Existing log lacks append-only/hash-chain controls in repository. | L |
| Event/webhook safety | Full mutation event posted to configured URL; no visible allow-list/SSRF defense/minimization. Email remains stub. Replace with internal events and PHI-free notification adapter. | M/L |
| Reporting | Generic report definitions/cache and ad-hoc query endpoint exist, with SQL allowlisting and parameterization. Role-aware scope, audited runs, export permission/watermark, bulk-read monitoring and verified statutory definitions not established. | M/L |
| Operations and resilience | No DR/RPO/RTO, restore-test evidence, downtime forms, emergency read-only record, clinical safety UX, upload/security workflow or deployment residency evidence in inspected repo. | L |
| Localization and accessibility | No demonstrated English/Swahili-ready i18n, Nairobi locale/currency/phone defaults, 24-hour clock option, WCAG verification or low-bandwidth clinical workflows. | M/L |
| Engineering quality | No test framework, CI, migration runner or migration check visible. README documents manual ordered `psql`; no automated isolation/security/clinical/integration contracts. | M/L |

## 4. Pre-audit finding verification and risks/conflicts

| # | Finding | Repository result |
|---|---|---|
| 1 | Audit is mutable; no chain | **Confirmed.** `audit_log` includes `updated_at`; partitioning exists. Round 10 grants table-wide UPDATE/DELETE and no audit-specific revoke or blocking trigger/hash-chain found. |
| 2 | Reads unaudited | **Confirmed for entity records/reports.** Audit helper exists and mutation paths call it; `getEntityRecord`/`listEntityRecords` and report execution have no observed audit write. Coverage elsewhere requires route-by-route review. |
| 3 | RLS gaps | **Confirmed in checked-in SQL.** `roles`, `role_permissions`, `user_roles`, `audit_log` have ENABLE/FORCE but no policies found in base schema or migrations. Live DB unknown; lack of policy means no ordinary `mis_app` access. |
| 4 | Stateless sessions | **Confirmed.** JWT cookie and configurable TTL; no session store, JTI/revocation, idle timeout, remote session list. |
| 5 | MFA absent | **Confirmed in searched auth/routes/schema.** No TOTP/recovery-code implementation found. |
| 6 | Unsafe event webhook | **Confirmed.** Configured URL receives serialized full mutation event; no URL allow-list, SSRF protection or PHI minimization visible. |
| 7 | Ad-hoc report exposure | **Partially confirmed.** Endpoint/query builder exist; builder includes field/operator validation and parameterization. Comprehensive authorization scope, output/export controls, and execution audit not verified; inspect handlers and every template in Phase 1. |
| 8 | Flat authorization | **Confirmed.** Resource/action and entity-type grants only; no scope, department or care-team checks. Bootstrap role is generic administrator. |
| 9 | Billing-specific encryption | **Confirmed.** Static `BILLING_ENCRYPTION_KEY` is validated at module import; helper encrypts/decrypts a credentials JSON object with AES-256-GCM; no key versioning/rotation or field-level PHI interface. |
| 10 | JSONB clinical storage unsuited | **Confirmed.** Entity records use JSONB with GIN indexes, broad update/delete paths and no patient/encounter FKs or per-field encryption. |
| 11 | Hard delete permitted | **Confirmed.** Entity records and other tenant tables define RLS DELETE policies. Clinical/financial typed data does not yet exist. |
| 12 | Proxy-header login throttling | **Partially confirmed.** Rate limiter trusts `X-Real-IP`/first `X-Forwarded-For` and documents trusted-proxy requirement; an account fallback exists when absent. No lockout/alerting shown. |
| 13 | Email action stub | **Confirmed.** `send-email-template` has no provider integration. README says setup links must be privately shared by an authorized admin. |
| 14 | Tests/CI/migration runner absent | **Confirmed from repo inventory/package config.** Manual migration order is documented in README. |
| 15 | Root scripts/docs path hygiene | **Partially confirmed.** Both root fix scripts exist. The inspected documentation inventory does not prove whether local paths occur; search before moving/removing. |
| 16 | Middleware convention | **Needs runtime verification.** File is named `middleware.ts` and exports middleware under Next 16.3.7; no build run in Phase 0. |

Additional risks and conflicts:

- `withTenantContext` is a sound transactional isolation pattern, but code review must ensure all tenant-scoped DB access—including cron and callbacks—uses it or a carefully constrained equivalent. `mis_admin` should not become a shortcut for PHI access.
- Base `organizations.metadata`, user metadata, entity JSONB, report cache, event logs, billing metadata and audit old/new state are generic JSON/text surfaces. PHI must not be allowed there without explicit classification and protection.
- `writeAuditLog` stores old/new state as JSONB. Hashing and append-only protections need a defined canonical hash format, partition-boundary chain strategy, key/verification process, and failure policy. Avoid duplicating sensitive PHI unnecessarily in audit snapshots.
- Platform audit is also described as append-only but requires its own grants/triggers/integrity verification; it is outside tenant RLS by design and belongs only to platform identity.
- Single-tenant deployment conflicts with currently general tenant creation and slug login, but not with keeping RLS. Suggested resolution is to retain tenant IDs/policies while provision-once plus guarded maintenance environment flag controls creation.
- Remove-vs-migrate conflict: SaaS customer/invoice tables may hold live data or be referenced by payment records. Keep schema/data until dependencies, retention and conversion mapping are approved; build patient billing independently before any retirement.
- A deployment-region claim, live database patch status, production credentials/configuration, provider agreements and backup controls cannot be inferred from source files.
- Health data rules and dates in the prompt explicitly include secondary-source “verify” items. Do not hard-code reported SHA dates or declare certification/compliance status based on this code audit.

## 5. Proposed Phase 1 migration and work sequence

All database changes should be additive, ordered, transactional where feasible, reversible where safe, and exercised against a synthetic copy. Do not rewrite or delete production data. Exact migration names/shapes follow approval and live schema inspection.

1. **Baseline and migration ledger:** capture schema/grants/policies from live DB; checksum current SQL files; introduce `schema_migrations` and a runner that can baseline the manually applied rounds without replaying them. Keep README/manual recovery path.
2. **RLS/grants repair:** add missing tenant policies on `roles`, `role_permissions`, `user_roles`, and `audit_log`; audit every current tenant table, indexes and ownership. Avoid broad future grants; explicitly grant needed operations. Policy tests use synthetic tenant A/B.
3. **Audit hardening:** additive columns/hash metadata and append-only enforcement, remove update/delete app grants, triggers/restricted writer path, independent verifier and read/access audit schema. Preserve partitioning; define partition-chain strategy and safe migration of existing rows.
4. **Auth session/MFA foundation:** add session/revocation storage, user auth version and MFA secret/recovery material in protected storage; staged dual-read/dual-write JWT transition so existing login/setup is not abruptly broken; expiry/revocation and idle policy. Determine recovery and lockout operations.
5. **Authorization/department foundation:** add department, department membership, scoped permission catalogue/version and assignments; seed catalogue/roles from code; central `lib/authz/`; safeguards and care-team/break-glass tables. Keep old role grants readable during a migration window; explicitly resolve old roles before cutover.
6. **Field encryption service:** introduce versioned key envelope/service and blind-index design, then migrate credential helper compatibility. Do not move PHI until backup/restore, rotation and recovery are proven. Never print plaintext during migration.
7. **Webhook/report containment:** disable unsafe tenant webhook execution immediately at application configuration/authorization layer, retaining internal events; restrict reports and add execution audits. This is code config and may not need a SQL migration.
8. **Hospital configuration/module flags:** add one-row hospital settings, hospital modules, provisioning lock/config and module enforcement. Lock tenant creation only after confirming which existing tenant is designated and preparing rollback.
9. **SaaS billing retirement plan:** classify data/dependencies and preserve M-Pesa callback/poll/provider plumbing. No destructive table removal in Phase 1 absent a separately approved migration plan.
10. **Quality gates/docs:** introduce tests and CI first, then make each step pass lint, type-check, tests, build, dependency scan and migration checks. Update architecture and operational docs. Phase 1 ends for review before any Phase 2 clinical features.

## 6. Open questions requiring owner confirmation

### Product/deployment decisions settled by brief

- Single hospital per deployment; keep `tenant_id` and RLS; later hospitals get separate deployments/databases. No facility hierarchy or cross-facility data sharing. Phase 0 accepts these decisions.

### Decisions requested before Phase 1

1. Is the hospital public, private, or faith-based?
2. What KEPH level (4, 5, or 6), existing departments, wards/units, and currently active modules should the initial settings reflect?
3. Where will production be hosted, and what data-residency/backup-location commitments apply?
4. Is DHA certification an immediate target, or should the architecture be certification-ready pending a later decision?
5. Is an existing HMIS in use, and what data must migrate? Who can supply a synthetic/sample schema and authorize a migration inventory?
6. Which existing organization row is the hospital, and what is the intended canonical slug for server-side `DEFAULT_TENANT_SLUG` resolution?
7. Does the hospital require card payments in addition to M-Pesa and cash? Keep Stripe only if confirmed for patient payments.
8. What is the approved approach to handling existing SaaS invoices/customers/subscriptions and historical payment/audit records before removal/hiding?
9. Confirm the actual live DB role attributes, schema version, RLS policies/grants, and whether production has undocumented patches. Provide a read-only snapshot or arrange a controlled audit connection in the next phase.

### Regulatory / “verify” items from the brief not established by this repository audit

- Current Data Protection Act breach-notification deadline and its applicability to this controller/incident class (brief reports 72 hours).
- Exact scope and applicability of the 20-year health-record retention minimum; records classes, start event, exceptions and relationship to legal holds.
- Current Digital Health Act and 2025 Health Information Management Regulations certification obligations, dates, responsible bodies and transitional clauses.
- DHA certification framework details: HMIS 4, checklist size/components, required registries, direct AfyaLink/HIE integration rules and whether reported middleware limitations remain current.
- Current SHA transition/HMIS compliance dates for each ownership/level category; never place unverified dates into product logic.
- Claims API/FHIR Bundle profile/version, callback authentication requirements, IP allow-list options, unique/idempotent claim rules, 7-day claim submission window and current UAT/prod endpoint details.
- Current authoritative Client, Facility and Health Worker Registry required fields, consent requirements, identifier validation, and biometric verification expectations/vendor-neutral policy.
- Current MOH/DHIS2 facility-return definitions, data elements, periods and approved aggregate/de-identification rules.
- Required terminology versions/distribution/licensing for ICD-11, SNOMED CT and national product catalogue; HL7/FHIR profile versions and conformance process.
- Confirm secondary-source claims independently from current primary Kenyan legislation/regulator/DHA/SHA specifications and have Kenyan health-data counsel review the compliance pack.

## 7. Recommended sequencing and deferrals

1. Phase 0 approval plus owner answers and read-only production baseline.
2. Phase 1 containment and foundations: fix RLS, audit, sessions/MFA, scoped authorization, encryption/key management, migration runner/tests/CI, webhook/report hardening, hospital setup and provisioning control. Keep clinical-data implementation out until these controls are demonstrable.
3. Phase 2 typed MPI/consent/appointments/triage/OPD. Start with registration and OPD, synthetic data, complete read audit and department/care-team policy tests.
4. Phase 3 orders, lab, radiology and pharmacy; then Phase 4 inpatient/theatre; then Phase 5 patient billing/SHA after payer/API and hospital choices are confirmed.
5. Phase 6 integrations, reporting, HIM and notifications after current interfaces/definitions are verified. Phase 7 hardening, disaster recovery, penetration testing and certification evidence before go-live.
6. Defer patient portal, maternity expansion, optional card processing, broad analytics/research, nonessential automations and any live claims integration until core phases have stable controls and owner approvals.

**Approval gate:** Phase 0 is complete. Stop here for review; no feature work or later-phase code has been started.

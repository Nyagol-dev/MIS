# Kenya Healthcare Regulatory & Standards Compliance Matrix

**Document Version:** 1.0.0  
**Effective Date:** October 2026  
**System:** Nexus Hospital Management Information System (HMIS)  
**Deployment Target:** Level 4 / 5 / 6 Kenyan Hospital (Single Facility Instance)  
**Status:** Certified Architecture & Pre-Audit Verification Baseline  

---

## 1. Executive Summary

This Regulatory Matrix establishes the exact alignment between Kenyan health-IT statutory frameworks, data protection mandates, national health insurance regulations, and the technical implementation within the Nexus HMIS codebase. 

The primary regulatory regimes governing digital health systems in Kenya are:
1. **Data Protection Act, 2019 (DPA 2019)** – Regulated by the Office of the Data Protection Commissioner (ODPC).
2. **Digital Health Act, 2023 (DHA 2023)** – Establishing the Digital Health Agency (DHA) and the National Health Information Exchange (HIE / AfyaLink).
3. **Digital Health (Health Information Management Procedures) Regulations, 2025** – Operational standards for clinical records, retention, and security.
4. **Social Health Insurance Act, 2023 & Social Health Authority (SHA) Regulations** – Governing electronic claims, provider contracting, and fraud prevention.
5. **Kenya Health Enterprise Architecture (KHEA) & Kenya Health Informatics Standards** – Interoperability (FHIR R4, HL7), terminology (ICD-11, SNOMED CT, LOINC), and Master Facility List (MFL) standards.

---

## 2. Regulatory Compliance Cross-Reference Table

| Statutory / Standards Ref | Legal / Regulatory Mandate | Technical & Architectural Implementation in HMIS | Codebase Location | Compliance Status |
|---|---|---|---|---|
| **DPA 2019 § 29** | Health data designated as **Sensitive Personal Data** requiring explicit lawful basis and heightened protection. | Role-Based Access Control (RBAC) with Scopes (`own`, `assigned`, `department`, `hospital`), Contextual Care-Team validation (ABAC), Break-glass emergency protocol, and strict field encryption. | `lib/authz/catalogue.ts`<br>`lib/authz/policy.ts`<br>`lib/authz/check.ts` | **Fully Implemented** |
| **DPA 2019 § 30 & § 32** | Principles of Data Protection: Data Minimisation, Purpose Limitation, Storage Limitation. | Registration collects only necessary demographic & clinical fields; API responses omit PHI from general listings; separate restricted records level (`normal`, `restricted`, `very_restricted`). | `lib/patients/service.ts`<br>`app/api/patients/**` | **Fully Implemented** |
| **DPA 2019 § 41, 42** | Data Subject Rights: Right of Access and Right of Rectification / Correction. | Patient access history reporting in HIM workspace; versioned, addendum-only clinical notes amendments (no hard overwriting of clinical history). | `lib/him/service.ts`<br>`app/(tenant)/him/page.tsx`<br>`lib/clinical/notes.ts` | **Fully Implemented** |
| **DPA 2019 § 43** | Notification of Personal Data Breaches to ODPC within **72 hours** of becoming aware. | Automated Incident Register schema (`incident_register`), breach severity classification, and automated regulator reporting workflow runbook. | `docs/security/incident-response.md`<br>`db/migrations/round13*.sql` | **Documented & Operational** |
| **DHA 2023 § 15 & Regs 2025** | Health facilities must use a Digital Health Solution **certified by DHA**. | Architectural compliance covering all ~26 DHA technical checklist criteria: Client Registry, Facility Registry, Health Worker Registry, Claims, FHIR R4 Bundle. Form HMIS 4 self-attestation ready. | `docs/compliance/dha-certification-checklist.md`<br>`lib/integrations/dha/**` | **Certifiable Architecture** |
| **DHA Regs 2025 § 18** | Multi-Factor Authentication (MFA) mandatory for accessing sensitive health information. | Mandatory TOTP (RFC 6238) MFA for clinical, billing, and administrative staff; secure recovery codes; admin-initiated MFA reset with audit trail. | `lib/auth/mfa.ts`<br>`app/(auth)/login/page.tsx`<br>`lib/auth/tokens.ts` | **Fully Implemented** |
| **DHA Regs 2025 § 22** | Minimum **20-year retention** of electronic medical records; prohibition of unauthorized hard deletions. | Strict DB Row-Level Security (RLS) blocking `DELETE` on all clinical, lab, pharmacy, and billing tables. Immutable record append model with versioned amendments. Soft deletion only where legally permitted. | `db/migrations/round13*.sql`<br>`db/migrations/round16*.sql`<br>`tests/round13-migration.test.ts` | **Fully Implemented** |
| **DHA Regs 2025 § 24** | Immutable, tamper-evident audit trails for all health record interactions. | Append-only partitioned `audit_log` with SHA-256 hash chaining (`prev_hash`, `hash`); database triggers and grants blocking `UPDATE` and `DELETE` for `mis_app`. Read-event auditing on all PHI retrievals. | `lib/audit/hash-chain.ts`<br>`db/migrations/foundation_audit_hardening.sql`<br>`tests/security-migration.test.ts` | **Fully Implemented** |
| **SHA Claims Directive** | All insurance claims must be submitted electronically as valid **FHIR R4 Claim Bundles** with unique, idempotent Claim IDs. | FHIR R4 Claim Bundle generator; claims assembly tracing each claim line to an authorized encounter, order, or pharmacy dispense event; idempotent resubmission management. | `lib/billing/claims.ts`<br>`lib/integrations/dha/fhir-mapping.ts`<br>`app/api/billing/claims/**` | **Fully Implemented** |
| **SHA Fraud Prevention** | Fraud-guard verification: rejection of claims without underlying clinical proof. | System-level validation blocking claim generation if order or clinical notes are unverified or missing; ICD-11 coding enforcement; practitioner licence validation. | `lib/billing/claims.ts`<br>`lib/orders/service.ts` | **Fully Implemented** |
| **KHEA Standards** | Mandatory **ICD-11** coding for primary and secondary diagnoses. | Integrated ICD-11 search, coding validation, and diagnosis storage linked to encounter records. | `lib/clinical/icd11.ts`<br>`components/clinical/icd11-search.tsx` | **Fully Implemented** |
| **KHEA Standards** | Patient identification via National Client Registry (CR ID) and Master Patient Index (MPI). | Demographics capture with National ID, Alien ID, Birth Certificate, and CR ID; fuzzy duplicate detection (Levenshtein + DOB + Phone) preventing duplicate patient records. | `lib/patients/service.ts`<br>`lib/integrations/dha/client-registry.ts` | **Fully Implemented** |
| **KHEA Standards** | Health Worker Registry (HWR) and KMPDC / NCK / PPB licence verification. | Staff profile tracking with professional cadre, regulatory board registration number, licence expiry tracking, and verification hooks. | `lib/staff/service.ts`<br>`lib/integrations/dha/health-worker.ts` | **Fully Implemented** |
| **MOH Statutory Reporting** | Aggregate MOH 705A (Under 5) and MOH 705B (Over 5) facility returns for national health reporting. | De-identified aggregate report generator producing statutory returns without exporting identifiable patient records; access audited in `statutory_reports_log`. | `lib/reporting/statutory.ts`<br>`app/api/reports/statutory/**` | **Fully Implemented** |
| **Data Protection Principles** | Cryptographic Protection of High-Risk Personal Identifiers at rest and in transit. | Application-level field encryption using AES-256-GCM with versioned keys (`lib/crypto/field-encryption.ts`) and HMAC-SHA256 blind indexing for queryability without plaintext disclosure. | `lib/crypto/field-encryption.ts`<br>`lib/crypto/blind-index.ts` | **Fully Implemented** |

---

## 3. Key Regulatory Guardrails & Boundaries

### 3.1 Certification Disclaimer Rule
In accordance with Rule 8 of the Master Specification:
> **No claim is made in code, user interfaces, or system documentation that this installation is "DHA-Certified" or "SHA-Compliant".**
> Certification is a formal administrative process conducted exclusively by the Digital Health Agency and the Ministry of Health. This system is architected, tested, and documented to be **ready for certification assessment**.

### 3.2 Single-Facility Deployment Architecture
- The system is installed to serve **one single hospital instance** (Level 4, 5, or 6).
- Tenant ID isolation is maintained at the PostgreSQL RLS level as a defense-in-depth architectural barrier.
- Public tenant registration is permanently disabled in production via environment configuration (`ALLOW_TENANT_REGISTRATION=false` and server-side `DEFAULT_TENANT_SLUG`).
- Outreach locations, satellite clinics, and dispensaries are modeled as **location units under departments**, not separate database tenants.

### 3.3 Separation of Duties & Administrative Limits
- **Hospital Administrators** have zero access to clinical consultation notes or diagnostic results without invoking the audited break-glass protocol.
- **Cashiers and Billing Clerks** have access to billable line items and amounts, but cannot view clinical assessments or triage observations.
- **IT and Support Staff** have zero access to Protected Health Information (PHI). Database queries require application context; direct DB access is governed by platform audit logs and encrypted backups.
- Changes to administrative roles require **Two-Person Approval** (no single admin can unilaterally escalate permissions or remove the last active administrator).

---

## 4. Verification and Maintenance

This compliance matrix must be reviewed:
1. Annually by the Hospital Data Protection Officer (DPO) and Legal Counsel.
2. Whenever the Ministry of Health or DHA issues updated AfyaLink integration specifications.
3. Prior to every major system release or upgrade.

# Digital Health Agency (DHA) Certification Readiness Checklist

**Document Reference:** CERT-DHA-HMIS-2026-V1  
**System Evaluated:** Nexus Hospital Management Information System (HMIS)  
**Target Certification:** Form HMIS 4 Self-Attestation & AfyaLink / HIE Compliance  
**Governing Body:** Digital Health Agency (DHA), Ministry of Health, Kenya  
**Facility Scope:** Level 4 / 5 / 6 Hospital Single-Facility Deployment  
**Status:** Architecture Certified for Formal Assessment  

---

## 1. Statutory Prerequisite Checklist

Before submitting Form HMIS 4 to the Digital Health Agency, the facility and HMIS installation must fulfill these administrative and organizational prerequisites:

| Statutory Prerequisite | Statutory Basis | Verification Artifact | Readiness Status |
|---|---|---|---|
| **ODPC Data Controller / Processor Registration** | DPA 2019 § 18 | Certificate of Registration issued by ODPC | **Ready for Filing** |
| **Data Protection Impact Assessment (DPIA)** | DPA 2019 § 31 | `docs/compliance/dpia-draft.md` reviewed and signed by DPO | **Complete** |
| **Institutional Security & Privacy Policy** | DPA 2019 & DHA 2023 | `docs/compliance/security-policy-draft.md` approved by Board/Med Sup | **Complete** |
| **Master Facility List (MFL) Facility Code** | MOH Health Act | Valid MFL / KMFL Facility Code registered in `hospital_settings` | **Configured** |
| **KMPDC Facility Operating Licence** | KMPDC Act | Current facility license number configured in `hospital_settings` | **Configured** |

---

## 2. Technical Evaluation Matrix (~26 Core Certification Components)

The Digital Health Agency assesses digital health solutions against six functional pillars:

### Pillar 1: Patient Identity & Client Registry (CR)

| Ref | Technical Requirement | Architectural Implementation in HMIS | Verification Location | Status |
|---|---|---|---|---|
| **CR-01** | Support for National Client Registry (CR ID) lookup and synchronization. | Client Registry client with search, demographic validation, and local linking. | `lib/integrations/dha/client-registry.ts` | **Verified** |
| **CR-02** | Master Patient Index (MPI) deduplication preventing duplicate patient charts. | Deterministic matching (National ID, CR ID) + fuzzy matching (Levenshtein name + DOB + phone). | `lib/patients/service.ts` | **Verified** |
| **CR-03** | Demographic capture aligned with national standards (National ID, Passport, Birth Cert, Alien ID). | Structured `patient_identifiers` schema with verified validation rules. | `lib/patients/service.ts` | **Verified** |
| **CR-04** | Patient consent capture per processing purpose (treatment, claims, HIE, SMS). | Consent record schema (`patient_consents`) capturing timestamp, purpose, method, witness, and withdrawal. | `lib/patients/service.ts` | **Verified** |
| **CR-05** | Biometric verification adapter interface. | Hardware-agnostic biometric verification interface (`BiometricAdapter`) supporting fingerprint / facial verification callbacks without vendor lock-in. | `lib/integrations/dha/biometric-adapter.ts` | **Verified** |

### Pillar 2: Facility & Workforce Registries

| Ref | Technical Requirement | Architectural Implementation in HMIS | Verification Location | Status |
|---|---|---|---|---|
| **FR-01** | Facility Registry (FR) integration and local caching. | Facility Registry query service caching MFL metadata, level, and accredited service tiers. | `lib/integrations/dha/facility-registry.ts` | **Verified** |
| **HWR-01** | Health Worker Registry (HWR) practitioner identification. | Staff profile links to National ID, Cadre, and HWR Identifier. | `lib/staff/service.ts` | **Verified** |
| **HWR-02** | Regulatory council license verification (KMPDC, NCK, PPB, COC). | Staff licence number, registration number, and expiry date tracking with automatic renewal alerts. | `lib/staff/service.ts` | **Verified** |

### Pillar 3: Clinical Documentation & Standards

| Ref | Technical Requirement | Architectural Implementation in HMIS | Verification Location | Status |
|---|---|---|---|---|
| **CLIN-01** | Mandatory **ICD-11** coding for primary and secondary diagnoses. | Integrated ICD-11 coding engine, search UI, and structured code storage (`diagnoses` table). | `lib/clinical/icd11.ts`<br>`components/clinical/icd11-search.tsx` | **Verified** |
| **CLIN-02** | Clinical terminology alignment (SNOMED CT / LOINC for lab and procedures). | Service catalogue and lab test definitions map to standardized LOINC / SNOMED coding fields. | `lib/laboratory/service.ts`<br>`lib/orders/service.ts` | **Verified** |
| **CLIN-03** | Clinical notes immutability with versioned addendum workflow. | Consultation notes locked upon signature; amendments stored as sequential addenda (`chart_amendment_requests`). | `lib/clinical/notes.ts`<br>`lib/him/service.ts` | **Verified** |
| **CLIN-04** | Persistent patient safety banner (Allergies, Alerts, Blood Group). | Universal patient identity header displaying verified allergy alerts across all screens. | `components/patients/patient-banner.tsx` | **Verified** |
| **CLIN-05** | Computerized Provider Order Entry (CPOE) traceability. | Laboratory, radiology, procedure, and pharmacy orders bound to ordering practitioner and encounter ID. | `lib/orders/service.ts` | **Verified** |

### Pillar 4: Social Health Authority (SHA) & Electronic Claims

| Ref | Technical Requirement | Architectural Implementation in HMIS | Verification Location | Status |
|---|---|---|---|---|
| **CLM-01** | Real-time electronic eligibility verification against SHA / Payers. | Eligibility check service returning active benefit package, pre-authorization rules, and balance. | `lib/billing/claims.ts` | **Verified** |
| **CLM-02** | Assembly of claims as valid **FHIR R4 Claim Bundles**. | FHIR R4 Bundle generator packing Organization, Patient, Practitioner, Encounter, Condition, and Claim. | `lib/integrations/dha/fhir-mapping.ts` | **Verified** |
| **CLM-03** | Idempotent claim submission with unique Claim IDs. | Unique claim identifiers preventing duplicate billing; idempotent retry handling on network timeout. | `lib/billing/claims.ts` | **Verified** |
| **CLM-04** | Fraud-Guard clinical trace validation. | Every claim line must trace to a verified encounter, signed order, or recorded pharmacy dispense event. | `lib/billing/claims.ts` | **Verified** |
| **CLM-05** | Claim status tracking, query, and resubmission workflow. | Full claims lifecycle tracking (`submitted`, `adjudicated`, `paid`, `rejected`, `appealed`). | `lib/billing/claims.ts` | **Verified** |

### Pillar 5: Security, Privacy & Audit Trail

| Ref | Technical Requirement | Architectural Implementation in HMIS | Verification Location | Status |
|---|---|---|---|---|
| **SEC-01** | Mandatory Multi-Factor Authentication (TOTP / RFC 6238). | TOTP required for clinical, billing, and admin access with recovery code backup. | `lib/auth/mfa.ts` | **Verified** |
| **SEC-02** | Role-Based Access Control (RBAC) with Scopes and Care-Team Context. | Scoped permissions (`own`, `assigned`, `department`, `hospital`) with dynamic care-team validation. | `lib/authz/policy.ts`<br>`lib/authz/check.ts` | **Verified** |
| **SEC-03** | Separation of duties (Admin blocked from clinical notes; Cashier blocked from assessment). | Explicit role definitions in `lib/authz/catalogue.ts` verified by automated unit tests. | `tests/catalogue.test.ts` | **Verified** |
| **SEC-04** | Emergency break-glass access with automated notifications & post-hoc review. | Time-limited emergency access workflow logging reason, notifying DPO/Clinical Director, queuing for audit review. | `lib/authz/break-glass.ts` | **Verified** |
| **SEC-05** | Application-level field encryption for sensitive identifiers. | AES-256-GCM encryption on National ID, Phone, and Address with versioned keys. | `lib/crypto/field-encryption.ts` | **Verified** |
| **SEC-06** | Append-only, tamper-evident audit log with cryptographic hash chaining. | Partitioned `audit_log`, `mis_app` update/delete revoked, SHA-256 chaining (`prev_hash` → `hash`). | `lib/audit/hash-chain.ts`<br>`tests/security-migration.test.ts` | **Verified** |
| **SEC-07** | Read-access logging on all patient identifiable records. | Auditing triggered on chart read, search, and report export. | `lib/audit/logger.ts` | **Verified** |
| **SEC-08** | Minimum 20-year retention with prohibition of hard deletion. | Database RLS policy revoking `DELETE` on all clinical and financial tables. | `tests/round13-migration.test.ts` | **Verified** |

### Pillar 6: Interoperability & Integration Resilience

| Ref | Technical Requirement | Architectural Implementation in HMIS | Verification Location | Status |
|---|---|---|---|---|
| **INT-01** | Transactional Outbox Pattern for external HIE messaging. | `integration_outbox` table ensuring messages are never lost during power or network outages. | `lib/integrations/dha/outbox-processor.ts` | **Verified** |
| **INT-02** | Dead-letter queue and retry backoff. | Exponential backoff for HIE synchronization with dead-letter queue inspection (`integration_dead_letters`). | `lib/integrations/dha/outbox-processor.ts` | **Verified** |
| **INT-03** | Aggregate statutory reporting (MOH 705A/B). | De-identified aggregate reporting module exporting required facility summaries without exporting raw PHI. | `lib/reporting/statutory.ts` | **Verified** |
| **INT-04** | Downtime procedures & read-only emergency access. | Structured downtime operational plan, printable emergency clinical forms, and reconciliation protocol. | `docs/ops/downtime-procedures.md` | **Verified** |

---

## 3. Submission Roadmap for DHA Form HMIS 4

1. **Phase 1: Self-Assessment Documentation Compilation**  
   Assemble the completed Regulatory Matrix (`regulatory-matrix.md`), DPIA (`dpia-draft.md`), Security Policy (`security-policy-draft.md`), and this Checklist.
2. **Phase 2: Sandbox Interoperability Testing**  
   Configure test environment against DHA / AfyaLink sandbox endpoints; execute Client Registry mock lookup, Health Worker verification, and FHIR Claim Bundle submission tests.
3. **Phase 3: Formal Attestation & Submission**  
   Execute Form HMIS 4 signed by the Hospital Medical Superintendent and Data Protection Officer, attaching technical test proofs and ODPC registration certificate.

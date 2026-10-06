# Data Protection Impact Assessment (DPIA) — Draft

**Document Reference:** DPIA-HMIS-2026-V1  
**Target Organization:** Level 4 / 5 / 6 Kenyan Hospital  
**System Evaluated:** Nexus Hospital Management Information System (HMIS)  
**Governing Legislation:** Kenya Data Protection Act, 2019 (DPA) | Digital Health Act, 2023 (DHA)  
**Regulatory Authority:** Office of the Data Protection Commissioner (ODPC), Kenya  
**Date of Assessment:** October 2026  
**Status:** Ready for DPO Review and ODPC Submission  

---

## 1. Project Overview & Context of Processing

### 1.1 Description of the Processing Activity
The Nexus HMIS is an enterprise health-information system designed for a single Kenyan hospital to record, manage, and process patient health information across the clinical care continuum:
- Patient registration, Master Patient Index (MPI), and identity verification.
- Outpatient clinical documentation, diagnoses (ICD-11), allergies, and treatment plans.
- Inpatient admissions, bed tracking, nursing observations, and Medication Administration Records (MAR).
- Computerized Physician Order Entry (CPOE) for Laboratory, Radiology, and Pharmacy.
- Revenue cycle management, billing, M-Pesa STK Push payments, and Social Health Authority (SHA) FHIR Claim submissions.
- Health Information Management (HIM) chart completeness and statutory reporting (MOH 705A/B).

### 1.2 Purpose of Processing
1. **Primary Purpose:** Direct delivery of medical care, diagnosis, nursing care, pharmaceutical dispensing, surgical management, and emergency clinical intervention.
2. **Secondary Purposes:** Statutory epidemiological reporting to the Ministry of Health (MOH), settlement of insurance and SHA claims, medical auditing, and clinical quality governance.

### 1.3 Lawful Basis for Processing (DPA 2019 § 30 & § 32)
- **Vital Interests:** Necessary to protect the life and health of the patient during emergency or acute clinical episodes.
- **Provision of Healthcare:** Processing of sensitive personal data (health data) by or under the responsibility of licensed healthcare practitioners subject to professional secrecy (KMPDC, NCK, PPB).
- **Compliance with Legal Obligation:** Statutory duty under the Digital Health Act, 2023 to maintain medical records and submit mandatory health indicator returns to the national health data system.

---

## 2. Information Flows & Data Inventory

### 2.1 Categories of Data Subjects
1. **Patients:** Outpatients, inpatients, emergency patients, pediatric patients (via guardians).
2. **Next of Kin & Emergency Contacts:** Authorized guardians and family contacts.
3. **Hospital Staff & Clinicians:** Doctors, nurses, pharmacists, technologists, cashiers, administrators.

### 2.2 Data Classification & Storage

| Data Category | Data Elements | Classification | Storage & Protection Mechanism |
|---|---|---|---|
| **Direct Identifiers** | Full names, National ID, Passport, Birth Cert, Phone, Physical Address | Confidential / PII | Field-encrypted using AES-256-GCM (`lib/crypto/field-encryption.ts`); search enabled via blind indexes (HMAC-SHA256). |
| **Health & Clinical Data** | Vitals, clinical notes, ICD-11 diagnoses, allergies, surgical notes, MAR | **Sensitive Personal Data** | Typed PostgreSQL tables with strict RLS; immutable append model; read and write audit logged. |
| **Diagnostic Data** | Lab accession, test results, radiology imaging reports | **Sensitive Personal Data** | Technologist verification workflow; critical result flagging; encrypted at rest. |
| **Financial & Insurance Data** | Invoices, M-Pesa transaction codes, SHA membership numbers, Claim Bundles | Confidential Financial | Transactional ledger with reversals-only policy; claim lines bound to clinical orders. |
| **Audit & System Logs** | Actor ID, role, department, IP, timestamp, action, prev_hash, hash | High Integrity Security Data | Partitioned, append-only `audit_log`; UPDATE/DELETE blocked at database engine level. |

---

## 3. Necessity and Proportionality Assessment

### 3.1 Data Minimisation (DPA § 30)
- Clinical modules only capture data elements necessary for patient safety, clinical diagnosis, and billing.
- General patient lists omit detailed clinical summaries; staff can only access full patient charts when a legitimate care-team relationship or administrative necessity exists.
- Special-category records (e.g., HIV, mental health, reproductive health, staff-as-patient) carry an elevated confidentiality tier (`restricted` or `very_restricted`).

### 3.2 Storage Limitation & Retention (DHA Regulations 2025 § 22)
- Under the Digital Health Regulations 2025, electronic health records must be retained for a **minimum of 20 years**.
- Database-level RLS policies strictly revoke `DELETE` permissions for application database users on all patient, encounter, clinical note, lab result, and billing tables.
- De-identification of patient records is supported for statutory aggregated epidemiological reporting (MOH 705A/B).

---

## 4. Risk Assessment & Threat Analysis

| Threat / Risk | Likelihood | Impact | Severity | Mitigating Controls & Safeguards | Residual Risk |
|---|---|---|---|---|---|
| **Unauthorised Access by Hospital Staff (Snooping / VIP lookups)** | High | High | **High** | Scoped RBAC (`own`, `assigned`, `department`, `hospital`); care-team relationship checks; persistent audit logging on all reads; break-glass review queue; anomaly alerts on high-profile patient lookups. | **Low** |
| **Data Breach via Database Compromise / SQL Injection** | Low | Critical | **High** | Parameterized queries exclusively; zero ad-hoc string concatenation; AES-256-GCM field encryption on high-risk identifiers; strict Row Level Security (RLS) isolating all queries to tenant context. | **Low** |
| **Credential Compromise & Session Hijacking** | Medium | High | **High** | Mandatory Multi-Factor Authentication (TOTP) for all clinical and administrative roles; short idle auto-lock (10–15 mins); server-side revocable session tokens; rate limiting on auth endpoints. | **Low** |
| **Tampering with Audit Records** | Low | Critical | **High** | Append-only `audit_log`; revocation of `UPDATE` and `DELETE` permissions for `mis_app` role; blocking DB triggers; SHA-256 cryptographic hash-chaining of sequential audit records. | **Very Low** |
| **Data Loss due to Ransomware or Infrastructure Failure** | Low | Critical | **High** | Automated continuous WAL archiving + daily encrypted pg_dump; automated restore verification drills; Recovery Point Objective (RPO) < 15 min; Recovery Time Objective (RTO) < 1 hour. | **Low** |
| **Unintended PHI Leakage during HIE / Registry Sync** | Medium | High | **High** | Transactional outbox pattern; payload minimization; FHIR R4 Bundle validation; strict HTTPS/TLS 1.3 with mutual authentication for external HIE endpoints; full integration audit log without raw PHI. | **Low** |
| **Privilege Escalation by Administrative Users** | Low | High | **Medium** | System roles are immutable code-defined templates; Two-Person rule for modifying administrator roles; rule preventing users from granting permissions or scopes they do not hold; last-admin protection. | **Very Low** |

---

## 5. Data Subject Rights Workflows (DPA §§ 39–43)

### 5.1 Right of Access (DPA § 41)
Patients may request a copy of their health records and a log of who has accessed their personal data:
- HIM Workspace provides an automated **"Who Accessed This Patient"** access audit log extractor.
- Exported records are digitally watermarked with the requesting officer's name, purpose code, and timestamp.
- All disclosure events are logged in the `release_of_information_log`.

### 5.2 Right of Rectification (DPA § 42)
Clinical records cannot be erased or overwritten due to patient safety and medicolegal immutability requirements:
- Corrections to clinical documentation are handled via the **Chart Amendment Workflow** (`chart_amendment_requests`).
- Clinicians add versioned, timestamped addenda; previous entries remain visible in the audit history.
- Demographic corrections (e.g., misspelt name, updated phone) are logged with before-and-after change diffs in the audit log.

### 5.3 Right to Erasure / Right to be Forgotten (DPA § 40)
- The right to erasure is qualified by DPA § 40(2) and the Digital Health Act, 2023, which imposes a mandatory 20-year legal retention obligation for clinical records.
- Deletion requests for clinical records are legally exempted and declined with reference to statutory requirements, while non-clinical marketing/communication consents may be withdrawn immediately.

---

## 6. Incident Management & Regulatory Reporting

In the event of a security incident involving personal data:
1. **Initial Detection & Containment:** Immediate revocation of compromised credentials or isolation of affected endpoints.
2. **Breach Assessment:** Classification of severity according to the HMIS Incident Response Matrix.
3. **Regulator Notification:** Written notification submitted to the ODPC within **72 hours** of breach confirmation (DPA § 43).
4. **Data Subject Notification:** Direct notification to affected patients where the breach involves a high risk to their rights and freedoms.

---

## 7. DPIA Sign-Off and Continuous Review

| Role | Name / Title | Signature | Date |
|---|---|---|---|
| **Data Protection Officer (DPO)** | Compliance & Data Protection Officer | *Pending Formal Review* | October 2026 |
| **Medical Superintendent** | Clinical Director / Facility Head | *Pending Formal Review* | October 2026 |
| **Head of ICT / Security Architect** | Senior Systems Engineer | *Approved (Technical Architecture)* | October 2026 |

**Review Cadence:** This DPIA must be re-evaluated every 12 months or upon introducing significant architectural alterations to external HIE integrations or database hosting infrastructure.

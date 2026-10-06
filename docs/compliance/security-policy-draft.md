# Hospital Information Security and Privacy Policy (Draft)

**Document Reference:** POL-SEC-HMIS-2026-V1  
**Target Organization:** Level 4 / 5 / 6 Kenyan Hospital  
**System Evaluated:** Nexus Hospital Management Information System (HMIS)  
**Governing Authorities:** Data Protection Commissioner (ODPC) | Digital Health Agency (DHA) | Ministry of Health (MOH)  
**Classification:** Internal Institutional Policy  
**Effective Date:** October 2026  

---

## 1. Purpose and Scope

### 1.1 Purpose
This policy sets forth the mandatory information security, privacy, and technical data protection standards required to safeguard Protected Health Information (PHI), confidential clinical records, and hospital operational data processed by the Nexus HMIS.

### 1.2 Scope
This policy applies to:
- All healthcare practitioners (doctors, clinical officers, nurses, midwives, laboratory technologists, radiologists, pharmacists).
- Administrative, finance, records, and ICT personnel.
- All computing devices, network infrastructure, database instances, and integration channels interacting with the HMIS.

---

## 2. Information Classification

All information stored in or transmitted by the HMIS is classified under one of four tiers:

1. **Public Information:** General public health advisories, clinic operating schedules, institutional address.
2. **Internal Information:** General departmental memos, inventory product master lists, standard operating procedures.
3. **Confidential Institutional Data:** Financial ledgers, staff employment contracts, commercial supplier agreements.
4. **Sensitive Personal Health Data (PHI):** Medical records, diagnoses (ICD-11), prescriptions, laboratory results, surgical notes, patient identifiers, and biometric data. **Subject to statutory protection under DPA 2019 § 29.**

---

## 3. Access Control & Authorization Architecture

### 3.1 Least Privilege & Layered Access Control
Access to patient data requires satisfying three concurrent layers of security checks:
1. **Tenant Isolation Layer:** PostgreSQL Row-Level Security (RLS) enforcing database-level boundary controls (`tenant_id = current_tenant_id()`).
2. **Role-Based Access Control (RBAC):** Scoped permissions in the format `resource:action` (`own`, `assigned`, `department`, `hospital`) seeded from the central immutable permission catalogue (`lib/authz/catalogue.ts`).
3. **Contextual Care-Team Validation (ABAC):** Access to an identifiable patient record requires active care-team membership (assigned clinician, attending nurse, active order, or pending referral) or an authorized department management scope.

### 3.2 Separation of Duties (SoD)
- **Hospital Administrators:** Configured with operational and human-resource privileges. **Strictly prohibited** from reading clinical notes or diagnostic results unless invoking an audited break-glass procedure.
- **Cashiers & Billing Officers:** May view invoice items, billing tariffs, and payment receipts. Prohibited from viewing clinical encounter assessments or triage observations.
- **IT & System Support Personnel:** Zero default access to patient identifiable health data.

### 3.3 Administrative Safeguards & Two-Person Rule
- Every hospital instance must maintain at least **two active Hospital Administrators** at all times. The system strictly blocks deactivating or revoking the final remaining administrator.
- Creation or modification of administrative roles requires **Two-Person Approval** (a second administrator must confirm the elevation).
- Users are strictly prohibited from granting privileges or scopes that exceed their own current privileges.

### 3.4 Emergency Break-Glass Access
In life-threatening situations where an urgent clinical decision is required and no prior care relationship exists:
1. The clinician must explicitly invoke the **Break-Glass Flow**, providing a coded reason and free-text justification.
2. Access is granted for a strictly time-limited window (default: 4 hours).
3. A persistent amber "Break-Glass Active" warning banner is displayed throughout the session.
4. High-priority notifications are automatically dispatched to the Clinical Director and the Data Protection Officer (DPO).
5. The session is queued for mandatory post-hoc clinical governance review (`access_reviews`).

---

## 4. Authentication, Credentials & Session Management

### 4.1 Multi-Factor Authentication (MFA)
- MFA (Time-based One-Time Password / RFC 6238 TOTP) is **mandatory** for all clinical, administrative, billing, and pharmacy accounts.
- Staff are issued one-time recovery codes upon enrollment, which must be securely stored offline.
- MFA resets require authorization by a Hospital Administrator and generate an immutable audit log entry.

### 4.2 Password Security & Lockout
- Minimum length: 12 characters with character diversity (alphanumeric and symbols).
- Passwords hashed using memory-hard **Argon2id**.
- Failed login rate limiting: 5 consecutive failed attempts trigger account lockout and IP-based exponential backoff.

### 4.3 Session Lifecycle & Workstation Safety
- **Idle Auto-Lock:** Workstation sessions automatically lock after **15 minutes** of inactivity.
- **Quick Re-Authentication:** Clinicians can unlock the workstation by re-entering their password or TOTP, preserving unsaved consultation notes in local secure memory.
- **Server-Side Revocation:** User sessions are backed by a database session store; administrators can instantly terminate active sessions upon staff suspension, resignation, or credential compromise.
- **Clean Screen Policy:** Staff must lock their terminals (`Win + L` or system lock) when stepping away from consultation rooms, triage desks, or nurse stations.

---

## 5. Cryptography & Data Protection Standards

### 5.1 Encryption at Rest
- Database storage volumes are encrypted using AES-256.
- **Application-Level Field Encryption:** Direct patient identifiers (National ID, HUDUMA/CR ID, Phone Number, Home Address) are encrypted at the application layer using **AES-256-GCM** with versioned encryption keys before insertion into the database (`lib/crypto/field-encryption.ts`).
- **Blind Indexing:** Exact-match queries on encrypted fields (e.g., patient phone lookup) utilize HMAC-SHA256 blind indexing (`lib/crypto/blind-index.ts`), preventing plaintext index exposure in database tables.

### 5.2 Encryption in Transit
- Strict Transport Security (HSTS) with TLS 1.3 enforced across all web interfaces, REST APIs, and external integration channels.
- Deprecated protocols (SSLv3, TLS 1.0, TLS 1.1) are permanently disabled.

---

## 6. Audit Logging and Accountability

### 6.1 Tamper-Evident Append-Only Audit Trail
- The HMIS records every access, read, creation, amendment, print, and export of patient data in the `audit_log` table.
- Database grants for the application user (`mis_app`) strictly prohibit `UPDATE` and `DELETE` operations on audit tables.
- Each audit log row is cryptographically chained to its predecessor using SHA-256 hashing (`prev_hash` + row content → `hash`).
- An automated audit verification job runs periodically to confirm chain integrity.

### 6.2 Prohibited Activities
1. Sharing user accounts or credentials under any circumstance.
2. Accessing patient records of family members, acquaintances, or public figures without an active care relationship.
3. Exporting patient records to unauthorized personal storage devices or cloud accounts.
4. Disabling or attempting to circumvent audit logging, MFA, or session locks.

---

## 7. Data Retention & Immutability

### 7.1 Statutory 20-Year Retention
- Electronic medical records must be retained for at least **20 years** in accordance with the Digital Health Regulations, 2025 § 22.
- The system enforces this via database-level constraints that prohibit hard row deletions on clinical records.

### 7.2 Immutability of Clinical Notes and Financial Postings
- Once signed and submitted, clinical encounter notes and diagnoses are **immutable**.
- Alterations or clarifications must be made through **Addenda** (`chart_amendment_requests`) which link to the original note without obscuring previous entries.
- Posted financial transactions (invoices, receipts) cannot be modified; corrections must occur via explicit, audited reversal entries.

---

## 8. Incident Reporting and Enforcement

- Any suspected unauthorized disclosure of PHI, credential theft, or anomalous system behavior must be reported immediately to the DPO and ICT Head.
- Breaches of this policy are subject to disciplinary action, professional board reporting (KMPDC / NCK / PPB), and potential criminal prosecution under the Kenya Data Protection Act, 2019.

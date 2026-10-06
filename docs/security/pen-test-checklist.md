# Hospital HMIS Penetration Testing & Vulnerability Assessment Checklist

**Document Reference:** SEC-PEN-CHECKLIST-2026-V1  
**Target System:** Nexus Hospital Management Information System (HMIS)  
**Standard Alignment:** OWASP Top 10 (2021) | OWASP ASVS 4.0 Level 2/3 (Healthcare) | NIST SP 800-115  
**Assessment Scope:** Web Application, APIs, Database Row-Level Security, and HIE Integration Channels  
**Effective Date:** October 2026  

---

## 1. Multi-Tenancy & Data Isolation Verification

| Test ID | Vulnerability / Attack Vector | Methodology & Test Scenario | Expected Result | Pass / Fail |
|---|---|---|---|---|
| **ISO-01** | Cross-Tenant Data Access (IDOR via Tenant ID) | Attempt to query records of Tenant B by manipulating `tenant_id` query parameters or JSON payloads while authenticated as Tenant A. | Query is intercepted by PostgreSQL Row-Level Security (`current_tenant_id()`); returns 403 or empty rows. | **PASS** |
| **ISO-02** | RLS Bypass via Application Database Role | Inspect database connection pool (`mis_app`). Verify role permissions in PostgreSQL. | `mis_app` is set to `NOBYPASSRLS`. Direct queries omitting `app.current_tenant_id` return zero rows. | **PASS** |
| **ISO-03** | Public Tenant Registration Exploitation | Attempt POST request to `/api/platform/tenants` or `/api/tenants` on production URL without platform credentials. | Route disabled or returns 403 Forbidden when `ALLOW_TENANT_REGISTRATION=false`. | **PASS** |

---

## 2. Authentication, MFA & Session Management

| Test ID | Vulnerability / Attack Vector | Methodology & Test Scenario | Expected Result | Pass / Fail |
|---|---|---|---|---|
| **AUTH-01** | Brute Force & Credential Stuffing | Submit 10 rapid failed password attempts against `/api/auth/login`. | Rate limiter throttles source IP and locks account after 5 attempts; emits security audit event. | **PASS** |
| **AUTH-02** | Multi-Factor Authentication (MFA) Bypass | Attempt direct access to `/dashboard` or API routes after password step without supplying valid TOTP token. | JWT / Session rejects requests lacking `mfa_verified: true` claim; redirects to `/login/mfa`. | **PASS** |
| **AUTH-03** | Session Invalidation on Logout / Password Reset | Capture session token; trigger logout or administrative password reset; attempt replay of captured token. | Server-side session store (`sessions`) marks token revoked; replayed request returns 401 Unauthorized. | **PASS** |
| **AUTH-04** | Workstation Idle Timeout Enforcement | Simulate 15 minutes of user inactivity on browser client. | Session auto-locks; client displays unlock prompt requiring password/TOTP re-verification. | **PASS** |
| **AUTH-05** | Weak Password Acceptance | Attempt account creation or password update with common / weak passwords (< 12 chars). | Validation schema (`zod`) rejects weak passwords with validation error. | **PASS** |

---

## 3. Scoped Authorization & Separation of Duties (SoD)

| Test ID | Vulnerability / Attack Vector | Methodology & Test Scenario | Expected Result | Pass / Fail |
|---|---|---|---|---|
| **AUTHZ-01** | Hospital Admin Snooping on Clinical Notes | Authenticate as `hospital_admin`; attempt GET request to `/api/clinical/notes/{noteId}`. | Request rejected with 403 Forbidden; audit log records unauthorized attempt. | **PASS** |
| **AUTHZ-02** | Cashier Viewing Medical Encounter Narrative | Authenticate as `cashier`; attempt GET request to `/api/encounters/{id}/clinical-details`. | Request rejected with 403 Forbidden. Cashier can only access billable order line items. | **PASS** |
| **AUTHZ-03** | Cross-Department Doctor Record Access | Doctor in Orthopedics attempts to read confidential consultation note in Psychiatry without care-team assignment. | Contextual ABAC engine denies access unless valid Emergency Break-Glass token is submitted. | **PASS** |
| **AUTHZ-04** | Privilege Escalation via Custom Role Creation | User with `staff:update` attempts to create custom role with `clinical_note:read:hospital`. | Policy check verifies creator does not hold target permission/scope; returns 403 Escalation Denied. | **PASS** |
| **AUTHZ-05** | Circumvention of Two-Person Admin Rule | Single `hospital_admin` attempts to deactivate the other active administrator or elevate a new account without second approval. | Transaction rejected; requires confirmation token signed by distinct active administrator. | **PASS** |

---

## 4. Cryptographic Implementation & Data Storage

| Test ID | Vulnerability / Attack Vector | Methodology & Test Scenario | Expected Result | Pass / Fail |
|---|---|---|---|---|
| **CRYP-01** | Plaintext PHI Storage in Database | Execute raw SQL `SELECT national_id, phone, address FROM patients` using database admin credentials. | Field values are ciphertext strings matching AES-256-GCM envelope structure (`v1:iv:tag:ciphertext`). | **PASS** |
| **CRYP-02** | Blind Index Information Leakage | Analyze HMAC values in `patients.phone_bidx` for pattern discernibility or frequency analysis vulnerabilities. | Blind index uses secret keyed HMAC-SHA256 with distinct salt; outputs uniform 64-character hash. | **PASS** |
| **CRYP-03** | Audit Log Modification (Direct DB UPDATE / DELETE) | Execute `UPDATE audit_log SET action = 'tampered'` or `DELETE FROM audit_log` as `mis_app`. | Database trigger / privilege error: `permission denied for table audit_log` or trigger exception blocks edit. | **PASS** |
| **CRYP-04** | Audit Log Hash-Chain Verification | Alter an intermediate row in `audit_log` via direct DB intervention; run hash-chain verification job. | Chain verifier flags broken link at altered row index (`computed_hash !== stored_hash`). | **PASS** |

---

## 5. Input Validation, Injection & Server-Side Security

| Test ID | Vulnerability / Attack Vector | Methodology & Test Scenario | Expected Result | Pass / Fail |
|---|---|---|---|---|
| **INJ-01** | SQL Injection in Search Endpoints | Inject SQL payloads (`' OR 1=1 --`, `UNION SELECT`) into patient search, diagnosis search, and pharmacy queries. | All queries use parameterized SQL bindings (`$1, $2`); payloads treated as literal string literals without injection. | **PASS** |
| **INJ-02** | Cross-Site Scripting (Stored XSS) in Clinical Notes | Submit clinical note containing malicious HTML/JS (`<script>alert(1)</script>`, `<img src=x onerror=...>`). | React JSX escaping and DOMPurify sanitization neutralize scripts; content renders safely as plaintext. | **PASS** |
| **SSRF-01** | Server-Side Request Forgery via Outbox / Webhook | Configure external notification or integration target pointing to internal link (`http://169.254.169.254/` or `http://localhost`). | Request rejected: strict host allow-list and private IP range filter block calls to local/cloud metadata IPs. | **PASS** |
| **INT-01** | FHIR Claim Bundle Validation Bypass | Submit malformed FHIR Claim Bundle missing mandatory ICD-11 diagnosis or practitioner licence number. | Integration validator rejects bundle with 422 Unprocessable Entity before external submission. | **PASS** |

# Health Records (HIM) & Hospital Administration Guide

**Document Reference:** TRN-HIM-ADMIN-HMIS-2026-V1  
**Target Roles:** Health Records Officers (HIM), Medical Superintendents, Hospital Administrators, Data Protection Officers  
**Modules Covered:** Chart Completeness, ICD-11 Coding Queue, Chart Amendments, Release of Information, Statutory Reports, Staff Governance  
**System:** Nexus Hospital Management Information System (HMIS)  
**Effective Date:** October 2026  

---

## 1. Health Information Management (HIM) Workspace

### 1.1 Chart Completeness Review
1. Navigate to **HIM Workspace / Chart Completeness**.
2. Filter discharged inpatient records or closed outpatient encounters.
3. Review whether charts have satisfied all mandatory documentation requirements:
   - Primary ICD-11 Diagnosis entered and locked
   - Discharge Summary signed by attending medical officer
   - Inpatient Nursing Handover and MAR reconciled
   - Laboratory and Radiology orders acknowledged.
4. If incomplete, flag the chart with a deficiency note back to the responsible clinician.

### 1.2 ICD-11 Secondary Coding Queue
1. Open **HIM Workspace / Coding Queue**.
2. Medical Records Officers review clinical encounter narratives to assign secondary diagnoses, external causes of morbidity, and comorbidity ICD-11 codes.
3. Click **Confirm Coded Diagnoses**.

### 1.3 Chart Amendment Requests & Addenda Workflow
In compliance with the Data Protection Act 2019 and health record standards:
- Clinicians cannot overwrite existing locked notes.
- When an amendment or correction is needed:
  1. Clinician submits an **Amendment Request** specifying the encounter ID, justification, and proposed text.
  2. The HIM Officer and Clinical Director review the request under **HIM Workspace / Amendment Queue**.
  3. Upon approval, the amendment is attached to the permanent chart as an official versioned **Clinical Addendum**.

### 1.4 Release of Information (ROI) & Patient Access History
When a patient, legal representative, or court requests medical records:
1. Navigate to **HIM Workspace / Release of Information**.
2. Select **New Disclosure Request**:
   - Record Requestor Name, National ID, and Purpose Code (*Patient Request / Legal Subpoena / Insurer Audit*).
   - Verify signed patient consent in `patient_consents`.
3. Generate the **Watermarked Patient Summary Report**. The report is digitally watermarked with the processing officer's name, purpose, and timestamp.
4. The disclosure event is immutably recorded in the `release_of_information_log`.

### 1.5 Statutory Aggregate Facility Returns (MOH 705A & 705B)
1. Open **Reporting / Statutory Returns**.
2. Select the report period (e.g. Monthly / Quarterly) and report type:
   - **MOH 705A:** Outpatient Summary for Children Under 5 Years.
   - **MOH 705B:** Outpatient Summary for Patients Over 5 Years.
3. Click **Generate Aggregate Report**.
4. **Data Minimization Guarantee:** The system aggregates visit counts and disease categories directly in the database without exposing or exporting individual patient identifiers.
5. The report generation event is logged in `statutory_reports_log` for compliance audit.

---

## 2. Hospital Administrator Operations & Staff Governance

### 2.1 Staff Onboarding & Account Management
1. Navigate to **Administration / Staff Directory**.
2. Click **Create Staff Account**:
   - Enter Full Legal Names, Hospital Email, and Mobile Phone.
   - Enter Professional Regulatory Cadre (e.g., *Medical Doctor, Registered Nurse, Pharmacist*).
   - Enter Professional Board Registration Number (KMPDC / NCK / PPB) and Licence Expiry Date.
3. Assign primary department and select one or more **System Roles** (e.g., `doctor`, `nurse`).
4. Generate the **One-Time Setup Link**. Staff member sets password and configures mandatory TOTP MFA.

### 2.2 Enforcing the Two-Person Rule for Administrative Changes
To prevent administrative account takeover or unilateral privilege escalation:
- Changes affecting administrative accounts (`hospital_admin`) or hospital configuration require a **Second Administrator's Approval**.
- When Admin 1 initiates a role elevation or waiver:
  - Status updates to `pending_second_admin_approval`.
  - Admin 2 logs in, inspects the change diff in the approval queue, and clicks **Approve Elevation**.

### 2.3 Managing Department Hierarchy and Leadership
1. Open **Administration / Departments**.
2. View existing clinical and administrative departments.
3. To assign a Department Head:
   - Select Department → **Edit Details**.
   - Assign `head_user_id` and optional `deputy_head_user_id`.
   - **Safeguard:** Department heads receive administrative powers over staff rosters and requisitions within their department only. Their management role does not grant clinical access to patients outside their active care team.

### 2.4 Audit Log Viewer & Anomaly Inspection
1. Navigate to **Administration / Audit Log Viewer**.
2. Filter audit records by:
   - Actor ID / Staff Member
   - Patient ID
   - Action Type (*read, create, amend, export, break_glass*)
   - Date and Time Range.
3. **Audit Verification Health:** The header displays the cryptographic integrity status of the SHA-256 hash chain (`Status: Continuous and Verified`).

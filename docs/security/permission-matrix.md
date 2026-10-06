# Nexus HMIS Security Permission Matrix

**Document Reference:** SEC-PERM-MATRIX-2026-V1  
**Single Source of Truth:** `lib/authz/catalogue.ts`  
**Governing Standard:** Role-Based Access Control (RBAC) with Scopes + Contextual Care-Team Validation (ABAC)  
**Effective Date:** October 2026  

---

## 1. Multi-Layered Authorization Architecture

Authorization in the Nexus HMIS requires satisfying three consecutive, independent evaluation layers:

```mermaid
graph TD
    A[Incoming Request] --> B[Layer 1: PostgreSQL Row-Level Security]
    B -->|tenant_id = current_tenant_id| C[Layer 2: Scoped RBAC Engine]
    B -->|Cross-Tenant| Deny1[403 Forbidden]
    C -->|Permission + Scope Validated| D[Layer 3: Contextual Care-Team / ABAC]
    C -->|Unauthorized Action| Deny2[403 Forbidden]
    D -->|Care Relationship Exists OR Break-Glass Active| Grant[200 OK Access Granted]
    D -->|No Relationship & No Break-Glass| Deny3[403 Forbidden]
```

### 1.1 Layer 1: Multi-Tenant Database Isolation
Enforced at the PostgreSQL kernel level using Row-Level Security (`app.current_tenant_id`). The application database role `mis_app` operates with `NOBYPASSRLS`. No query can access rows belonging to another facility.

### 1.2 Layer 2: Scoped Role-Based Access Control (RBAC)
Every privilege is expressed as a `resource:action` atom (e.g. `clinical_note:create`, `lab_result:verify`) with an associated **Scope Hierarchy**:
- **`own`**: Access restricted strictly to records created by or directly assigned to the authenticated user.
- **`assigned`**: Access restricted to patients/records where the user is formally assigned (e.g., active care-team member or named ordering clinician).
- **`department`**: Access permitted across all records within the user's active department.
- **`hospital`**: Facility-wide administrative or oversight access.

### 1.3 Layer 3: Contextual Care-Team Verification (ABAC)
For clinical and sensitive diagnostic records, holding a permission is insufficient. The user must also satisfy an active care-team check:
- Named attending clinician, consulting doctor, or triage nurse on the patient's active encounter.
- Named ordering or performing clinician for active diagnostic/pharmacy orders.
- Or holding an active, time-limited **Emergency Break-Glass Grant**.

---

## 2. Comprehensive System Role × Module Permission Matrix

| System Role | Category / Module Scope | Key Granted Permissions (`codename:scope`) | Strictly Denied Actions & Boundary Protections |
|---|---|---|---|
| **System Owner** | System Infrastructure & Integrations | `module:manage:hospital`<br>`integration:manage:hospital`<br>`integration:read:hospital` | **Zero PHI Access.** Cannot view patients, clinical notes, lab results, prescriptions, or billing ledgers. |
| **Hospital Administrator** | Organization, Staff, Security & Operations | `hospital:manage:hospital`<br>`department:manage:hospital`<br>`department_member:manage:hospital`<br>`staff:create/read/update/deactivate:hospital`<br>`role:manage/assign:hospital`<br>`mfa:reset:hospital`<br>`session:manage:hospital`<br>`module:manage:hospital`<br>`price_list:manage:hospital`<br>`audit:read:hospital` | **No Clinical Notes or Diagnoses.** Cannot view clinical consultation notes or diagnostic reports without break-glass. Cannot delete audit logs. |
| **Clinical Director** | Hospital-Wide Clinical Governance & Oversight | `patient:read:hospital`<br>`encounter:read:hospital`<br>`clinical_note:read:hospital`<br>`diagnosis:read:hospital`<br>`lab_result:read:hospital`<br>`imaging_report:read:hospital`<br>`break_glass:review:hospital`<br>`access_review:read:hospital`<br>`audit:read:hospital`<br>`report:read:hospital` | Cannot modify or create financial tariffs, manage system modules, or dispense medications. Oversight and clinical review role. |
| **Department Head** | Departmental Staff, Rostering & Workload | `department:read/update:department`<br>`department_member:manage:department`<br>`staff:read:department`<br>`roster:read/manage:department`<br>`requisition:approve:department`<br>`audit:read:department`<br>`report:read:department` | Strictly bounded to own department. Cannot view patients or staff of other departments without clinical assignment. |
| **Doctor / Clinical Officer** | Outpatient & Inpatient Clinical Care | `patient:read:assigned`<br>`encounter:create:department`<br>`encounter:read:assigned`<br>`encounter:update:own`<br>`clinical_note:create:department`<br>`clinical_note:read:assigned`<br>`clinical_note:amend:own`<br>`diagnosis:create:department`<br>`diagnosis:read:assigned`<br>`allergy:create/read:hospital`<br>`order:create:department`<br>`order:read:assigned`<br>`order:cancel/ack:own`<br>`lab_result:read:assigned`<br>`imaging_report:read:assigned`<br>`admission:create/discharge:department`<br>`theatre_case:create/read/update:department`<br>`break_glass:request:hospital` | Cannot modify price lists, settle cash invoices, verify laboratory analyzer runs, or dispense pharmacy stock directly. |
| **Nurse / Midwife** | Triage, Inpatient Care, Nursing Notes & MAR | `patient:read:assigned`<br>`encounter:read:assigned`<br>`triage:create/read:department`<br>`vitals:create:department`<br>`vitals:read:assigned`<br>`allergy:read:hospital`<br>`nursing_note:create/read:department`<br>`mar:administer/read:department`<br>`bed:manage:department`<br>`clinical_note:read:assigned`<br>`order:read:assigned`<br>`break_glass:request:hospital` | Cannot sign off final medical discharge summaries, prescribe controlled drugs, or create financial invoices. |
| **Pharmacist** | Prescription Review, Dispensing, Stock & Formularies | `patient:read:assigned`<br>`prescription:read/dispense:department`<br>`stock:read/manage:department`<br>`formulary:manage:hospital`<br>`controlled_drug:manage:department`<br>`allergy:read:hospital`<br>`diagnosis:read:assigned` | Cannot author clinical encounter notes, place surgical theatre bookings, or adjust hospital service prices. |
| **Lab Technologist** | Specimen Collection, Analysis & Verification | `lab_sample:create:department`<br>`lab_result:create/read/verify:department`<br>`order:read:department`<br>`patient:read:assigned` | Cannot view general consultation notes, nursing notes, or financial invoices. Sees order clinical reason only. |
| **Radiologist / Radiographer** | Imaging Acquisition, Reporting & PACS | `imaging_order:read:department`<br>`imaging_report:create/read:department`<br>`order:read:department`<br>`patient:read:assigned` | Bounded to radiology imaging orders and diagnostic interpretations. |
| **Registration / Front Desk** | Master Patient Index (MPI), Queues & Appointments | `patient:create/read/update:hospital`<br>`consent:create/read:hospital`<br>`appointment:create/read/update:hospital`<br>`coverage:read:hospital`<br>`triage:read:department` | **Zero Clinical Content.** Prohibited from viewing clinical notes, diagnoses, lab results, or imaging reports. |
| **Cashier / Billing Officer** | Invoices, Cash/M-Pesa Collections & Shifts | `patient:read:hospital`<br>`invoice:create/read:hospital`<br>`payment:create/read:hospital`<br>`waiver:create:hospital`<br>`cashier_shift:manage:hospital`<br>`coverage:read:hospital` | Prohibited from viewing clinical notes, prescriptions, or triage notes. May only view chargeable line items. |
| **Claims Officer** | Insurance Eligibility, Pre-Auth & SHA Claims | `patient:read:hospital`<br>`coverage:read/manage:hospital`<br>`claim:create/read/submit:hospital`<br>`preauth:create/read:hospital`<br>`invoice:read:hospital`<br>`diagnosis:read:hospital` | Access restricted to diagnosis codes and service items required for claim assembly. No access to full narrative notes. |
| **Health Records Officer (HIM)** | ICD-11 Coding, Completeness & Release | `patient:read:hospital`<br>`encounter:read:hospital`<br>`clinical_note:read:hospital`<br>`diagnosis:read/create:hospital`<br>`him:manage:hospital`<br>`amendment:create/approve:hospital` | Cannot dispense medications, prescribe, or collect patient cash. |
| **Store / Inventory Officer** | General Stores, Requisitions & Procurement | `inventory:read/manage:hospital`<br>`requisition:create/approve:hospital` | **Zero Patient Data Access.** Prohibited from reading patient records, clinical notes, or financial bills. |
| **HR / Admin Officer** | Staff Profiles, Rosters, Leave & Licences | `hr:manage:hospital`<br>`staff:read/update:hospital`<br>`roster:read/manage:hospital` | **Zero Patient Data Access.** Cannot view patient charts or clinical records. |
| **Compliance / DPO / Auditor** | Audit Trail, Consent & Data Subject Requests | `audit:read/export:hospital`<br>`access_review:read:hospital`<br>`break_glass:review:hospital`<br>`consent:read:hospital`<br>`data_subject:manage:hospital` | **No Clinical Notes by Default.** Inspects access logs, metadata, and consent records. Full clinical access blocked. |
| **IT Support** | Account Resets, Session Termination & Status | `integration:read:hospital`<br>`mfa:reset:hospital`<br>`session:manage:hospital`<br>`staff:read:hospital` | **Zero PHI Access.** Prohibited from viewing patient demographics, clinical notes, lab results, or financial transactions. |

---

## 3. Administrative Safeguards and Rules

1. **Privilege Escalation Prevention Rule:**  
   No user may grant or assign a permission codename or scope that they do not personally possess.
2. **Two-Person Approval Rule for Administrator Elevation:**  
   Modifying any user account with `hospital_admin` role or assigning administrative permissions requires explicit confirmation by a second active administrator.
3. **Last Administrator Safeguard:**  
   The system blocks deactivating or revoking administrative roles if fewer than two active administrators remain.
4. **Self-Modification Block:**  
   Administrators cannot modify their own role assignments or approve their own discount waivers.

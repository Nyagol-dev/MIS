/**
 * lib/authz/catalogue.ts
 *
 * PERMISSION CATALOGUE — Single Source of Truth (§4.1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Every permission atom in the hospital HMIS is defined here. The DB
 * `permission_catalogue` table is seeded FROM this file, never the reverse.
 *
 * Permissions are `resource:action` strings with a default scope that
 * determines the widest access a role assignment can confer.
 *
 * SCOPE hierarchy (narrow → wide):
 *   own < assigned < department < hospital
 *
 * A user with scope "department" on `patient:read` can read patients in
 * their own department. "hospital" can read all patients.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type PermissionAction =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'manage'
  | 'verify'
  | 'submit'
  | 'approve'
  | 'dispense'
  | 'administer';

export type PermissionScope = 'own' | 'assigned' | 'department' | 'hospital';

export interface CatalogueEntry {
  /** Unique key, e.g. 'patient:read' */
  codename: string;
  /** The resource being acted on */
  resource: string;
  /** The action being performed */
  action: PermissionAction;
  /** Human-readable description */
  description: string;
  /** The widest scope this permission can be granted at */
  maxScope: PermissionScope;
  /** Category for UI grouping */
  category: CatalogueCategory;
}

export type CatalogueCategory =
  | 'patient'
  | 'clinical'
  | 'laboratory'
  | 'radiology'
  | 'pharmacy'
  | 'inpatient'
  | 'billing'
  | 'claims'
  | 'administration'
  | 'department'
  | 'staff'
  | 'audit'
  | 'system'
  | 'reporting'
  | 'integration';

// ─── System Role Definitions ──────────────────────────────────────────────────

export type SystemRoleKey =
  | 'system_owner'
  | 'hospital_admin'
  | 'clinical_director'
  | 'department_head'
  | 'doctor'
  | 'nurse'
  | 'pharmacist'
  | 'lab_technologist'
  | 'radiologist'
  | 'registration'
  | 'cashier'
  | 'claims_officer'
  | 'him_officer'
  | 'store_officer'
  | 'hr_officer'
  | 'dpo_auditor'
  | 'it_support';

export interface SystemRoleDefinition {
  key: SystemRoleKey;
  name: string;
  description: string;
  /** Permission codenames granted to this role */
  permissions: { codename: string; scope: PermissionScope }[];
}

// ─── Permission Catalogue ─────────────────────────────────────────────────────

export const PERMISSION_CATALOGUE: readonly CatalogueEntry[] = [
  // ── Patient ───────────────────────────────────────────────────────────────
  { codename: 'patient:create', resource: 'patient', action: 'create', description: 'Register new patients', maxScope: 'hospital', category: 'patient' },
  { codename: 'patient:read', resource: 'patient', action: 'read', description: 'View patient demographics', maxScope: 'hospital', category: 'patient' },
  { codename: 'patient:update', resource: 'patient', action: 'update', description: 'Update patient demographics', maxScope: 'hospital', category: 'patient' },
  { codename: 'patient:merge', resource: 'patient', action: 'manage', description: 'Merge duplicate patient records', maxScope: 'hospital', category: 'patient' },
  { codename: 'patient_restricted:read', resource: 'patient_restricted', action: 'read', description: 'Access restricted/VIP patient records', maxScope: 'assigned', category: 'patient' },
  { codename: 'consent:create', resource: 'consent', action: 'create', description: 'Capture patient consent', maxScope: 'hospital', category: 'patient' },
  { codename: 'consent:read', resource: 'consent', action: 'read', description: 'View consent records', maxScope: 'hospital', category: 'patient' },

  // ── Clinical / OPD ────────────────────────────────────────────────────────
  { codename: 'encounter:create', resource: 'encounter', action: 'create', description: 'Create clinical encounters', maxScope: 'department', category: 'clinical' },
  { codename: 'encounter:read', resource: 'encounter', action: 'read', description: 'View clinical encounters', maxScope: 'hospital', category: 'clinical' },
  { codename: 'encounter:update', resource: 'encounter', action: 'update', description: 'Update encounters (addendum)', maxScope: 'own', category: 'clinical' },
  { codename: 'clinical_note:create', resource: 'clinical_note', action: 'create', description: 'Write clinical notes', maxScope: 'department', category: 'clinical' },
  { codename: 'clinical_note:read', resource: 'clinical_note', action: 'read', description: 'Read clinical notes', maxScope: 'hospital', category: 'clinical' },
  { codename: 'clinical_note:amend', resource: 'clinical_note', action: 'update', description: 'Amend locked clinical notes (addendum only)', maxScope: 'own', category: 'clinical' },
  { codename: 'diagnosis:create', resource: 'diagnosis', action: 'create', description: 'Record diagnoses (ICD-11)', maxScope: 'hospital', category: 'clinical' },
  { codename: 'diagnosis:read', resource: 'diagnosis', action: 'read', description: 'View diagnoses', maxScope: 'hospital', category: 'clinical' },
  { codename: 'allergy:create', resource: 'allergy', action: 'create', description: 'Record patient allergies', maxScope: 'hospital', category: 'clinical' },
  { codename: 'allergy:read', resource: 'allergy', action: 'read', description: 'View patient allergies', maxScope: 'hospital', category: 'clinical' },
  { codename: 'triage:create', resource: 'triage', action: 'create', description: 'Perform triage assessments', maxScope: 'department', category: 'clinical' },
  { codename: 'triage:read', resource: 'triage', action: 'read', description: 'View triage records', maxScope: 'department', category: 'clinical' },
  { codename: 'vitals:create', resource: 'vitals', action: 'create', description: 'Record patient vitals', maxScope: 'department', category: 'clinical' },
  { codename: 'vitals:read', resource: 'vitals', action: 'read', description: 'View patient vitals', maxScope: 'department', category: 'clinical' },
  { codename: 'appointment:create', resource: 'appointment', action: 'create', description: 'Book appointments', maxScope: 'department', category: 'clinical' },
  { codename: 'appointment:read', resource: 'appointment', action: 'read', description: 'View appointments', maxScope: 'department', category: 'clinical' },
  { codename: 'appointment:update', resource: 'appointment', action: 'update', description: 'Reschedule or cancel appointments', maxScope: 'department', category: 'clinical' },

  // ── Orders (CPOE) ─────────────────────────────────────────────────────────
  { codename: 'order:create', resource: 'order', action: 'create', description: 'Place clinical orders (lab, radiology, pharmacy)', maxScope: 'department', category: 'clinical' },
  { codename: 'order:read', resource: 'order', action: 'read', description: 'View orders', maxScope: 'department', category: 'clinical' },
  { codename: 'order:cancel', resource: 'order', action: 'update', description: 'Cancel pending orders', maxScope: 'own', category: 'clinical' },
  { codename: 'order:acknowledge', resource: 'order', action: 'update', description: 'Acknowledge order results', maxScope: 'own', category: 'clinical' },

  // ── Laboratory ────────────────────────────────────────────────────────────
  { codename: 'lab_sample:create', resource: 'lab_sample', action: 'create', description: 'Collect and label lab samples', maxScope: 'department', category: 'laboratory' },
  { codename: 'lab_result:create', resource: 'lab_result', action: 'create', description: 'Enter lab results', maxScope: 'department', category: 'laboratory' },
  { codename: 'lab_result:read', resource: 'lab_result', action: 'read', description: 'View lab results', maxScope: 'department', category: 'laboratory' },
  { codename: 'lab_result:verify', resource: 'lab_result', action: 'verify', description: 'Verify and release lab results', maxScope: 'department', category: 'laboratory' },

  // ── Radiology ─────────────────────────────────────────────────────────────
  { codename: 'imaging_order:read', resource: 'imaging_order', action: 'read', description: 'View imaging orders', maxScope: 'department', category: 'radiology' },
  { codename: 'imaging_report:create', resource: 'imaging_report', action: 'create', description: 'Create radiology reports', maxScope: 'department', category: 'radiology' },
  { codename: 'imaging_report:read', resource: 'imaging_report', action: 'read', description: 'View radiology reports', maxScope: 'department', category: 'radiology' },

  // ── Pharmacy ──────────────────────────────────────────────────────────────
  { codename: 'prescription:read', resource: 'prescription', action: 'read', description: 'View prescriptions', maxScope: 'department', category: 'pharmacy' },
  { codename: 'prescription:dispense', resource: 'prescription', action: 'dispense', description: 'Dispense medications', maxScope: 'department', category: 'pharmacy' },
  { codename: 'formulary:manage', resource: 'formulary', action: 'manage', description: 'Manage drug formulary', maxScope: 'hospital', category: 'pharmacy' },
  { codename: 'stock:read', resource: 'stock', action: 'read', description: 'View pharmacy stock', maxScope: 'department', category: 'pharmacy' },
  { codename: 'stock:manage', resource: 'stock', action: 'manage', description: 'Manage pharmacy stock levels', maxScope: 'department', category: 'pharmacy' },
  { codename: 'controlled_drug:manage', resource: 'controlled_drug', action: 'manage', description: 'Manage controlled drug register', maxScope: 'department', category: 'pharmacy' },

  // ── Inpatient ─────────────────────────────────────────────────────────────
  { codename: 'admission:create', resource: 'admission', action: 'create', description: 'Admit patients', maxScope: 'department', category: 'inpatient' },
  { codename: 'admission:read', resource: 'admission', action: 'read', description: 'View admissions', maxScope: 'department', category: 'inpatient' },
  { codename: 'admission:discharge', resource: 'admission', action: 'update', description: 'Discharge patients', maxScope: 'department', category: 'inpatient' },
  { codename: 'bed:manage', resource: 'bed', action: 'manage', description: 'Manage bed assignments and ward layout', maxScope: 'department', category: 'inpatient' },
  { codename: 'nursing_note:create', resource: 'nursing_note', action: 'create', description: 'Write nursing notes and care plans', maxScope: 'department', category: 'inpatient' },
  { codename: 'nursing_note:read', resource: 'nursing_note', action: 'read', description: 'Read nursing notes', maxScope: 'department', category: 'inpatient' },
  { codename: 'mar:administer', resource: 'mar', action: 'administer', description: 'Record medication administration', maxScope: 'department', category: 'inpatient' },
  { codename: 'mar:read', resource: 'mar', action: 'read', description: 'View medication administration record', maxScope: 'department', category: 'inpatient' },

  // ── Billing ───────────────────────────────────────────────────────────────
  { codename: 'invoice:create', resource: 'invoice', action: 'create', description: 'Create patient invoices', maxScope: 'hospital', category: 'billing' },
  { codename: 'invoice:read', resource: 'invoice', action: 'read', description: 'View invoices', maxScope: 'hospital', category: 'billing' },
  { codename: 'payment:create', resource: 'payment', action: 'create', description: 'Record payments (cash, M-Pesa)', maxScope: 'hospital', category: 'billing' },
  { codename: 'payment:read', resource: 'payment', action: 'read', description: 'View payment records', maxScope: 'hospital', category: 'billing' },
  { codename: 'waiver:create', resource: 'waiver', action: 'create', description: 'Request bill waivers/discounts', maxScope: 'hospital', category: 'billing' },
  { codename: 'waiver:approve', resource: 'waiver', action: 'approve', description: 'Approve bill waivers/discounts', maxScope: 'hospital', category: 'billing' },
  { codename: 'price_list:manage', resource: 'price_list', action: 'manage', description: 'Manage service price lists', maxScope: 'hospital', category: 'billing' },
  { codename: 'cashier_shift:manage', resource: 'cashier_shift', action: 'manage', description: 'Open/close cashier shifts and reconcile', maxScope: 'hospital', category: 'billing' },

  // ── Insurance & Claims ────────────────────────────────────────────────────
  { codename: 'coverage:read', resource: 'coverage', action: 'read', description: 'View patient insurance coverage', maxScope: 'hospital', category: 'claims' },
  { codename: 'coverage:manage', resource: 'coverage', action: 'manage', description: 'Manage insurance coverage records', maxScope: 'hospital', category: 'claims' },
  { codename: 'claim:create', resource: 'claim', action: 'create', description: 'Assemble insurance claims', maxScope: 'hospital', category: 'claims' },
  { codename: 'claim:read', resource: 'claim', action: 'read', description: 'View claim details and status', maxScope: 'hospital', category: 'claims' },
  { codename: 'claim:submit', resource: 'claim', action: 'submit', description: 'Submit claims to SHA/insurers', maxScope: 'hospital', category: 'claims' },
  { codename: 'preauth:create', resource: 'preauth', action: 'create', description: 'Request pre-authorization', maxScope: 'hospital', category: 'claims' },
  { codename: 'preauth:read', resource: 'preauth', action: 'read', description: 'View pre-authorization status', maxScope: 'hospital', category: 'claims' },

  // ── Department Management ─────────────────────────────────────────────────
  { codename: 'department:create', resource: 'department', action: 'create', description: 'Create departments', maxScope: 'hospital', category: 'department' },
  { codename: 'department:read', resource: 'department', action: 'read', description: 'View department details', maxScope: 'hospital', category: 'department' },
  { codename: 'department:update', resource: 'department', action: 'update', description: 'Update department settings', maxScope: 'department', category: 'department' },
  { codename: 'department:manage', resource: 'department', action: 'manage', description: 'Full department management (create, rename, deactivate)', maxScope: 'hospital', category: 'department' },
  { codename: 'department_member:manage', resource: 'department_member', action: 'manage', description: 'Assign/remove staff from departments', maxScope: 'hospital', category: 'department' },

  // ── Staff / User Management ───────────────────────────────────────────────
  { codename: 'staff:create', resource: 'staff', action: 'create', description: 'Create staff accounts', maxScope: 'hospital', category: 'staff' },
  { codename: 'staff:read', resource: 'staff', action: 'read', description: 'View staff profiles', maxScope: 'hospital', category: 'staff' },
  { codename: 'staff:update', resource: 'staff', action: 'update', description: 'Update staff profiles', maxScope: 'hospital', category: 'staff' },
  { codename: 'staff:deactivate', resource: 'staff', action: 'update', description: 'Deactivate staff accounts', maxScope: 'hospital', category: 'staff' },
  { codename: 'role:manage', resource: 'role', action: 'manage', description: 'Create and manage custom roles', maxScope: 'hospital', category: 'staff' },
  { codename: 'role:assign', resource: 'role', action: 'update', description: 'Assign roles to staff', maxScope: 'hospital', category: 'staff' },
  { codename: 'mfa:reset', resource: 'mfa', action: 'manage', description: 'Reset MFA for staff members', maxScope: 'hospital', category: 'staff' },
  { codename: 'session:manage', resource: 'session', action: 'manage', description: 'View and revoke user sessions', maxScope: 'hospital', category: 'staff' },

  // ── Audit & Compliance ────────────────────────────────────────────────────
  { codename: 'audit:read', resource: 'audit', action: 'read', description: 'View audit log entries', maxScope: 'hospital', category: 'audit' },
  { codename: 'audit:export', resource: 'audit', action: 'read', description: 'Export audit log data', maxScope: 'hospital', category: 'audit' },
  { codename: 'break_glass:request', resource: 'break_glass', action: 'create', description: 'Request emergency break-glass access', maxScope: 'hospital', category: 'audit' },
  { codename: 'break_glass:review', resource: 'break_glass', action: 'approve', description: 'Review break-glass access requests', maxScope: 'hospital', category: 'audit' },
  { codename: 'access_review:read', resource: 'access_review', action: 'read', description: 'View access review queue', maxScope: 'hospital', category: 'audit' },
  { codename: 'data_subject:manage', resource: 'data_subject', action: 'manage', description: 'Handle data subject requests (access, correction, deletion)', maxScope: 'hospital', category: 'audit' },

  // ── System / Hospital Config ──────────────────────────────────────────────
  { codename: 'hospital:manage', resource: 'hospital', action: 'manage', description: 'Manage hospital settings and configuration', maxScope: 'hospital', category: 'system' },
  { codename: 'module:manage', resource: 'module', action: 'manage', description: 'Enable/disable hospital modules', maxScope: 'hospital', category: 'system' },
  { codename: 'integration:manage', resource: 'integration', action: 'manage', description: 'Manage SHA/HIE integration settings', maxScope: 'hospital', category: 'system' },
  { codename: 'integration:read', resource: 'integration', action: 'read', description: 'View integration status', maxScope: 'hospital', category: 'system' },
  { codename: 'notification_template:manage', resource: 'notification_template', action: 'manage', description: 'Manage notification templates', maxScope: 'hospital', category: 'system' },

  // ── Reporting ─────────────────────────────────────────────────────────────
  { codename: 'report:read', resource: 'report', action: 'read', description: 'View reports', maxScope: 'department', category: 'reporting' },
  { codename: 'report:export', resource: 'report', action: 'read', description: 'Export reports', maxScope: 'department', category: 'reporting' },
  { codename: 'report:manage', resource: 'report', action: 'manage', description: 'Create and manage report definitions', maxScope: 'hospital', category: 'reporting' },

  // ── Referrals ─────────────────────────────────────────────────────────────
  { codename: 'referral:create', resource: 'referral', action: 'create', description: 'Create referrals', maxScope: 'department', category: 'clinical' },
  { codename: 'referral:read', resource: 'referral', action: 'read', description: 'View referrals', maxScope: 'department', category: 'clinical' },

  // ── Inventory / Store ─────────────────────────────────────────────────────
  { codename: 'inventory:read', resource: 'inventory', action: 'read', description: 'View inventory/store items', maxScope: 'department', category: 'administration' },
  { codename: 'inventory:manage', resource: 'inventory', action: 'manage', description: 'Manage inventory (requisitions, receiving, stock-take)', maxScope: 'department', category: 'administration' },
  { codename: 'requisition:create', resource: 'requisition', action: 'create', description: 'Create store requisitions', maxScope: 'department', category: 'administration' },
  { codename: 'requisition:approve', resource: 'requisition', action: 'approve', description: 'Approve store requisitions', maxScope: 'department', category: 'administration' },

  // ── HR ────────────────────────────────────────────────────────────────────
  { codename: 'hr:manage', resource: 'hr', action: 'manage', description: 'Manage staff HR records, rosters, and leave', maxScope: 'hospital', category: 'administration' },
  { codename: 'roster:read', resource: 'roster', action: 'read', description: 'View staff rosters', maxScope: 'department', category: 'administration' },
  { codename: 'roster:manage', resource: 'roster', action: 'manage', description: 'Manage shift rosters', maxScope: 'department', category: 'administration' },

  // ── Health Records / HIM ──────────────────────────────────────────────────
  { codename: 'him:manage', resource: 'him', action: 'manage', description: 'Health records management (coding, completeness, amendments)', maxScope: 'hospital', category: 'administration' },
  { codename: 'amendment:create', resource: 'amendment', action: 'create', description: 'Request record amendments', maxScope: 'hospital', category: 'administration' },
  { codename: 'amendment:approve', resource: 'amendment', action: 'approve', description: 'Approve record amendments', maxScope: 'hospital', category: 'administration' },

  // ── Legacy compat (kept for backward compatibility with existing code) ────
  { codename: 'user:manage', resource: 'user', action: 'manage', description: 'Legacy: full user management (deprecated — use staff:* and role:*)', maxScope: 'hospital', category: 'staff' },
  { codename: 'tenant:admin', resource: 'tenant', action: 'manage', description: 'Legacy: tenant admin (deprecated — use hospital:manage)', maxScope: 'hospital', category: 'system' },
] as const;

/**
 * Lookup map for O(1) access by codename.
 */
export const CATALOGUE_MAP: ReadonlyMap<string, CatalogueEntry> = new Map(
  PERMISSION_CATALOGUE.map((entry) => [entry.codename, entry])
);

/**
 * Set of all valid codenames for validation.
 */
export const VALID_CODENAMES: ReadonlySet<string> = new Set(
  PERMISSION_CATALOGUE.map((entry) => entry.codename)
);

// ─── System Role Definitions ──────────────────────────────────────────────────

export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  {
    key: 'system_owner',
    name: 'System Owner',
    description: 'Deployment health, module flags, integration status. No patient data access.',
    permissions: [
      { codename: 'module:manage', scope: 'hospital' },
      { codename: 'integration:manage', scope: 'hospital' },
      { codename: 'integration:read', scope: 'hospital' },
    ],
  },
  {
    key: 'hospital_admin',
    name: 'Hospital Administrator',
    description: 'Organisation configuration and people management. Not clinical.',
    permissions: [
      { codename: 'hospital:manage', scope: 'hospital' },
      { codename: 'department:manage', scope: 'hospital' },
      { codename: 'department:read', scope: 'hospital' },
      { codename: 'department_member:manage', scope: 'hospital' },
      { codename: 'staff:create', scope: 'hospital' },
      { codename: 'staff:read', scope: 'hospital' },
      { codename: 'staff:update', scope: 'hospital' },
      { codename: 'staff:deactivate', scope: 'hospital' },
      { codename: 'role:manage', scope: 'hospital' },
      { codename: 'role:assign', scope: 'hospital' },
      { codename: 'mfa:reset', scope: 'hospital' },
      { codename: 'session:manage', scope: 'hospital' },
      { codename: 'module:manage', scope: 'hospital' },
      { codename: 'audit:read', scope: 'hospital' },
      { codename: 'notification_template:manage', scope: 'hospital' },
      { codename: 'price_list:manage', scope: 'hospital' },
      { codename: 'integration:manage', scope: 'hospital' },
      { codename: 'integration:read', scope: 'hospital' },
      // Legacy compat
      { codename: 'user:manage', scope: 'hospital' },
      { codename: 'tenant:admin', scope: 'hospital' },
    ],
  },
  {
    key: 'clinical_director',
    name: 'Clinical Director',
    description: 'Hospital-wide clinical oversight and governance.',
    permissions: [
      { codename: 'patient:read', scope: 'hospital' },
      { codename: 'encounter:read', scope: 'hospital' },
      { codename: 'clinical_note:read', scope: 'hospital' },
      { codename: 'diagnosis:read', scope: 'hospital' },
      { codename: 'allergy:read', scope: 'hospital' },
      { codename: 'lab_result:read', scope: 'hospital' },
      { codename: 'imaging_report:read', scope: 'hospital' },
      { codename: 'break_glass:review', scope: 'hospital' },
      { codename: 'access_review:read', scope: 'hospital' },
      { codename: 'audit:read', scope: 'hospital' },
      { codename: 'report:read', scope: 'hospital' },
      { codename: 'department:read', scope: 'hospital' },
    ],
  },
  {
    key: 'department_head',
    name: 'Department Head',
    description: 'Management powers scoped to own department only.',
    permissions: [
      { codename: 'department:read', scope: 'department' },
      { codename: 'department:update', scope: 'department' },
      { codename: 'department_member:manage', scope: 'department' },
      { codename: 'staff:read', scope: 'department' },
      { codename: 'roster:manage', scope: 'department' },
      { codename: 'roster:read', scope: 'department' },
      { codename: 'requisition:approve', scope: 'department' },
      { codename: 'report:read', scope: 'department' },
      { codename: 'audit:read', scope: 'department' },
    ],
  },
  {
    key: 'doctor',
    name: 'Doctor / Clinical Officer',
    description: 'Full clinical documentation and orders for patients under care.',
    permissions: [
      { codename: 'patient:read', scope: 'assigned' },
      { codename: 'encounter:create', scope: 'department' },
      { codename: 'encounter:read', scope: 'assigned' },
      { codename: 'encounter:update', scope: 'own' },
      { codename: 'clinical_note:create', scope: 'department' },
      { codename: 'clinical_note:read', scope: 'assigned' },
      { codename: 'clinical_note:amend', scope: 'own' },
      { codename: 'diagnosis:create', scope: 'department' },
      { codename: 'diagnosis:read', scope: 'assigned' },
      { codename: 'allergy:create', scope: 'hospital' },
      { codename: 'allergy:read', scope: 'hospital' },
      { codename: 'vitals:read', scope: 'assigned' },
      { codename: 'order:create', scope: 'department' },
      { codename: 'order:read', scope: 'assigned' },
      { codename: 'order:cancel', scope: 'own' },
      { codename: 'order:acknowledge', scope: 'own' },
      { codename: 'lab_result:read', scope: 'assigned' },
      { codename: 'imaging_report:read', scope: 'assigned' },
      { codename: 'prescription:read', scope: 'assigned' },
      { codename: 'admission:create', scope: 'department' },
      { codename: 'admission:read', scope: 'assigned' },
      { codename: 'admission:discharge', scope: 'department' },
      { codename: 'nursing_note:read', scope: 'assigned' },
      { codename: 'mar:read', scope: 'assigned' },
      { codename: 'referral:create', scope: 'department' },
      { codename: 'referral:read', scope: 'assigned' },
      { codename: 'appointment:create', scope: 'department' },
      { codename: 'appointment:read', scope: 'department' },
      { codename: 'appointment:update', scope: 'department' },
      { codename: 'break_glass:request', scope: 'hospital' },
      { codename: 'triage:read', scope: 'assigned' },
    ],
  },
  {
    key: 'nurse',
    name: 'Nurse / Midwife',
    description: 'Triage, vitals, nursing notes, medication administration, bed/ward actions.',
    permissions: [
      { codename: 'patient:read', scope: 'assigned' },
      { codename: 'encounter:read', scope: 'assigned' },
      { codename: 'triage:create', scope: 'department' },
      { codename: 'triage:read', scope: 'department' },
      { codename: 'vitals:create', scope: 'department' },
      { codename: 'vitals:read', scope: 'assigned' },
      { codename: 'allergy:read', scope: 'hospital' },
      { codename: 'nursing_note:create', scope: 'department' },
      { codename: 'nursing_note:read', scope: 'department' },
      { codename: 'mar:administer', scope: 'department' },
      { codename: 'mar:read', scope: 'department' },
      { codename: 'clinical_note:read', scope: 'assigned' },
      { codename: 'diagnosis:read', scope: 'assigned' },
      { codename: 'order:read', scope: 'assigned' },
      { codename: 'lab_result:read', scope: 'assigned' },
      { codename: 'bed:manage', scope: 'department' },
      { codename: 'admission:read', scope: 'department' },
      { codename: 'appointment:read', scope: 'department' },
      { codename: 'break_glass:request', scope: 'hospital' },
    ],
  },
  {
    key: 'pharmacist',
    name: 'Pharmacist',
    description: 'Review/dispense prescriptions, stock, controlled-drug register.',
    permissions: [
      { codename: 'patient:read', scope: 'assigned' },
      { codename: 'prescription:read', scope: 'department' },
      { codename: 'prescription:dispense', scope: 'department' },
      { codename: 'allergy:read', scope: 'hospital' },
      { codename: 'order:read', scope: 'department' },
      { codename: 'stock:read', scope: 'department' },
      { codename: 'stock:manage', scope: 'department' },
      { codename: 'formulary:manage', scope: 'hospital' },
      { codename: 'controlled_drug:manage', scope: 'department' },
      { codename: 'diagnosis:read', scope: 'assigned' },
    ],
  },
  {
    key: 'lab_technologist',
    name: 'Lab Technologist',
    description: 'Receive samples, enter and verify results.',
    permissions: [
      { codename: 'lab_sample:create', scope: 'department' },
      { codename: 'lab_result:create', scope: 'department' },
      { codename: 'lab_result:read', scope: 'department' },
      { codename: 'lab_result:verify', scope: 'department' },
      { codename: 'order:read', scope: 'department' },
      { codename: 'patient:read', scope: 'assigned' },
    ],
  },
  {
    key: 'radiologist',
    name: 'Radiologist / Radiographer',
    description: 'Imaging orders, reports.',
    permissions: [
      { codename: 'imaging_order:read', scope: 'department' },
      { codename: 'imaging_report:create', scope: 'department' },
      { codename: 'imaging_report:read', scope: 'department' },
      { codename: 'order:read', scope: 'department' },
      { codename: 'patient:read', scope: 'assigned' },
    ],
  },
  {
    key: 'registration',
    name: 'Registration / Front Desk',
    description: 'Register patients, search MPI, appointments, queue, capture consent. No clinical notes.',
    permissions: [
      { codename: 'patient:create', scope: 'hospital' },
      { codename: 'patient:read', scope: 'hospital' },
      { codename: 'patient:update', scope: 'hospital' },
      { codename: 'consent:create', scope: 'hospital' },
      { codename: 'consent:read', scope: 'hospital' },
      { codename: 'appointment:create', scope: 'hospital' },
      { codename: 'appointment:read', scope: 'hospital' },
      { codename: 'appointment:update', scope: 'hospital' },
      { codename: 'coverage:read', scope: 'hospital' },
      { codename: 'triage:read', scope: 'department' },
    ],
  },
  {
    key: 'cashier',
    name: 'Cashier / Billing Officer',
    description: 'Invoices, payments, receipts, deposits, reconciliation. No clinical notes.',
    permissions: [
      { codename: 'patient:read', scope: 'hospital' },
      { codename: 'invoice:create', scope: 'hospital' },
      { codename: 'invoice:read', scope: 'hospital' },
      { codename: 'payment:create', scope: 'hospital' },
      { codename: 'payment:read', scope: 'hospital' },
      { codename: 'waiver:create', scope: 'hospital' },
      { codename: 'cashier_shift:manage', scope: 'hospital' },
      { codename: 'coverage:read', scope: 'hospital' },
    ],
  },
  {
    key: 'claims_officer',
    name: 'Insurance / Claims Officer',
    description: 'Eligibility checks, pre-auth, claim assembly/submission/tracking.',
    permissions: [
      { codename: 'patient:read', scope: 'hospital' },
      { codename: 'coverage:read', scope: 'hospital' },
      { codename: 'coverage:manage', scope: 'hospital' },
      { codename: 'claim:create', scope: 'hospital' },
      { codename: 'claim:read', scope: 'hospital' },
      { codename: 'claim:submit', scope: 'hospital' },
      { codename: 'preauth:create', scope: 'hospital' },
      { codename: 'preauth:read', scope: 'hospital' },
      { codename: 'invoice:read', scope: 'hospital' },
      { codename: 'diagnosis:read', scope: 'hospital' },
    ],
  },
  {
    key: 'him_officer',
    name: 'Health Records Officer (HIM)',
    description: 'Record completeness, coding, amendments, release-of-information, archiving.',
    permissions: [
      { codename: 'patient:read', scope: 'hospital' },
      { codename: 'encounter:read', scope: 'hospital' },
      { codename: 'clinical_note:read', scope: 'hospital' },
      { codename: 'diagnosis:read', scope: 'hospital' },
      { codename: 'diagnosis:create', scope: 'hospital' },
      { codename: 'him:manage', scope: 'hospital' },
      { codename: 'amendment:create', scope: 'hospital' },
      { codename: 'amendment:approve', scope: 'hospital' },
    ],
  },
  {
    key: 'store_officer',
    name: 'Store / Inventory Officer',
    description: 'Stock, requisitions, procurement receiving. No patient data.',
    permissions: [
      { codename: 'inventory:read', scope: 'hospital' },
      { codename: 'inventory:manage', scope: 'hospital' },
      { codename: 'requisition:create', scope: 'hospital' },
      { codename: 'requisition:approve', scope: 'hospital' },
    ],
  },
  {
    key: 'hr_officer',
    name: 'HR / Admin Officer',
    description: 'Staff records, rosters, leave, licence expiry tracking. No patient data.',
    permissions: [
      { codename: 'hr:manage', scope: 'hospital' },
      { codename: 'staff:read', scope: 'hospital' },
      { codename: 'staff:update', scope: 'hospital' },
      { codename: 'roster:read', scope: 'hospital' },
      { codename: 'roster:manage', scope: 'hospital' },
    ],
  },
  {
    key: 'dpo_auditor',
    name: 'Compliance / DPO / Auditor',
    description: 'Read-only access to audit logs, consent records, access reports. No clinical content by default.',
    permissions: [
      { codename: 'audit:read', scope: 'hospital' },
      { codename: 'audit:export', scope: 'hospital' },
      { codename: 'access_review:read', scope: 'hospital' },
      { codename: 'break_glass:review', scope: 'hospital' },
      { codename: 'consent:read', scope: 'hospital' },
      { codename: 'data_subject:manage', scope: 'hospital' },
    ],
  },
  {
    key: 'it_support',
    name: 'IT Support',
    description: 'System health, user lockouts/resets (not role grants), integration status. No PHI.',
    permissions: [
      { codename: 'integration:read', scope: 'hospital' },
      { codename: 'mfa:reset', scope: 'hospital' },
      { codename: 'session:manage', scope: 'hospital' },
      { codename: 'staff:read', scope: 'hospital' },
    ],
  },
] as const;

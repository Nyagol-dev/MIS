import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SYSTEM_ROLES,
  CATALOGUE_MAP,
  SystemRoleKey,
} from '../lib/authz/catalogue';

describe('Exhaustive Permission Matrix & Separation of Duties (Phase 7)', () => {
  const getRole = (key: SystemRoleKey) => {
    const role = SYSTEM_ROLES.find((r) => r.key === key);
    assert.ok(role, `System role '${key}' must exist`);
    return role;
  };

  const getCodenames = (key: SystemRoleKey) => {
    return new Set(getRole(key).permissions.map((p) => p.codename));
  };

  it('verifies all 17 system roles are defined and unique', () => {
    const keys = SYSTEM_ROLES.map((r) => r.key);
    assert.equal(keys.length, 17, 'Exactly 17 system roles must be configured');
    const uniqueKeys = new Set(keys);
    assert.equal(uniqueKeys.size, 17, 'All system role keys must be unique');
  });

  describe('System Owner (Platform Boundary)', () => {
    it('has zero access to patient or clinical data', () => {
      const perms = getCodenames('system_owner');
      assert.ok(!perms.has('patient:read'), 'System Owner must not read patients');
      assert.ok(!perms.has('clinical_note:read'), 'System Owner must not read clinical notes');
      assert.ok(!perms.has('invoice:read'), 'System Owner must not read invoices');
      assert.ok(!perms.has('audit:read'), 'System Owner must not read tenant audit logs');
      assert.ok(perms.has('module:manage'), 'System Owner can manage modules');
      assert.ok(perms.has('integration:manage'), 'System Owner can manage integrations');
    });
  });

  describe('Hospital Administrator (Separation of Duties)', () => {
    it('has administrative powers but strictly zero clinical consultation access', () => {
      const perms = getCodenames('hospital_admin');
      assert.ok(perms.has('hospital:manage'), 'Admin can manage hospital');
      assert.ok(perms.has('department:manage'), 'Admin can manage departments');
      assert.ok(perms.has('staff:create'), 'Admin can create staff');
      assert.ok(perms.has('role:manage'), 'Admin can manage roles');
      assert.ok(perms.has('audit:read'), 'Admin can view audit logs');

      // Negative assertions: SoD
      assert.ok(!perms.has('clinical_note:read'), 'Admin cannot read clinical notes');
      assert.ok(!perms.has('clinical_note:create'), 'Admin cannot write clinical notes');
      assert.ok(!perms.has('diagnosis:create'), 'Admin cannot diagnose patients');
      assert.ok(!perms.has('lab_result:verify'), 'Admin cannot verify lab results');
      assert.ok(!perms.has('prescription:dispense'), 'Admin cannot dispense pharmacy items');
      assert.ok(!perms.has('mar:administer'), 'Admin cannot administer medications');
    });
  });

  describe('Cashier / Billing Officer', () => {
    it('can access invoices and payments but zero clinical details', () => {
      const perms = getCodenames('cashier');
      assert.ok(perms.has('invoice:create'));
      assert.ok(perms.has('payment:create'));
      assert.ok(perms.has('cashier_shift:manage'));

      // Negative assertions
      assert.ok(!perms.has('clinical_note:read'), 'Cashier cannot read clinical notes');
      assert.ok(!perms.has('diagnosis:create'), 'Cashier cannot create diagnoses');
      assert.ok(!perms.has('encounter:create'), 'Cashier cannot create encounters');
      assert.ok(!perms.has('prescription:dispense'), 'Cashier cannot dispense drugs');
    });
  });

  describe('Registration / Front Desk', () => {
    it('can manage MPI and appointments with zero clinical narrative access', () => {
      const perms = getCodenames('registration');
      assert.ok(perms.has('patient:create'));
      assert.ok(perms.has('patient:read'));
      assert.ok(perms.has('consent:create'));
      assert.ok(perms.has('appointment:create'));

      // Negative assertions
      assert.ok(!perms.has('clinical_note:read'), 'Front desk cannot read clinical notes');
      assert.ok(!perms.has('clinical_note:create'), 'Front desk cannot create clinical notes');
      assert.ok(!perms.has('diagnosis:read'), 'Front desk cannot read diagnoses');
      assert.ok(!perms.has('lab_result:read'), 'Front desk cannot read lab results');
    });
  });

  describe('Doctor / Clinical Officer', () => {
    it('has comprehensive clinical, diagnostic, and order powers', () => {
      const perms = getCodenames('doctor');
      assert.ok(perms.has('encounter:create'));
      assert.ok(perms.has('clinical_note:create'));
      assert.ok(perms.has('clinical_note:amend'));
      assert.ok(perms.has('diagnosis:create'));
      assert.ok(perms.has('allergy:create'));
      assert.ok(perms.has('order:create'));
      assert.ok(perms.has('admission:create'));
      assert.ok(perms.has('break_glass:request'));

      // Negative assertions
      assert.ok(!perms.has('price_list:manage'), 'Doctor cannot change hospital prices');
      assert.ok(!perms.has('payment:create'), 'Doctor cannot collect payments');
      assert.ok(!perms.has('prescription:dispense'), 'Doctor cannot dispense drugs directly');
    });
  });

  describe('Nurse / Midwife', () => {
    it('has triage, vitals, nursing notes, and MAR administration', () => {
      const perms = getCodenames('nurse');
      assert.ok(perms.has('triage:create'));
      assert.ok(perms.has('vitals:create'));
      assert.ok(perms.has('nursing_note:create'));
      assert.ok(perms.has('mar:administer'));
      assert.ok(perms.has('bed:manage'));
      assert.ok(perms.has('break_glass:request'));

      // Negative assertions
      assert.ok(!perms.has('admission:discharge'), 'Nurse cannot discharge inpatient without medical officer order');
      assert.ok(!perms.has('invoice:create'), 'Nurse cannot create invoices');
      assert.ok(!perms.has('role:manage'), 'Nurse cannot manage roles');
    });
  });

  describe('Pharmacist', () => {
    it('has prescription dispensing, formulary, and controlled drug management', () => {
      const perms = getCodenames('pharmacist');
      assert.ok(perms.has('prescription:dispense'));
      assert.ok(perms.has('formulary:manage'));
      assert.ok(perms.has('stock:manage'));
      assert.ok(perms.has('controlled_drug:manage'));

      // Negative assertions
      assert.ok(!perms.has('clinical_note:create'), 'Pharmacist cannot create clinical notes');
      assert.ok(!perms.has('theatre_case:create'), 'Pharmacist cannot schedule theatre');
    });
  });

  describe('Lab Technologist', () => {
    it('has sample collection, result entry, and result verification', () => {
      const perms = getCodenames('lab_technologist');
      assert.ok(perms.has('lab_sample:create'));
      assert.ok(perms.has('lab_result:create'));
      assert.ok(perms.has('lab_result:verify'));

      // Negative assertions
      assert.ok(!perms.has('clinical_note:read'), 'Lab technologist cannot read clinical consultation notes');
      assert.ok(!perms.has('invoice:create'), 'Lab technologist cannot create invoices');
    });
  });

  describe('Store Officer, HR Officer, and IT Support', () => {
    it('strictly prohibits patient and clinical record access', () => {
      for (const roleKey of ['store_officer', 'hr_officer', 'it_support'] as const) {
        const perms = getCodenames(roleKey);
        assert.ok(!perms.has('patient:read'), `${roleKey} must not read patient demographics`);
        assert.ok(!perms.has('clinical_note:read'), `${roleKey} must not read clinical notes`);
        assert.ok(!perms.has('encounter:read'), `${roleKey} must not read encounters`);
        assert.ok(!perms.has('order:read'), `${roleKey} must not read orders`);
      }
    });
  });

  describe('Compliance / DPO / Auditor', () => {
    it('has audit, access review, and consent oversight with zero clinical access', () => {
      const perms = getCodenames('dpo_auditor');
      assert.ok(perms.has('audit:read'));
      assert.ok(perms.has('audit:export'));
      assert.ok(perms.has('access_review:read'));
      assert.ok(perms.has('break_glass:review'));
      assert.ok(perms.has('consent:read'));

      // Negative assertions
      assert.ok(!perms.has('patient:read'), 'DPO cannot browse general patient directory');
      assert.ok(!perms.has('clinical_note:read'), 'DPO cannot read clinical notes');
      assert.ok(!perms.has('diagnosis:create'), 'DPO cannot create diagnoses');
    });
  });

  describe('Scope Hierarchy Validation', () => {
    it('ensures every permission granted in system roles is within catalogue maxScope', () => {
      const scopeWeight = { own: 1, assigned: 2, department: 3, hospital: 4 };

      for (const role of SYSTEM_ROLES) {
        for (const grant of role.permissions) {
          const catalogueEntry = CATALOGUE_MAP.get(grant.codename);
          assert.ok(catalogueEntry, `Role ${role.key} grants unknown codename ${grant.codename}`);
          const grantedWeight = scopeWeight[grant.scope];
          const maxWeight = scopeWeight[catalogueEntry.maxScope];
          assert.ok(
            grantedWeight <= maxWeight,
            `Role ${role.key}: grant ${grant.codename} with scope ${grant.scope} exceeds maxScope ${catalogueEntry.maxScope}`
          );
        }
      }
    });
  });
});

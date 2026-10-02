import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PERMISSION_CATALOGUE,
  SYSTEM_ROLES,
  CATALOGUE_MAP,
  VALID_CODENAMES,
} from '../lib/authz/catalogue';

// ─── Catalogue integrity ──────────────────────────────────────────────────────

test('catalogue has no duplicate codenames', () => {
  const seen = new Set<string>();
  for (const entry of PERMISSION_CATALOGUE) {
    assert.ok(!seen.has(entry.codename), `Duplicate codename: ${entry.codename}`);
    seen.add(entry.codename);
  }
});

test('catalogue map has correct size', () => {
  assert.equal(CATALOGUE_MAP.size, PERMISSION_CATALOGUE.length);
});

test('all catalogue entries have valid fields', () => {
  const validScopes = new Set(['own', 'assigned', 'department', 'hospital']);
  for (const entry of PERMISSION_CATALOGUE) {
    assert.ok(entry.codename.length > 0, `Empty codename`);
    assert.ok(entry.codename.includes(':'), `Codename missing colon: ${entry.codename}`);
    assert.ok(entry.resource.length > 0, `Empty resource for ${entry.codename}`);
    assert.ok(entry.action.length > 0, `Empty action for ${entry.codename}`);
    assert.ok(entry.description.length > 0, `Empty description for ${entry.codename}`);
    assert.ok(validScopes.has(entry.maxScope), `Invalid scope for ${entry.codename}: ${entry.maxScope}`);
  }
});

// ─── System role integrity ────────────────────────────────────────────────────

test('system roles have no duplicate keys', () => {
  const seen = new Set<string>();
  for (const role of SYSTEM_ROLES) {
    assert.ok(!seen.has(role.key), `Duplicate role key: ${role.key}`);
    seen.add(role.key);
  }
});

test('system roles have no duplicate names', () => {
  const seen = new Set<string>();
  for (const role of SYSTEM_ROLES) {
    assert.ok(!seen.has(role.name), `Duplicate role name: ${role.name}`);
    seen.add(role.name);
  }
});

test('all system role permission codenames exist in the catalogue', () => {
  for (const role of SYSTEM_ROLES) {
    for (const perm of role.permissions) {
      assert.ok(
        VALID_CODENAMES.has(perm.codename),
        `Role '${role.name}' references unknown codename '${perm.codename}'`,
      );
    }
  }
});

test('system role permission scopes do not exceed catalogue maxScope', () => {
  const scopeRank: Record<string, number> = {
    own: 1, assigned: 2, department: 3, hospital: 4,
  };

  for (const role of SYSTEM_ROLES) {
    for (const perm of role.permissions) {
      const entry = CATALOGUE_MAP.get(perm.codename)!;
      assert.ok(
        scopeRank[perm.scope] <= scopeRank[entry.maxScope],
        `Role '${role.name}': permission '${perm.codename}' has scope '${perm.scope}' exceeding maxScope '${entry.maxScope}'`,
      );
    }
  }
});

test('minimum set of system roles exist', () => {
  const requiredRoles = [
    'hospital_admin',
    'clinical_director',
    'department_head',
    'doctor',
    'nurse',
    'pharmacist',
    'lab_technologist',
    'registration',
    'cashier',
  ];
  const roleKeys = new Set(SYSTEM_ROLES.map((r) => r.key));
  for (const required of requiredRoles) {
    assert.ok(roleKeys.has(required as any), `Missing required system role: ${required}`);
  }
});

// ─── Role-based access control tests ──────────────────────────────────────────

test('hospital_admin has no clinical note access', () => {
  const admin = SYSTEM_ROLES.find((r) => r.key === 'hospital_admin')!;
  const clinicalCodenames = admin.permissions.map((p) => p.codename);
  assert.ok(
    !clinicalCodenames.includes('clinical_note:read'),
    'Hospital admin should NOT have clinical_note:read (separation of duties)',
  );
  assert.ok(
    !clinicalCodenames.includes('clinical_note:create'),
    'Hospital admin should NOT have clinical_note:create',
  );
});

test('cashier has no clinical note access', () => {
  const cashier = SYSTEM_ROLES.find((r) => r.key === 'cashier')!;
  const codenames = cashier.permissions.map((p) => p.codename);
  assert.ok(!codenames.includes('clinical_note:read'), 'Cashier should not read clinical notes');
  assert.ok(!codenames.includes('encounter:create'), 'Cashier should not create encounters');
});

test('store_officer has no patient data access', () => {
  const store = SYSTEM_ROLES.find((r) => r.key === 'store_officer')!;
  const codenames = store.permissions.map((p) => p.codename);
  assert.ok(!codenames.includes('patient:read'), 'Store officer should not have patient:read');
  assert.ok(!codenames.includes('encounter:read'), 'Store officer should not have encounter:read');
});

test('it_support has no PHI access', () => {
  const it = SYSTEM_ROLES.find((r) => r.key === 'it_support')!;
  const codenames = it.permissions.map((p) => p.codename);
  assert.ok(!codenames.includes('patient:read'), 'IT support should not have patient:read');
  assert.ok(!codenames.includes('clinical_note:read'), 'IT support should not read clinical notes');
  assert.ok(!codenames.includes('encounter:read'), 'IT support should not read encounters');
});

test('doctor has break-glass request capability', () => {
  const doctor = SYSTEM_ROLES.find((r) => r.key === 'doctor')!;
  const codenames = doctor.permissions.map((p) => p.codename);
  assert.ok(codenames.includes('break_glass:request'), 'Doctor should be able to request break-glass');
});

test('dpo_auditor has audit access but no clinical content', () => {
  const dpo = SYSTEM_ROLES.find((r) => r.key === 'dpo_auditor')!;
  const codenames = dpo.permissions.map((p) => p.codename);
  assert.ok(codenames.includes('audit:read'), 'DPO should have audit:read');
  assert.ok(codenames.includes('break_glass:review'), 'DPO should review break-glass');
  assert.ok(!codenames.includes('clinical_note:read'), 'DPO should NOT read clinical notes');
  assert.ok(!codenames.includes('patient:read'), 'DPO should NOT have patient:read');
});

// ─── Legacy compatibility ─────────────────────────────────────────────────────

test('legacy permission codenames exist in catalogue', () => {
  assert.ok(VALID_CODENAMES.has('user:manage'), 'Legacy user:manage must exist');
  assert.ok(VALID_CODENAMES.has('tenant:admin'), 'Legacy tenant:admin must exist');
});

test('hospital_admin has legacy permissions for backward compat', () => {
  const admin = SYSTEM_ROLES.find((r) => r.key === 'hospital_admin')!;
  const codenames = admin.permissions.map((p) => p.codename);
  assert.ok(codenames.includes('user:manage'), 'Hospital admin needs user:manage for legacy compat');
  assert.ok(codenames.includes('tenant:admin'), 'Hospital admin needs tenant:admin for legacy compat');
});

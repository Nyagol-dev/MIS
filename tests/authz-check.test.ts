import assert from 'node:assert/strict';
import test from 'node:test';
import { can } from '../lib/authz/can';
import type { UserAuthzContext } from '../lib/authz/types';
import {
  checkEscalation,
  checkSelfEdit,
  checkTwoPersonRule,
  containsAdminPermissions,
} from '../lib/authz/safeguards';

// ─── Helper to build a test authz context ─────────────────────────────────────

function makeAuthz(overrides: Partial<UserAuthzContext> = {}): UserAuthzContext {
  return {
    tenantId: 'tenant-1',
    userId: 'user-1',
    grants: new Map(),
    departmentIds: new Set(),
    headOfDepartmentIds: new Set(),
    isHospitalAdmin: false,
    ...overrides,
  };
}

// ─── Scope-based authorization ────────────────────────────────────────────────

test('hospital scope grants access without context', () => {
  const authz = makeAuthz({
    grants: new Map([['patient:read', 'hospital']]),
  });
  assert.ok(can(authz, 'patient:read'));
  assert.ok(can(authz, 'patient:read', {}));
  assert.ok(can(authz, 'patient:read', { departmentId: 'any-dept' }));
});

test('department scope requires matching department', () => {
  const authz = makeAuthz({
    grants: new Map([['encounter:read', 'department']]),
    departmentIds: new Set(['dept-1', 'dept-2']),
  });
  assert.ok(can(authz, 'encounter:read', { departmentId: 'dept-1' }));
  assert.ok(can(authz, 'encounter:read', { departmentId: 'dept-2' }));
  assert.ok(!can(authz, 'encounter:read', { departmentId: 'dept-other' }));
  assert.ok(!can(authz, 'encounter:read')); // no context → denied
});

test('department head gets department scope for headed departments', () => {
  const authz = makeAuthz({
    grants: new Map([['report:read', 'department']]),
    departmentIds: new Set(['dept-1']),
    headOfDepartmentIds: new Set(['dept-3']),
  });
  assert.ok(can(authz, 'report:read', { departmentId: 'dept-1' })); // member
  assert.ok(can(authz, 'report:read', { departmentId: 'dept-3' })); // head
  assert.ok(!can(authz, 'report:read', { departmentId: 'dept-other' }));
});

test('own scope requires matching owner', () => {
  const authz = makeAuthz({
    userId: 'user-1',
    grants: new Map([['clinical_note:amend', 'own']]),
  });
  assert.ok(can(authz, 'clinical_note:amend', { ownerId: 'user-1' }));
  assert.ok(!can(authz, 'clinical_note:amend', { ownerId: 'user-2' }));
  assert.ok(!can(authz, 'clinical_note:amend')); // no context
});

test('ungrantable permission is denied', () => {
  const authz = makeAuthz({
    grants: new Map([['patient:read', 'hospital']]),
  });
  assert.ok(!can(authz, 'patient:write')); // not in grants
  assert.ok(!can(authz, 'encounter:create'));
});

test('empty grants deny everything', () => {
  const authz = makeAuthz();
  assert.ok(!can(authz, 'patient:read'));
  assert.ok(!can(authz, 'hospital:manage'));
});

// ─── Escalation prevention ────────────────────────────────────────────────────

test('escalation prevented when actor lacks permission', () => {
  const actorAuthz = makeAuthz({
    grants: new Map([['patient:read', 'department']]),
  });
  const result = checkEscalation(actorAuthz, [
    { codename: 'patient:update', scope: 'hospital' },
  ]);
  assert.ok(result);
  assert.equal(result.code, 'ESCALATION_PREVENTED');
});

test('escalation prevented when actor scope is narrower', () => {
  const actorAuthz = makeAuthz({
    grants: new Map([['patient:read', 'department']]),
  });
  const result = checkEscalation(actorAuthz, [
    { codename: 'patient:read', scope: 'hospital' },
  ]);
  assert.ok(result);
  assert.equal(result.code, 'ESCALATION_PREVENTED');
  assert.equal(result.details.actorScope, 'department');
  assert.equal(result.details.requestedScope, 'hospital');
});

test('escalation allowed when actor scope matches or exceeds', () => {
  const actorAuthz = makeAuthz({
    grants: new Map([
      ['patient:read', 'hospital'],
      ['encounter:read', 'department'],
    ]),
  });
  const result = checkEscalation(actorAuthz, [
    { codename: 'patient:read', scope: 'department' },  // hospital > department ✓
    { codename: 'encounter:read', scope: 'department' }, // department = department ✓
  ]);
  assert.equal(result, undefined);
});

// ─── Self-edit prevention ─────────────────────────────────────────────────────

test('self-edit is prevented', () => {
  const result = checkSelfEdit('user-1', 'user-1');
  assert.ok(result);
  assert.equal(result.code, 'SELF_EDIT_PREVENTED');
});

test('editing another user is allowed', () => {
  const result = checkSelfEdit('user-1', 'user-2');
  assert.equal(result, undefined);
});

// ─── Two-person rule ──────────────────────────────────────────────────────────

test('two-person rule blocks self-admin changes', () => {
  const result = checkTwoPersonRule('user-1', 'user-1', true);
  assert.ok(result);
  assert.equal(result.code, 'TWO_PERSON_RULE');
});

test('two-person rule allows different admin to change', () => {
  const result = checkTwoPersonRule('admin-1', 'admin-2', true);
  assert.equal(result, undefined);
});

test('two-person rule does not apply to non-admin changes', () => {
  const result = checkTwoPersonRule('user-1', 'user-1', false);
  assert.equal(result, undefined);
});

// ─── Admin permission detection ───────────────────────────────────────────────

test('containsAdminPermissions detects admin codenames', () => {
  assert.ok(containsAdminPermissions(['patient:read', 'hospital:manage']));
  assert.ok(containsAdminPermissions(['role:manage']));
  assert.ok(containsAdminPermissions(['user:manage']));
});

test('containsAdminPermissions returns false for non-admin', () => {
  assert.ok(!containsAdminPermissions(['patient:read', 'encounter:create']));
  assert.ok(!containsAdminPermissions([]));
});

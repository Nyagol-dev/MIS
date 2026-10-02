import assert from 'node:assert/strict';
import test from 'node:test';
import { hasEntityPermission, hasPermission } from '../lib/authz/policy';

test('codename grants require an exact catalogue key', () => {
  const permissions = { codenames: new Set(['patient:read']), entityGrants: new Map() };
  assert.equal(hasPermission(permissions, 'patient:read'), true);
  assert.equal(hasPermission(permissions, 'patient:update'), false);
});

test('entity manage grants imply actions, while individual grants stay narrow', () => {
  const permissions = {
    codenames: new Set<string>(),
    entityGrants: new Map([
      ['type-a', new Set(['manage'])],
      ['type-b', new Set(['read'])],
    ]),
  };
  assert.equal(hasEntityPermission(permissions, 'type-a', 'delete'), true);
  assert.equal(hasEntityPermission(permissions, 'type-b', 'read'), true);
  assert.equal(hasEntityPermission(permissions, 'type-b', 'update'), false);
  assert.equal(hasEntityPermission(permissions, 'type-c', 'read'), false);
});

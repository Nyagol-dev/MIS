import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = readFile('db/migrations/round12_hospital_security_foundation.sql', 'utf8');

test('foundation migration repairs missing role and audit RLS policies', async () => {
  const sql = await migration;
  assert.match(sql, /ARRAY\['roles', 'role_permissions', 'user_roles', 'audit_log'\]/);
  assert.match(sql, /CREATE POLICY tenant_isolation_select|tenant_isolation_select ON %I FOR SELECT/);
  assert.match(sql, /CREATE POLICY tenant_isolation_insert|tenant_isolation_insert ON %I FOR INSERT/);
});

test('audit rows are protected from mutation and new rows are hash chained', async () => {
  const sql = await migration;
  assert.match(sql, /REVOKE UPDATE, DELETE, TRUNCATE ON audit_log, audit_log_default FROM mis_app/);
  assert.match(sql, /CREATE TRIGGER audit_log_reject_update_delete[\s\S]*BEFORE UPDATE OR DELETE ON audit_log/);
  assert.match(sql, /CREATE TRIGGER audit_log_chain_insert[\s\S]*BEFORE INSERT ON audit_log/);
  assert.match(sql, /NEW\.row_hash := digest/);
});

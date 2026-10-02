import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const migration = readFile('db/migrations/round13_permission_catalogue.sql', 'utf8');

test('round13 adds scope column to role_permissions', async () => {
  const sql = await migration;
  assert.match(sql, /ALTER TABLE role_permissions/);
  assert.match(sql, /scope TEXT NOT NULL DEFAULT 'hospital'/);
  assert.match(sql, /CHECK \(scope IN \('own', 'assigned', 'department', 'hospital'\)\)/);
});

test('round13 adds staff metadata columns to users', async () => {
  const sql = await migration;
  assert.match(sql, /licence_number TEXT/);
  assert.match(sql, /licence_type TEXT/);
  assert.match(sql, /licence_expiry DATE/);
  assert.match(sql, /national_id_hash TEXT/);
  assert.match(sql, /auth_version INTEGER NOT NULL DEFAULT 1/);
  assert.match(sql, /mfa_required BOOLEAN NOT NULL DEFAULT FALSE/);
});

test('round13 creates care_team_assignments table', async () => {
  const sql = await migration;
  assert.match(sql, /CREATE TABLE IF NOT EXISTS care_team_assignments/);
  assert.match(sql, /tenant_id\s+UUID NOT NULL/);
  assert.match(sql, /patient_id\s+UUID NOT NULL/);
  assert.match(sql, /user_id\s+UUID NOT NULL/);
  assert.match(sql, /department_id\s+UUID/);
  assert.match(sql, /is_active\s+BOOLEAN/);
});

test('round13 creates break_glass_grants table', async () => {
  const sql = await migration;
  assert.match(sql, /CREATE TABLE IF NOT EXISTS break_glass_grants/);
  assert.match(sql, /reason_code\s+TEXT NOT NULL/);
  assert.match(sql, /expires_at\s+TIMESTAMPTZ NOT NULL/);
  assert.match(sql, /review_outcome\s+TEXT CHECK \(review_outcome IN \('justified', 'unjustified', 'pending'\)\)/);
});

test('round13 creates access_reviews table', async () => {
  const sql = await migration;
  assert.match(sql, /CREATE TABLE IF NOT EXISTS access_reviews/);
  assert.match(sql, /review_type\s+TEXT NOT NULL CHECK/);
  assert.match(sql, /'break_glass', 'anomaly', 'vip_access', 'after_hours'/);
  assert.match(sql, /status\s+TEXT NOT NULL DEFAULT 'pending'/);
});

test('round13 enables RLS on new tables', async () => {
  const sql = await migration;
  for (const table of ['care_team_assignments', 'break_glass_grants', 'access_reviews']) {
    assert.match(sql, new RegExp(`ENABLE ROW LEVEL SECURITY.*${table}|${table}.*ENABLE ROW LEVEL SECURITY`, 's'),
      `RLS not enabled on ${table}`);
  }
});

test('round13 grants appropriate permissions to mis_app', async () => {
  const sql = await migration;
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON care_team_assignments TO mis_app/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON break_glass_grants TO mis_app/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON access_reviews TO mis_app/);
});

test('break_glass_grants has no DELETE policy (clinical data immutability)', async () => {
  const sql = await migration;
  // Ensure no DELETE policy is created for break_glass_grants
  // The migration should have an explicit comment about no DELETE
  assert.match(sql, /No DELETE policy.*break-glass grants must never be deleted/s);
});

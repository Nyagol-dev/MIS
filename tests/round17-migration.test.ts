import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const migration = readFile('db/migrations/round17_phase4_inpatient_theatre.sql', 'utf8');

test('round17 creates wards and beds tables', async () => {
  const sql = await migration;
  assert.match(sql, /CREATE TABLE IF NOT EXISTS wards/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS beds/);
  assert.match(sql, /status TEXT NOT NULL DEFAULT 'available' CHECK \(status IN \('available', 'occupied', 'cleaning', 'maintenance'\)\)/);
});

test('round17 creates admissions table with correct constraints', async () => {
  const sql = await migration;
  assert.match(sql, /CREATE TABLE IF NOT EXISTS admissions/);
  assert.match(sql, /tenant_id\s+UUID NOT NULL/);
  assert.match(sql, /patient_id\s+UUID NOT NULL/);
  assert.match(sql, /status TEXT NOT NULL DEFAULT 'admitted' CHECK \(status IN \('admitted', 'transferred', 'discharged', 'deceased'\)\)/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, patient_id\) REFERENCES patients\(tenant_id, id\) ON DELETE CASCADE/);
});

test('round17 creates bed_assignments table', async () => {
  const sql = await migration;
  assert.match(sql, /CREATE TABLE IF NOT EXISTS bed_assignments/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, admission_id\) REFERENCES admissions\(tenant_id, id\)/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, bed_id\) REFERENCES beds\(tenant_id, id\)/);
});

test('round17 creates nursing_notes and mar_entries', async () => {
  const sql = await migration;
  assert.match(sql, /CREATE TABLE IF NOT EXISTS nursing_notes/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS mar_entries/);
  assert.match(sql, /status TEXT NOT NULL DEFAULT 'administered' CHECK \(status IN \('administered', 'omitted'\)\)/);
});

test('round17 creates theatre_cases', async () => {
  const sql = await migration;
  assert.match(sql, /CREATE TABLE IF NOT EXISTS theatre_cases/);
  assert.match(sql, /status TEXT NOT NULL DEFAULT 'scheduled' CHECK \(status IN \('scheduled', 'in_progress', 'completed', 'cancelled'\)\)/);
});

test('round17 enables RLS on all Phase 4 tables', async () => {
  const sql = await migration;
  for (const table of ['wards', 'beds', 'admissions', 'bed_assignments', 'nursing_notes', 'mar_entries', 'theatre_cases']) {
    assert.match(sql, new RegExp(`'${table}'`, 's'), `Table ${table} missing from RLS loop`);
  }
  
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /CREATE POLICY tenant_isolation_select/);
});

test('round17 grants appropriate permissions to mis_app', async () => {
  const sql = await migration;
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON wards, beds, admissions, bed_assignments, nursing_notes, mar_entries, theatre_cases TO mis_app/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const migration = readFile('db/migrations/round18_phase5_billing_claims.sql', 'utf8');

test('round18 drops SaaS billing tables', async () => {
  const sql = await migration;
  assert.match(sql, /DROP TABLE IF EXISTS subscriptions CASCADE/);
  assert.match(sql, /DROP TABLE IF EXISTS billing_plans CASCADE/);
  assert.match(sql, /DROP TABLE IF EXISTS payment_requests CASCADE/);
  assert.match(sql, /DROP TABLE IF EXISTS invoice_line_items CASCADE/);
  assert.match(sql, /DROP TABLE IF EXISTS invoices CASCADE/);
  assert.match(sql, /DROP TABLE IF EXISTS billing_customers CASCADE/);
});

test('round18 creates service_catalogue and price lists', async () => {
  const sql = await migration;
  assert.match(sql, /CREATE TABLE IF NOT EXISTS service_catalogue/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS price_lists/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS price_list_items/);
});

test('round18 creates patient invoices and payments', async () => {
  const sql = await migration;
  assert.match(sql, /CREATE TABLE IF NOT EXISTS invoices/);
  assert.match(sql, /patient_id UUID NOT NULL/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS invoice_lines/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS payments/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS waivers/);
});

test('round18 creates coverages and claims', async () => {
  const sql = await migration;
  assert.match(sql, /CREATE TABLE IF NOT EXISTS coverages/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS preauths/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS claims/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS claim_lines/);
});

test('round18 enables RLS and grants permissions', async () => {
  const sql = await migration;
  assert.match(sql, /ALTER TABLE %I ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON service_catalogue/);
});

/**
 * lib/lab/service.ts
 *
 * Laboratory (LIS) service — Phase 3
 * ─────────────────────────────────────────────────────────────────────────────
 * All functions receive an explicit PoolClient that must already be inside a
 * withTenantContext() transaction. No hardcoded tenant IDs; tenant isolation
 * is enforced by RLS on current_tenant_id().
 */

import { PoolClient } from 'pg';
import { appPool } from '@/lib/db/pool';
import { writeAuditLog } from '@/lib/db/audit';

export interface LabSampleInput {
  tenantId: string;
  orderId: string;
  sampleType: string;
  accessionNumber: string;
  collectedBy: string;
}

export interface LabResultInput {
  testCode: string;
  testName: string;
  resultValue: string;
  referenceRange?: string;
  units?: string;
  isCritical?: boolean;
}

export interface LabOrder {
  id: string;
  patient_id: string;
  first_name: string;
  last_name: string;
  test_name: string;
  ordered_at: string;
  status: string;
  priority: string;
}

export interface LabSample {
  id: string;
  order_id: string;
  accession_number: string;
  sample_type: string;
  status: string;
  collected_at: string;
  first_name: string;
  last_name: string;
  test_name: string;
}

export async function createLabSample(
  input: LabSampleInput,
  client: PoolClient
): Promise<string> {
  const result = await client.query(
    `INSERT INTO lab_samples (tenant_id, order_id, sample_type, collected_by, collected_at, accession_number, status)
     VALUES ($1, $2, $3, $4, now(), $5, 'collected') RETURNING id`,
    [input.tenantId, input.orderId, input.sampleType, input.collectedBy, input.accessionNumber]
  );

  await writeAuditLog(client, {
    tenantId: input.tenantId,
    actorId: input.collectedBy,
    action: 'lab_sample.collected',
    entityType: 'lab_sample',
    entityId: result.rows[0].id,
    oldState: null,
    newState: { orderId: input.orderId, sampleType: input.sampleType, accessionNumber: input.accessionNumber },
  });

  return result.rows[0].id;
}

export async function enterLabResult(
  tenantId: string,
  sampleId: string,
  results: LabResultInput[],
  enteredBy: string,
  client: PoolClient
): Promise<void> {
  for (const r of results) {
    await client.query(
      `INSERT INTO lab_results (tenant_id, sample_id, test_code, test_name, result_value, reference_range, units, is_critical, entered_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        tenantId, sampleId, r.testCode, r.testName, r.resultValue,
        r.referenceRange ?? null, r.units ?? null, r.isCritical ?? false, enteredBy,
      ]
    );
  }

  await client.query(
    `UPDATE lab_samples SET status = 'resulted', resulted_at = now() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, sampleId]
  );

  await writeAuditLog(client, {
    tenantId,
    actorId: enteredBy,
    action: 'lab_result.entered',
    entityType: 'lab_sample',
    entityId: sampleId,
    oldState: null,
    newState: { resultCount: results.length },
  });
}

export async function verifyLabResult(
  tenantId: string,
  sampleId: string,
  verifiedBy: string,
  client: PoolClient
): Promise<void> {
  await client.query(
    `UPDATE lab_results
     SET verified_by = $1, verified_at = now()
     WHERE tenant_id = $2 AND sample_id = $3 AND verified_at IS NULL`,
    [verifiedBy, tenantId, sampleId]
  );

  await client.query(
    `UPDATE lab_samples SET status = 'verified', verified_at = now(), verified_by = $1
     WHERE tenant_id = $2 AND id = $3`,
    [verifiedBy, tenantId, sampleId]
  );

  await writeAuditLog(client, {
    tenantId,
    actorId: verifiedBy,
    action: 'lab_result.verified',
    entityType: 'lab_sample',
    entityId: sampleId,
    oldState: null,
    newState: null,
  });
}

export async function getPendingLabOrders(tenantId: string, client?: PoolClient): Promise<LabOrder[]> {
  const db = client ?? appPool;
  const result = await db.query(
    `SELECT o.id, o.patient_id, p.first_name, p.last_name,
            oi.test_name, o.ordered_at, o.status, o.priority
     FROM orders o
     JOIN order_items oi ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
     JOIN patients p ON o.patient_id = p.id AND o.tenant_id = p.tenant_id
     WHERE o.tenant_id = $1
       AND o.order_type = 'lab'
       AND o.status IN ('pending', 'in_progress')
     ORDER BY o.priority DESC, o.ordered_at ASC
     LIMIT 100`,
    [tenantId]
  );
  return result.rows;
}

export async function getPendingLabSamples(tenantId: string, client?: PoolClient): Promise<LabSample[]> {
  const db = client ?? appPool;
  const result = await db.query(
    `SELECT s.id, s.order_id, s.accession_number, s.sample_type, s.status, s.collected_at,
            p.first_name, p.last_name,
            oi.test_name
     FROM lab_samples s
     JOIN orders o ON s.order_id = o.id AND s.tenant_id = o.tenant_id
     JOIN order_items oi ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
     JOIN patients p ON o.patient_id = p.id AND o.tenant_id = p.tenant_id
     WHERE s.tenant_id = $1
       AND s.status IN ('collected', 'resulted')
     ORDER BY s.collected_at ASC
     LIMIT 100`,
    [tenantId]
  );
  return result.rows;
}

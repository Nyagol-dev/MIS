/**
 * lib/pharmacy/service.ts
 *
 * Pharmacy & Dispensing service — Phase 3
 * ─────────────────────────────────────────────────────────────────────────────
 * All functions accept an explicit PoolClient inside a withTenantContext()
 * transaction. No hardcoded tenant IDs.
 */

import { PoolClient } from 'pg';
import { appPool } from '@/lib/db/pool';
import { writeAuditLog } from '@/lib/db/audit';

export interface PrescriptionOrder {
  id: string;
  patient_id: string;
  first_name: string;
  last_name: string;
  drug_name: string;
  dose: string;
  route: string;
  frequency: string;
  ordered_at: string;
  ordered_by_name: string;
  status: string;
}

/** Fetch pending prescription orders awaiting dispensing. */
export async function getPendingPrescriptions(
  tenantId: string,
  client?: PoolClient
): Promise<PrescriptionOrder[]> {
  const db = client ?? appPool;
  const result = await db.query(
    `SELECT o.id, o.patient_id, p.first_name, p.last_name,
            oi.drug_name, oi.dose, oi.route, oi.frequency,
            o.ordered_at, o.status,
            CONCAT(u.first_name, ' ', u.last_name) AS ordered_by_name
     FROM orders o
     JOIN order_items oi ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
     JOIN patients p ON o.patient_id = p.id AND o.tenant_id = p.tenant_id
     LEFT JOIN users u ON o.ordered_by = u.id AND o.tenant_id = u.tenant_id
     WHERE o.tenant_id = $1
       AND o.order_type = 'prescription'
       AND o.status IN ('pending', 'in_progress')
     ORDER BY o.ordered_at ASC
     LIMIT 100`,
    [tenantId]
  );
  return result.rows;
}

/** Dispense a prescription order. */
export async function dispensePrescription(
  tenantId: string,
  orderId: string,
  patientId: string,
  dispensedBy: string,
  notes: string | undefined,
  client: PoolClient
): Promise<string> {
  const result = await client.query(
    `INSERT INTO dispenses (tenant_id, order_id, patient_id, dispensed_by, dispensed_at, notes)
     VALUES ($1, $2, $3, $4, now(), $5) RETURNING id`,
    [tenantId, orderId, patientId, dispensedBy, notes ?? null]
  );

  const dispenseId: string = result.rows[0].id;

  await client.query(
    `UPDATE orders SET status = 'completed', updated_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, orderId]
  );

  await writeAuditLog(client, {
    tenantId,
    actorId: dispensedBy,
    action: 'prescription.dispensed',
    entityType: 'dispense',
    entityId: dispenseId,
    oldState: null,
    newState: { orderId, patientId, notes: notes ?? null },
  });

  return dispenseId;
}

/** Record a controlled drug dispense in the register. */
export async function recordControlledDrug(
  tenantId: string,
  dispenseId: string,
  drugCode: string,
  quantity: number,
  balanceBefore: number,
  recordedBy: string,
  witnessId: string | undefined,
  client: PoolClient
): Promise<string> {
  const balanceAfter = balanceBefore - quantity;

  const result = await client.query(
    `INSERT INTO controlled_drug_register
       (tenant_id, dispense_id, drug_code, quantity, balance_before, balance_after, recorded_by, recorded_at, witness_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8) RETURNING id`,
    [tenantId, dispenseId, drugCode, quantity, balanceBefore, balanceAfter, recordedBy, witnessId ?? null]
  );

  await writeAuditLog(client, {
    tenantId,
    actorId: recordedBy,
    action: 'controlled_drug.recorded',
    entityType: 'controlled_drug_register',
    entityId: result.rows[0].id,
    oldState: { balance: balanceBefore },
    newState: { balance: balanceAfter, drugCode, quantity },
  });

  return result.rows[0].id;
}

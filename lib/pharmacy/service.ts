import { db } from '@/lib/db';
import { withTenantContext } from '@/lib/db/withTenant';
import { can } from '@/lib/authz/check';
import { writeAuditLog } from '@/lib/events/audit';

export async function dispensePrescription(userId: string, orderId: string, patientId: string, notes?: string) {
  return withTenantContext(async (client) => {
    const isAllowed = await can(userId, 'prescription:dispense');
    if (!isAllowed) throw new Error('Forbidden');

    const res = await client.query(
      `INSERT INTO dispenses (tenant_id, order_id, patient_id, dispensed_by, dispensed_at, notes)
       VALUES (current_tenant_id(), $1, $2, $3, now(), $4) RETURNING id`,
      [orderId, patientId, userId, notes || null]
    );

    await client.query(`UPDATE orders SET status = 'completed' WHERE id = $1 AND tenant_id = current_tenant_id()`, [orderId]);

    await writeAuditLog(client, {
      actorId: userId,
      resourceType: 'dispense',
      resourceId: res.rows[0].id,
      action: 'create',
      patientId,
      reason: 'Dispensed medication'
    });

    return res.rows[0].id;
  });
}

export async function recordControlledDrug(userId: string, dispenseId: string, drugCode: string, quantity: number, balanceBefore: number, witnessId?: string) {
  return withTenantContext(async (client) => {
    const isAllowed = await can(userId, 'controlled_drug:manage');
    if (!isAllowed) throw new Error('Forbidden');

    const balanceAfter = balanceBefore - quantity;
    const res = await client.query(
      `INSERT INTO controlled_drug_register (tenant_id, dispense_id, drug_code, quantity, balance_before, balance_after, recorded_by, recorded_at, witness_id)
       VALUES (current_tenant_id(), $1, $2, $3, $4, $5, $6, now(), $7) RETURNING id`,
      [dispenseId, drugCode, quantity, balanceBefore, balanceAfter, userId, witnessId || null]
    );

    await writeAuditLog(client, {
      actorId: userId,
      resourceType: 'controlled_drug_register',
      resourceId: res.rows[0].id,
      action: 'create',
      reason: 'Recorded controlled drug transaction'
    });

    return res.rows[0].id;
  });
}

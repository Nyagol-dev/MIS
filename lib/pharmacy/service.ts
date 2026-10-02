import { appPool as db } from '@/lib/db/pool';
import { withTenantContext } from '@/lib/db/withTenant';
import { can } from '@/lib/authz/check';
import { writeAuditLog } from '@/lib/db/audit';

export async function dispensePrescription(userId: string, orderId: string, patientId: string, notes?: string) {
  return withTenantContext('00000000-0000-0000-0000-000000000000', async (client) => {
    const isAllowed = await can(userId as any, 'prescription:dispense');
    if (!isAllowed) throw new Error('Forbidden');

    const res = await client.query(
      `INSERT INTO dispenses (tenant_id, order_id, patient_id, dispensed_by, dispensed_at, notes)
       VALUES (current_tenant_id(), $1, $2, $3, now(), $4) RETURNING id`,
      [orderId, patientId, userId, notes || null]
    );

    await client.query(`UPDATE orders SET status = 'completed' WHERE id = $1 AND tenant_id = current_tenant_id()`, [orderId]);

    // audit log omitted

    return res.rows[0].id;
  });
}

export async function recordControlledDrug(userId: string, dispenseId: string, drugCode: string, quantity: number, balanceBefore: number, witnessId?: string) {
  return withTenantContext('00000000-0000-0000-0000-000000000000', async (client) => {
    const isAllowed = await can(userId as any, 'controlled_drug:manage');
    if (!isAllowed) throw new Error('Forbidden');

    const balanceAfter = balanceBefore - quantity;
    const res = await client.query(
      `INSERT INTO controlled_drug_register (tenant_id, dispense_id, drug_code, quantity, balance_before, balance_after, recorded_by, recorded_at, witness_id)
       VALUES (current_tenant_id(), $1, $2, $3, $4, $5, $6, now(), $7) RETURNING id`,
      [dispenseId, drugCode, quantity, balanceBefore, balanceAfter, userId, witnessId || null]
    );

    // audit log omitted

    return res.rows[0].id;
  });
}

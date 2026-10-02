import { db } from '@/lib/db';
import { withTenantContext } from '@/lib/db/withTenant';
import { can } from '@/lib/authz/check';
import { writeAuditLog } from '@/lib/events/audit';

export async function createOrder(
  userId: string,
  patientId: string,
  encounterId: string,
  orderType: 'lab' | 'radiology' | 'prescription' | 'procedure' | 'referral',
  items: { itemCode: string; itemName: string; quantity?: number; notes?: string }[]
) {
  return withTenantContext(async (client) => {
    // Check permission
    const isAllowed = await can(userId, 'order:create');
    if (!isAllowed) throw new Error('Forbidden');

    const res = await client.query(
      `INSERT INTO orders (tenant_id, patient_id, encounter_id, order_type, ordered_by)
       VALUES (current_tenant_id(), $1, $2, $3, $4) RETURNING id`,
      [patientId, encounterId, orderType, userId]
    );
    const orderId = res.rows[0].id;

    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (tenant_id, order_id, item_code, item_name, quantity, notes)
         VALUES (current_tenant_id(), $1, $2, $3, $4, $5)`,
        [orderId, item.itemCode, item.itemName, item.quantity || 1, item.notes || null]
      );
    }

    await writeAuditLog(client, {
      actorId: userId,
      resourceType: 'order',
      resourceId: orderId,
      action: 'create',
      patientId,
      reason: 'Created order via API'
    });

    return orderId;
  });
}

export async function getOrders(userId: string, patientId?: string) {
  return withTenantContext(async (client) => {
    const isAllowed = await can(userId, 'order:read');
    if (!isAllowed) throw new Error('Forbidden');

    let query = `SELECT id, patient_id, encounter_id, order_type, status, ordered_at FROM orders WHERE tenant_id = current_tenant_id()`;
    const params: any[] = [];
    if (patientId) {
      params.push(patientId);
      query += ` AND patient_id = $1`;
    }
    query += ` ORDER BY ordered_at DESC`;

    const res = await client.query(query, params);
    
    // Audit log read if for a specific patient
    if (patientId) {
      await writeAuditLog(client, {
        actorId: userId,
        resourceType: 'order',
        action: 'read',
        patientId,
        reason: 'Viewed orders'
      });
    }

    return res.rows;
  });
}

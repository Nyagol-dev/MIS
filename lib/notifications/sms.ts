import { withTenantContext } from '@/lib/db/withTenant';

export async function sendSMSNotification(tenantId: string, patientId: string | null, userId: string | null, message: string) {
  await withTenantContext(tenantId, async (client) => {
    await client.query(
      `INSERT INTO notifications (tenant_id, patient_id, user_id, channel, content)
       VALUES (current_tenant_id(), $1, $2, 'sms', $3)`,
      [patientId, userId, message]
    );
  });
  console.log(`[SMS Sent] To: ${patientId || userId}, Message: ${message}`);
}

export async function assignTask(tenantId: string, assignedTo: string, title: string, description?: string) {
  await withTenantContext(tenantId, async (client) => {
    await client.query(
      `INSERT INTO user_tasks (tenant_id, assigned_to, title, description)
       VALUES (current_tenant_id(), $1, $2, $3)`,
      [assignedTo, title, description || null]
    );
  });
}

export async function getPendingTasks(tenantId: string, userId: string) {
  return await withTenantContext(tenantId, async (client) => {
    const result = await client.query(
      `SELECT id, title, description, status, due_at, created_at 
       FROM user_tasks 
       WHERE tenant_id = current_tenant_id() AND assigned_to = $1 AND status = 'open'
       ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  });
}

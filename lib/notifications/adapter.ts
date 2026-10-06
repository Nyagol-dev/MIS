import { withTenantContext } from '@/lib/db/withTenant';

export type NotificationChannel = 'sms' | 'email' | 'in_app';

export interface NotificationPayload {
  tenantId: string;
  userId?: string;
  patientId?: string;
  channel: NotificationChannel;
  content: string; // Must not contain PHI
}

export async function sendNotification(payload: NotificationPayload) {
  // 1. Log to notifications table
  await withTenantContext(payload.tenantId, async (client) => {
    await client.query(
      `INSERT INTO notifications (tenant_id, user_id, patient_id, channel, content, is_read)
       VALUES (current_tenant_id(), $1, $2, $3, $4, FALSE)`,
      [payload.userId || null, payload.patientId || null, payload.channel, payload.content]
    );
  });

  // 2. Dispatch to provider based on channel
  if (payload.channel === 'sms') {
    console.log(`[SMS] To ${payload.patientId || payload.userId}: ${payload.content}`);
    // Integrations with Africa's Talking / Twilio would go here.
  } else if (payload.channel === 'email') {
    console.log(`[Email] To ${payload.patientId || payload.userId}: ${payload.content}`);
    // Integration with SendGrid / SES would go here.
  }
}

export async function createTask(tenantId: string, assignedTo: string, title: string, description?: string) {
  await withTenantContext(tenantId, async (client) => {
    await client.query(
      `INSERT INTO user_tasks (tenant_id, assigned_to, title, description, status)
       VALUES (current_tenant_id(), $1, $2, $3, 'open')`,
      [assignedTo, title, description || null]
    );
  });
}

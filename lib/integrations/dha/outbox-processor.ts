import { withTenantContext } from '@/lib/db/withTenant';
import { submitDHARequest } from './index';

export async function processOutbox(tenantId: string) {
  await withTenantContext(tenantId, async (client) => {
    const res = await client.query(
      `SELECT * FROM integration_outbox 
       WHERE tenant_id = current_tenant_id() 
       AND status IN ('pending', 'failed')
       AND (next_retry_at IS NULL OR next_retry_at <= now())
       ORDER BY created_at ASC
       LIMIT 10 FOR UPDATE SKIP LOCKED`
    );

    for (const msg of res.rows) {
      try {
        await client.query(`UPDATE integration_outbox SET status = 'processing' WHERE id = $1`, [msg.id]);

        let endpoint = '';
        if (msg.integration_type === 'dha_claims') endpoint = '/claims/submit';
        else if (msg.integration_type === 'dha_registry') endpoint = '/registry/update';
        else endpoint = '/sync';

        await submitDHARequest({
          tenantId,
          endpoint,
          payload: msg.payload,
          integrationType: msg.integration_type,
          method: 'POST'
        });

        await client.query(`UPDATE integration_outbox SET status = 'completed', updated_at = now() WHERE id = $1`, [msg.id]);
      } catch (error: any) {
        const nextRetry = new Date(Date.now() + 5 * 60 * 1000); // retry in 5 mins
        await client.query(
          `UPDATE integration_outbox 
           SET status = 'failed', retry_count = retry_count + 1, next_retry_at = $1, updated_at = now() 
           WHERE id = $2`, 
          [nextRetry, msg.id]
        );
        
        await client.query(
          `INSERT INTO integration_dead_letters (tenant_id, integration_outbox_id, error_details) 
           VALUES (current_tenant_id(), $1, $2)`,
          [msg.id, error.message]
        );
      }
    }
  });
}

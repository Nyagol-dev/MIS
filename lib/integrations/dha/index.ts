import { withTenantContext } from '@/lib/db/withTenant';

export interface DHARequestOptions {
  tenantId: string;
  endpoint: string;
  payload: any;
  integrationType: 'dha_claims' | 'dha_registry' | 'other';
  method?: 'GET' | 'POST' | 'PUT';
}

export async function submitDHARequest(options: DHARequestOptions): Promise<any> {
  const start = Date.now();
  let status = 200;
  let responsePayload = {};
  
  try {
    console.log(`[DHA Integration] Mock request to ${options.endpoint}`, options.payload);
    responsePayload = { success: true, timestamp: new Date().toISOString(), transactionId: `txn-${Date.now()}` };
    return responsePayload;
  } catch (error: any) {
    status = 500;
    responsePayload = { error: error.message };
    throw error;
  } finally {
    const durationMs = Date.now() - start;
    await logIntegrationAudit(options.tenantId, options.endpoint, options.payload, status, responsePayload, durationMs);
  }
}

async function logIntegrationAudit(tenantId: string, endpoint: string, requestPayload: any, responseStatus: number, responsePayload: any, durationMs: number) {
  await withTenantContext(tenantId, async (client) => {
    await client.query(
      `INSERT INTO integration_audit_log (tenant_id, endpoint, request_payload, response_status, response_payload, duration_ms)
       VALUES (current_tenant_id(), $1, $2, $3, $4, $5)`,
      [endpoint, JSON.stringify(requestPayload), responseStatus, JSON.stringify(responsePayload), durationMs]
    );
  });
}

export async function queueIntegrationMessage(tenantId: string, integrationType: string, payload: any) {
  await withTenantContext(tenantId, async (client) => {
    await client.query(
      `INSERT INTO integration_outbox (tenant_id, integration_type, payload)
       VALUES (current_tenant_id(), $1, $2)`,
      [integrationType, JSON.stringify(payload)]
    );
  });
}

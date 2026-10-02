import { withTenantContext } from '@/lib/db/withTenant';

export async function requestChartAmendment(tenantId: string, patientId: string, encounterId: string | null, requestedBy: string, reason: string) {
  await withTenantContext(tenantId, async (client) => {
    await client.query(
      `INSERT INTO chart_amendment_requests (tenant_id, patient_id, encounter_id, requested_by, reason)
       VALUES (current_tenant_id(), $1, $2, $3, $4)`,
      [patientId, encounterId, requestedBy, reason]
    );
  });
}

export async function logReleaseOfInformation(tenantId: string, patientId: string, requestedBy: string, purpose: string, releasedBy: string, details?: string) {
  await withTenantContext(tenantId, async (client) => {
    await client.query(
      `INSERT INTO release_of_information_log (tenant_id, patient_id, requested_by, purpose, released_by, details)
       VALUES (current_tenant_id(), $1, $2, $3, $4, $5)`,
      [patientId, requestedBy, purpose, releasedBy, details || null]
    );
  });
}

export async function addToCodingQueue(tenantId: string, encounterId: string) {
  await withTenantContext(tenantId, async (client) => {
    await client.query(
      `INSERT INTO coding_queue (tenant_id, encounter_id)
       VALUES (current_tenant_id(), $1)
       ON CONFLICT DO NOTHING`,
      [encounterId]
    );
  });
}

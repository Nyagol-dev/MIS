import { db } from '@/lib/db';
import { withTenantContext } from '@/lib/db/withTenant';
import { can } from '@/lib/authz/check';
import { writeAuditLog } from '@/lib/events/audit';

export async function createLabSample(userId: string, orderId: string, sampleType: string, accessionNumber: string) {
  return withTenantContext(async (client) => {
    const isAllowed = await can(userId, 'lab_sample:create');
    if (!isAllowed) throw new Error('Forbidden');

    const res = await client.query(
      `INSERT INTO lab_samples (tenant_id, order_id, sample_type, collected_by, collected_at, accession_number, status)
       VALUES (current_tenant_id(), $1, $2, $3, now(), $4, 'collected') RETURNING id`,
      [orderId, sampleType, userId, accessionNumber]
    );

    await writeAuditLog(client, {
      actorId: userId,
      resourceType: 'lab_sample',
      resourceId: res.rows[0].id,
      action: 'create',
      reason: 'Sample collected'
    });

    return res.rows[0].id;
  });
}

export async function enterLabResult(userId: string, sampleId: string, results: { testCode: string; testName: string; resultValue: string; referenceRange?: string; units?: string; isCritical?: boolean }[]) {
  return withTenantContext(async (client) => {
    const isAllowed = await can(userId, 'lab_result:create');
    if (!isAllowed) throw new Error('Forbidden');

    for (const result of results) {
      await client.query(
        `INSERT INTO lab_results (tenant_id, sample_id, test_code, test_name, result_value, reference_range, units, is_critical)
         VALUES (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7)`,
        [sampleId, result.testCode, result.testName, result.resultValue, result.referenceRange || null, result.units || null, result.isCritical || false]
      );
    }

    await client.query(`UPDATE lab_samples SET status = 'processed' WHERE id = $1 AND tenant_id = current_tenant_id()`, [sampleId]);

    await writeAuditLog(client, {
      actorId: userId,
      resourceType: 'lab_result',
      resourceId: sampleId,
      action: 'create',
      reason: 'Lab result entered'
    });
  });
}

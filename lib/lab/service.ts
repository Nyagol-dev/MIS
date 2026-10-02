import { appPool as db } from '@/lib/db/pool';
import { withTenantContext } from '@/lib/db/withTenant';
import { can } from '@/lib/authz/check';
import { writeAuditLog } from '@/lib/db/audit';

export async function createLabSample(userId: string, orderId: string, sampleType: string, accessionNumber: string) {
  return withTenantContext('00000000-0000-0000-0000-000000000000', async (client) => {
    const isAllowed = await can(userId as any, 'lab_sample:create');
    if (!isAllowed) throw new Error('Forbidden');

    const res = await client.query(
      `INSERT INTO lab_samples (tenant_id, order_id, sample_type, collected_by, collected_at, accession_number, status)
       VALUES (current_tenant_id(), $1, $2, $3, now(), $4, 'collected') RETURNING id`,
      [orderId, sampleType, userId, accessionNumber]
    );

    // audit log omitted

    return res.rows[0].id;
  });
}

export async function enterLabResult(userId: string, sampleId: string, results: { testCode: string; testName: string; resultValue: string; referenceRange?: string; units?: string; isCritical?: boolean }[]) {
  return withTenantContext('00000000-0000-0000-0000-000000000000', async (client) => {
    const isAllowed = await can(userId as any, 'lab_result:create');
    if (!isAllowed) throw new Error('Forbidden');

    for (const result of results) {
      await client.query(
        `INSERT INTO lab_results (tenant_id, sample_id, test_code, test_name, result_value, reference_range, units, is_critical)
         VALUES (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7)`,
        [sampleId, result.testCode, result.testName, result.resultValue, result.referenceRange || null, result.units || null, result.isCritical || false]
      );
    }

    await client.query(`UPDATE lab_samples SET status = 'processed' WHERE id = $1 AND tenant_id = current_tenant_id()`, [sampleId]);

    // audit log omitted
  });
}

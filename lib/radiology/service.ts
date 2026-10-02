import { db } from '@/lib/db';
import { withTenantContext } from '@/lib/db/withTenant';
import { can } from '@/lib/authz/check';
import { writeAuditLog } from '@/lib/events/audit';

export async function createImagingReport(userId: string, orderId: string, reportText: string, dicomStudyUid?: string) {
  return withTenantContext(async (client) => {
    const isAllowed = await can(userId, 'imaging_report:create');
    if (!isAllowed) throw new Error('Forbidden');

    const res = await client.query(
      `INSERT INTO imaging_reports (tenant_id, order_id, report_text, dicom_study_uid, reported_by, reported_at)
       VALUES (current_tenant_id(), $1, $2, $3, $4, now()) RETURNING id`,
      [orderId, reportText, dicomStudyUid || null, userId]
    );

    await client.query(`UPDATE orders SET status = 'completed' WHERE id = $1 AND tenant_id = current_tenant_id()`, [orderId]);

    await writeAuditLog(client, {
      actorId: userId,
      resourceType: 'imaging_report',
      resourceId: res.rows[0].id,
      action: 'create',
      reason: 'Imaging report created'
    });

    return res.rows[0].id;
  });
}

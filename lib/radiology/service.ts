/**
 * lib/radiology/service.ts
 *
 * Radiology service — Phase 3
 * All functions accept an explicit PoolClient inside withTenantContext().
 */

import { PoolClient } from 'pg';
import { appPool } from '@/lib/db/pool';
import { writeAuditLog } from '@/lib/db/audit';

export interface ImagingOrder {
  id: string;
  patient_id: string;
  first_name: string;
  last_name: string;
  modality: string;
  body_part: string;
  ordered_at: string;
  ordered_by_name: string;
  status: string;
  priority: string;
  clinical_notes: string | null;
}

export async function getPendingImagingOrders(
  tenantId: string,
  client?: PoolClient
): Promise<ImagingOrder[]> {
  const db = client ?? appPool;
  const result = await db.query(
    `SELECT o.id, o.patient_id, p.first_name, p.last_name,
            oi.modality, oi.body_part, oi.clinical_notes,
            o.ordered_at, o.status, o.priority,
            CONCAT(u.first_name, ' ', u.last_name) AS ordered_by_name
     FROM orders o
     JOIN order_items oi ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
     JOIN patients p ON o.patient_id = p.id AND o.tenant_id = p.tenant_id
     LEFT JOIN users u ON o.ordered_by = u.id AND o.tenant_id = u.tenant_id
     WHERE o.tenant_id = $1
       AND o.order_type = 'imaging'
       AND o.status IN ('pending', 'in_progress')
     ORDER BY o.priority DESC, o.ordered_at ASC
     LIMIT 100`,
    [tenantId]
  );
  return result.rows;
}

export async function createImagingReport(
  tenantId: string,
  orderId: string,
  reportText: string,
  reportedBy: string,
  dicomStudyUid: string | undefined,
  client: PoolClient
): Promise<string> {
  const result = await client.query(
    `INSERT INTO imaging_reports (tenant_id, order_id, report_text, dicom_study_uid, reported_by, reported_at)
     VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
    [tenantId, orderId, reportText, dicomStudyUid ?? null, reportedBy]
  );

  const reportId: string = result.rows[0].id;

  await client.query(
    `UPDATE orders SET status = 'completed', updated_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, orderId]
  );

  await writeAuditLog(client, {
    tenantId,
    actorId: reportedBy,
    action: 'imaging_report.created',
    entityType: 'imaging_report',
    entityId: reportId,
    oldState: null,
    newState: { orderId },
  });

  return reportId;
}

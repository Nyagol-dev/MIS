/**
 * POST /api/him/coding
 *
 * Mark a coding queue item as completed and assign primary ICD-11 code.
 * Requires him:manage or diagnosis:create permission.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { loadUserAuthz, authorize } from '@/lib/authz/check';
import { writeAuditLog } from '@/lib/db/audit';

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { queueId, encounterId, icd11Code, description } = body;

    if (!queueId) {
      return NextResponse.json({ error: 'Missing queueId' }, { status: 400 });
    }

    await withTenantContext(session.tenantId, async (client) => {
      const authz = await loadUserAuthz(client, session);
      authorize(authz, 'him:manage');

      // Update coding queue item
      await client.query(
        `UPDATE coding_queue
         SET status = 'completed', assigned_to = $1, updated_at = now()
         WHERE tenant_id = $2 AND id = $3`,
        [session.userId, session.tenantId, queueId]
      );

      // If diagnosis provided, insert diagnosis
      if (encounterId && icd11Code) {
        // Fetch patient_id for encounter
        const enc = await client.query(
          `SELECT patient_id FROM encounters WHERE tenant_id = $1 AND id = $2`,
          [session.tenantId, encounterId]
        );
        if (enc.rows[0]) {
          await client.query(
            `INSERT INTO diagnoses (tenant_id, encounter_id, patient_id, icd11_code, description, diagnosis_type, diagnosed_by)
             VALUES ($1, $2, $3, $4, $5, 'primary', $6)`,
            [session.tenantId, encounterId, enc.rows[0].patient_id, icd11Code, description || 'ICD-11 Coded', session.userId]
          );
        }
      }

      await writeAuditLog(client, {
        tenantId: session.tenantId,
        actorId: session.userId,
        action: 'him.coding_completed',
        entityType: 'coding_queue',
        entityId: queueId,
        oldState: null,
        newState: { queueId, icd11Code, completedBy: session.userId },
      });
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err?.status === 403 || err?.message?.includes('Forbidden')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('Error completing coding queue:', err);
    return NextResponse.json(
      { error: err?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

import { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import { withTenantContext } from '@/lib/db/withTenant';
import { loadUserAuthz, authorize } from '@/lib/authz/check';
import CodingQueueClient from './CodingQueueClient';

export const metadata: Metadata = {
  title: 'ICD-11 Coding Queue | HMIS',
  description: 'Health records encounter chart coding and diagnosis assignment',
};

export default async function CodingQueuePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const queueItems = await withTenantContext(session.tenantId, async (client) => {
    const authz = await loadUserAuthz(client, session);
    authorize(authz, 'him:manage');

    const res = await client.query(
      `SELECT cq.id, cq.encounter_id, cq.status, cq.created_at,
              p.id as patient_id, p.first_name, p.last_name, p.mrn,
              e.encounter_type, e.created_at as encounter_date
       FROM coding_queue cq
       JOIN encounters e ON cq.encounter_id = e.id AND cq.tenant_id = e.tenant_id
       JOIN patients p ON e.patient_id = p.id AND e.tenant_id = p.tenant_id
       WHERE cq.tenant_id = $1
       ORDER BY cq.created_at ASC
       LIMIT 100`,
      [session.tenantId]
    );

    return res.rows;
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">ICD-11 Coding Queue</h1>
          <p className="mt-1 text-sm text-slate-500">
            Encounters pending diagnostic coding and WHO ICD-11 standardization
          </p>
        </div>
      </div>

      <CodingQueueClient initialQueue={queueItems} />
    </div>
  );
}

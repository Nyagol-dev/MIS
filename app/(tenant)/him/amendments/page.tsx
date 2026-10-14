import { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import { withTenantContext } from '@/lib/db/withTenant';
import { loadUserAuthz, authorize } from '@/lib/authz/check';
import AmendmentsClient from './AmendmentsClient';

export const metadata: Metadata = {
  title: 'Chart Amendment Requests | HMIS',
  description: 'Health records clinical note amendment and correction approval workflow',
};

export default async function AmendmentsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const requests = await withTenantContext(session.tenantId, async (client) => {
    const authz = await loadUserAuthz(client, session);
    authorize(authz, 'him:manage');

    const res = await client.query(
      `SELECT car.id, car.patient_id, car.encounter_id, car.reason, car.status, car.created_at,
              p.first_name, p.last_name, p.mrn,
              u.first_name as req_first_name, u.last_name as req_last_name
       FROM chart_amendment_requests car
       JOIN patients p ON car.patient_id = p.id AND car.tenant_id = p.tenant_id
       JOIN users u ON car.requested_by = u.id AND car.tenant_id = u.tenant_id
       WHERE car.tenant_id = $1
       ORDER BY car.created_at DESC
       LIMIT 100`,
      [session.tenantId]
    );

    return res.rows;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Chart Amendment Requests</h1>
        <p className="mt-1 text-sm text-slate-500">
          Review, approve, or reject formal corrections to locked patient clinical notes
        </p>
      </div>

      <AmendmentsClient initialRequests={requests} />
    </div>
  );
}

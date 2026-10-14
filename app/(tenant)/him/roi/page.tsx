import { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import { withTenantContext } from '@/lib/db/withTenant';
import { loadUserAuthz, authorize } from '@/lib/authz/check';
import RoiClient from './RoiClient';

export const metadata: Metadata = {
  title: 'Release of Information Log | HMIS',
  description: 'Health records disclosure tracking, court order subpoenas, and subject access requests',
};

export default async function RoiPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const { logs, patients } = await withTenantContext(session.tenantId, async (client) => {
    const authz = await loadUserAuthz(client, session);
    authorize(authz, 'him:manage');

    const roiRes = await client.query(
      `SELECT roi.id, roi.patient_id, roi.requested_by, roi.purpose, roi.released_at, roi.details,
              p.first_name, p.last_name, p.mrn,
              u.first_name as officer_first, u.last_name as officer_last
       FROM release_of_information_log roi
       JOIN patients p ON roi.patient_id = p.id AND roi.tenant_id = p.tenant_id
       JOIN users u ON roi.released_by = u.id AND roi.tenant_id = u.tenant_id
       WHERE roi.tenant_id = $1
       ORDER BY roi.released_at DESC
       LIMIT 100`,
      [session.tenantId]
    );

    const patRes = await client.query(
      `SELECT id, first_name, last_name, mrn
       FROM patients
       WHERE tenant_id = $1
       ORDER BY last_name ASC
       LIMIT 100`,
      [session.tenantId]
    );

    return {
      logs: roiRes.rows,
      patients: patRes.rows,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Release of Information Log</h1>
        <p className="mt-1 text-sm text-slate-500">
          Track statutory health record disclosures, DPA 2019 subject access requests, and external transfers
        </p>
      </div>

      <RoiClient initialLogs={logs} patients={patients} />
    </div>
  );
}

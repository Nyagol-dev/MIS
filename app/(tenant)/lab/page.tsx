import { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import { withTenantContext } from '@/lib/db/withTenant';
import { loadUserAuthz, authorize } from '@/lib/authz/check';
import { getPendingLabSamples } from '@/lib/lab/service';
import LabWorklistClient from './LabWorklistClient';

export const metadata: Metadata = {
  title: 'Laboratory (LIS) | HMIS',
  description: 'Lab sample worklist, result entry, and verification',
};

export default async function LabPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const pendingSamples = await withTenantContext(session.tenantId, async (client) => {
    const authz = await loadUserAuthz(client, session);
    authorize(authz, 'lab_result:create');
    return getPendingLabSamples(session.tenantId, client);
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Laboratory (LIS)</h1>
        <p className="mt-1 text-sm text-slate-500">
          Sample worklist, result entry, and verification
        </p>
      </div>

      <LabWorklistClient pendingSamples={pendingSamples} />
    </div>
  );
}

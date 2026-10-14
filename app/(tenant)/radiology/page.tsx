import { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import { withTenantContext } from '@/lib/db/withTenant';
import { loadUserAuthz, authorize } from '@/lib/authz/check';
import { getPendingImagingOrders } from '@/lib/radiology/service';
import RadiologyWorklistClient from './RadiologyWorklistClient';

export const metadata: Metadata = {
  title: 'Radiology | HMIS',
  description: 'Imaging orders, reporting, and PACS link-out',
};

export default async function RadiologyPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const orders = await withTenantContext(session.tenantId, async (client) => {
    const authz = await loadUserAuthz(client, session);
    authorize(authz, 'imaging_report:create');
    return getPendingImagingOrders(session.tenantId, client);
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Radiology</h1>
        <p className="mt-1 text-sm text-slate-500">
          Imaging orders worklist and report entry
        </p>
      </div>

      <RadiologyWorklistClient orders={orders} />
    </div>
  );
}

import { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import { withTenantContext } from '@/lib/db/withTenant';
import { loadUserAuthz, authorize } from '@/lib/authz/check';
import { getPendingPrescriptions } from '@/lib/pharmacy/service';
import PharmacyDispenseClient from './PharmacyDispenseClient';

export const metadata: Metadata = {
  title: 'Pharmacy & Dispensing | HMIS',
  description: 'Prescription dispensing queue and controlled drug register',
};

export default async function PharmacyPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const prescriptions = await withTenantContext(session.tenantId, async (client) => {
    const authz = await loadUserAuthz(client, session);
    authorize(authz, 'prescription:dispense');
    return getPendingPrescriptions(session.tenantId, client);
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Pharmacy & Dispensing</h1>
        <p className="mt-1 text-sm text-slate-500">
          Review prescriptions, dispense medication, and manage the controlled drug register.
        </p>
      </div>

      <PharmacyDispenseClient prescriptions={prescriptions} />
    </div>
  );
}

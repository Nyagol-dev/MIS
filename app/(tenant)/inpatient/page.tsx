import { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { getAdmissions, getWardsAndBeds } from '@/lib/inpatient/service';
import { redirect } from 'next/navigation';
import InpatientClient from './InpatientClient';

export const metadata: Metadata = {
  title: 'Inpatient Ward | HMIS',
  description: 'Inpatient Ward Management — bed assignments, nursing notes, MAR',
};

export default async function InpatientPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const [admissions, wardsAndBeds] = await Promise.all([
    getAdmissions(session.tenantId),
    getWardsAndBeds(session.tenantId),
  ]);

  const availableBeds = wardsAndBeds.filter((b) => b.status === 'available');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Inpatient Ward Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Admissions, bed assignments, nursing notes, and medication administration
        </p>
      </div>

      <InpatientClient admissions={admissions} availableBeds={availableBeds} />
    </div>
  );
}

import { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { getAdmissions, getWardsAndBeds } from '@/lib/inpatient/service';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Inpatient Ward | HMIS',
  description: 'Inpatient Ward Management',
};

export default async function InpatientPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const admissions = await getAdmissions(session.tenantId);
  const wardsAndBeds = await getWardsAndBeds(session.tenantId);

  const availableBeds = wardsAndBeds.filter(b => b.status === 'available').length;
  const occupiedBeds = wardsAndBeds.filter(b => b.status === 'occupied').length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Inpatient Ward Dashboard</h1>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-4 shadow rounded-lg border border-slate-200">
          <h2 className="text-lg font-medium text-slate-700">Active Admissions</h2>
          <p className="text-3xl font-bold mt-2 text-slate-900">{admissions.length}</p>
        </div>
        <div className="bg-white p-4 shadow rounded-lg border border-slate-200">
          <h2 className="text-lg font-medium text-slate-700">Available Beds</h2>
          <p className="text-3xl font-bold mt-2 text-green-600">{availableBeds}</p>
        </div>
        <div className="bg-white p-4 shadow rounded-lg border border-slate-200">
          <h2 className="text-lg font-medium text-slate-700">Occupied Beds</h2>
          <p className="text-3xl font-bold mt-2 text-red-600">{occupiedBeds}</p>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex justify-between items-center">
          <h3 className="font-medium text-slate-900">Current Admissions</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Patient</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Admitted At</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Ward/Bed</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {admissions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-4 text-center text-sm text-slate-500">
                    No active admissions found.
                  </td>
                </tr>
              ) : (
                admissions.map((adm) => (
                  <tr key={adm.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">
                      {adm.first_name} {adm.last_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                      {new Date(adm.admitted_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                      {adm.ward_name ? \`\${adm.ward_name} / Bed \${adm.bed_number}\` : 'Unassigned'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                      <button className="text-indigo-600 hover:text-indigo-900">Assign Bed</button>
                      <button className="text-indigo-600 hover:text-indigo-900">Notes & MAR</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

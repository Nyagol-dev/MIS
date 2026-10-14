import { Metadata } from 'next';
import Link from 'next/link';
import { getSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import { withTenantContext } from '@/lib/db/withTenant';
import { loadUserAuthz, authorize } from '@/lib/authz/check';
import { writeAuditLog } from '@/lib/db/audit';

export const metadata: Metadata = {
  title: 'Patients | HMIS',
  description: 'Master Patient Index — search and register patients',
};

interface Patient {
  id: string;
  first_name: string;
  last_name: string;
  dob: string;
  gender: string;
  phone: string | null;
  sha_number: string | null;
  created_at: string;
}

async function getPatients(tenantId: string, search: string): Promise<Patient[]> {
  const { withTenantContext } = await import('@/lib/db/withTenant');
  return withTenantContext(tenantId, async (client) => {
    const searchParam = search ? `%${search}%` : null;
    const result = await client.query(
      `SELECT p.id, p.first_name, p.last_name, p.dob, p.gender, p.sha_number, p.created_at,
              c.phone
       FROM patients p
       LEFT JOIN patient_contacts c ON p.id = c.patient_id AND p.tenant_id = c.tenant_id
       WHERE p.tenant_id = $1
         AND p.deleted_at IS NULL
         AND ($2::text IS NULL
              OR p.first_name ILIKE $2
              OR p.last_name ILIKE $2
              OR CONCAT(p.first_name, ' ', p.last_name) ILIKE $2
              OR c.phone ILIKE $2
              OR p.sha_number ILIKE $2)
       ORDER BY p.last_name, p.first_name
       LIMIT 200`,
      [tenantId, searchParam]
    );
    return result.rows;
  });
}

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { q = '' } = await searchParams;

  // Authorization check + audit the list read
  await withTenantContext(session.tenantId, async (client) => {
    const authz = await loadUserAuthz(client, session);
    authorize(authz, 'patient:read');

    await writeAuditLog(client, {
      tenantId: session.tenantId,
      actorId: session.userId,
      action: 'patient.list',
      entityType: 'patient',
      entityId: null,
      oldState: null,
      newState: q ? { search: q } : null,
    });
  });

  const patients = await getPatients(session.tenantId, q);

  function ageFromDob(dob: string): string {
    const birth = new Date(dob);
    const now = new Date();
    const years = now.getFullYear() - birth.getFullYear();
    const months = now.getMonth() - birth.getMonth();
    if (years < 1) return `${Math.max(0, months)}m`;
    return `${years}y`;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Patient Registry</h1>
          <p className="mt-1 text-sm text-slate-500">
            Master Patient Index — {patients.length} patient{patients.length !== 1 ? 's' : ''} found
          </p>
        </div>
        <Link
          href="/patients/register"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Register Patient
        </Link>
      </div>

      {/* Search bar */}
      <form method="get" className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
          <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
          </svg>
        </div>
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by name, phone, or SHA number…"
          className="w-full pl-9 pr-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400
                     focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
        />
      </form>

      {/* Table */}
      <div className="bg-white shadow-sm rounded-lg border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Age / Sex</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">DOB</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Phone</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">SHA No.</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Registered</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {patients.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">
                    {q
                      ? `No patients found matching "${q}". Try a different name or phone number.`
                      : 'No patients registered yet. Use the "Register Patient" button to add the first patient.'}
                  </td>
                </tr>
              ) : (
                patients.map((patient) => (
                  <tr key={patient.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">
                      <Link href={`/patients/${patient.id}`} className="hover:text-blue-600">
                        {patient.last_name}, {patient.first_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {ageFromDob(patient.dob)} / {patient.gender === 'male' ? 'M' : patient.gender === 'female' ? 'F' : 'O'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {new Date(patient.dob).toLocaleDateString('en-KE')}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {patient.phone ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {patient.sha_number ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      {new Date(patient.created_at).toLocaleDateString('en-KE')}
                    </td>
                    <td className="px-4 py-3 text-right text-sm">
                      <Link
                        href={`/patients/${patient.id}`}
                        className="text-blue-600 hover:text-blue-800 font-medium"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {patients.length === 200 && (
          <div className="px-4 py-3 bg-amber-50 border-t border-amber-100 text-xs text-amber-700">
            Showing first 200 results. Refine your search to find a specific patient.
          </div>
        )}
      </div>
    </div>
  );
}

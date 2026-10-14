import { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import { withTenantContext } from '@/lib/db/withTenant';
import { loadUserAuthz, authorize } from '@/lib/authz/check';

export const metadata: Metadata = {
  title: 'HIM Workspace | HMIS',
  description: 'Health Information Management Workspace',
};

export default async function HIMWorkspacePage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  await withTenantContext(session.tenantId, async (client) => {
    const authz = await loadUserAuthz(client, session);
    authorize(authz, 'him:manage');
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Health Records (HIM) Workspace</h1>
        <p className="mt-2 text-sm text-gray-700">
          Manage chart completeness, coding queue, and release of information.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 shadow sm:rounded-lg">
          <h3 className="text-lg font-medium">Coding Queue</h3>
          <p className="text-sm text-gray-500 mt-1">Encounters pending ICD-11 coding.</p>
          <a href="/him/coding" className="mt-4 text-blue-600 hover:underline block">View Queue →</a>
        </div>
        <div className="bg-white p-6 shadow sm:rounded-lg">
          <h3 className="text-lg font-medium">Amendment Requests</h3>
          <p className="text-sm text-gray-500 mt-1">Review clinical note corrections.</p>
          <a href="/him/amendments" className="mt-4 text-blue-600 hover:underline block">View Requests →</a>
        </div>
        <div className="bg-white p-6 shadow sm:rounded-lg">
          <h3 className="text-lg font-medium">Release of Information</h3>
          <p className="text-sm text-gray-500 mt-1">Log external requests for records.</p>
          <a href="/him/roi" className="mt-4 text-blue-600 hover:underline block">View Log →</a>
        </div>
      </div>
    </div>
  );
}

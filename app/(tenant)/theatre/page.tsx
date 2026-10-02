import { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { getTheatreCases } from '@/lib/theatre/service';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Theatre Schedules | HMIS',
  description: 'Theatre & Procedures Management',
};

export default async function TheatrePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const cases = await getTheatreCases(session.tenantId);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Theatre Schedules</h1>
        <button className="bg-slate-900 text-white px-4 py-2 rounded-md font-medium text-sm hover:bg-slate-800">
          Schedule Case
        </button>
      </div>
      
      <div className="bg-white shadow rounded-lg border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <h3 className="font-medium text-slate-900">Upcoming Procedures</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Time</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Patient</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Procedure</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {cases.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-center text-sm text-slate-500">
                    No theatre cases scheduled.
                  </td>
                </tr>
              ) : (
                cases.map((c) => (
                  <tr key={c.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                      {new Date(c.scheduled_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">
                      {c.first_name} {c.last_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                      {c.procedure_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize
                        ${c.status === 'scheduled' ? 'bg-blue-100 text-blue-800' : ''}
                        ${c.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' : ''}
                        ${c.status === 'completed' ? 'bg-green-100 text-green-800' : ''}
                        ${c.status === 'cancelled' ? 'bg-red-100 text-red-800' : ''}
                      `}>
                        {c.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                      <button className="text-indigo-600 hover:text-indigo-900">Update Status</button>
                      <button className="text-indigo-600 hover:text-indigo-900">Safety Checklist</button>
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

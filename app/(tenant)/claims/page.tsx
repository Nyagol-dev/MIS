import React from 'react';
import { getSession } from '@/lib/auth/session';
import { getEffectivePermissions, can } from '@/lib/auth/permissions';
import { getClaims } from '@/lib/claims/service';

export default async function ClaimsDashboard() {
  const session = await getSession();
  if (!session) return <div>Unauthorized</div>;

  const perms = await getEffectivePermissions(session.tenantId, session.userId);
  if (!can(perms, 'claim:read')) return <div>Forbidden</div>;

  const claims = await getClaims(session.tenantId);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Insurance Claims</h1>
        <button className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700">
          New Claim
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="p-4 font-semibold text-gray-700">Claim #</th>
              <th className="p-4 font-semibold text-gray-700">Payer</th>
              <th className="p-4 font-semibold text-gray-700">Patient</th>
              <th className="p-4 font-semibold text-gray-700">Date</th>
              <th className="p-4 font-semibold text-gray-700">Total (KES)</th>
              <th className="p-4 font-semibold text-gray-700">Status</th>
            </tr>
          </thead>
          <tbody>
            {claims.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-4 text-center text-gray-500">No claims found</td>
              </tr>
            ) : (
              claims.map((claim: any) => (
                <tr key={claim.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="p-4 font-medium">{claim.claim_number}</td>
                  <td className="p-4">{claim.payer_name}</td>
                  <td className="p-4">{claim.first_name} {claim.last_name}</td>
                  <td className="p-4">{new Date(claim.submitted_at).toLocaleDateString()}</td>
                  <td className="p-4">{(claim.total_minor_units / 100).toFixed(2)}</td>
                  <td className="p-4">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full \${
                      claim.status === 'paid' ? 'bg-green-100 text-green-800' :
                      claim.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                      claim.status === 'rejected' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {claim.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

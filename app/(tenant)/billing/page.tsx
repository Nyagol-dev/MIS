import React from 'react';
import { getSession } from '@/lib/auth/session';
import { getEffectivePermissions, can } from '@/lib/auth/permissions';
import { getInvoices } from '@/lib/billing/service';

export default async function BillingDashboard() {
  const session = await getSession();
  if (!session) return <div>Unauthorized</div>;

  const perms = await getEffectivePermissions(session.tenantId, session.userId);
  if (!can(perms, 'invoice:read')) return <div>Forbidden</div>;

  const invoices = await getInvoices(session.tenantId);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Billing Dashboard</h1>
        <button className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700">
          Create Invoice
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="p-4 font-semibold text-gray-700">Invoice #</th>
              <th className="p-4 font-semibold text-gray-700">Patient</th>
              <th className="p-4 font-semibold text-gray-700">Date</th>
              <th className="p-4 font-semibold text-gray-700">Total (KES)</th>
              <th className="p-4 font-semibold text-gray-700">Status</th>
              <th className="p-4 font-semibold text-gray-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-4 text-center text-gray-500">No invoices found</td>
              </tr>
            ) : (
              invoices.map((inv: any) => (
                <tr key={inv.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="p-4 font-medium">{inv.invoice_number}</td>
                  <td className="p-4">{inv.first_name} {inv.last_name}</td>
                  <td className="p-4">{new Date(inv.created_at).toLocaleDateString()}</td>
                  <td className="p-4">{(inv.total_minor_units / 100).toFixed(2)}</td>
                  <td className="p-4">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full \${
                      inv.status === 'paid' ? 'bg-green-100 text-green-800' :
                      inv.status === 'open' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="p-4">
                    <button className="text-blue-600 hover:underline mr-3">View</button>
                    {inv.status !== 'paid' && <button className="text-green-600 hover:underline">Pay</button>}
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

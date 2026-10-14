import { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import { withTenantContext } from '@/lib/db/withTenant';
import { loadUserAuthz, authorize } from '@/lib/authz/check';
import { getInvoices } from '@/lib/billing/service';
import BillingClient from './BillingClient';

export const metadata: Metadata = {
  title: 'Billing & Revenue Cycle | HMIS',
  description: 'Invoices, payments, M-Pesa settlements, waivers, and patient statements',
};

export default async function BillingDashboard() {
  const session = await getSession();
  if (!session) redirect('/login');

  const { invoices, patients } = await withTenantContext(session.tenantId, async (client) => {
    const authz = await loadUserAuthz(client, session);
    authorize(authz, 'invoice:read');

    const invs = await getInvoices(session.tenantId, client);
    const patRes = await client.query(
      `SELECT id, first_name, last_name, mrn
       FROM patients
       WHERE tenant_id = $1
       ORDER BY last_name ASC
       LIMIT 100`,
      [session.tenantId]
    );

    return {
      invoices: invs,
      patients: patRes.rows,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Billing & Revenue Cycle</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage patient billing, M-Pesa settlements, waivers, and cashier reconciliation
        </p>
      </div>

      <BillingClient invoices={invoices} patients={patients} />
    </div>
  );
}

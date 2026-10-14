import { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import { withTenantContext } from '@/lib/db/withTenant';
import { loadUserAuthz, authorize } from '@/lib/authz/check';
import { getClaims } from '@/lib/claims/service';
import ClaimsClient from './ClaimsClient';

export const metadata: Metadata = {
  title: 'Insurance & Claims | HMIS',
  description: 'SHA and private insurance claim assembly, eligibility checks, and FHIR bundles',
};

export default async function ClaimsDashboard() {
  const session = await getSession();
  if (!session) redirect('/login');

  const { claims, patients } = await withTenantContext(session.tenantId, async (client) => {
    const authz = await loadUserAuthz(client, session);
    authorize(authz, 'claim:read');

    const clms = await getClaims(session.tenantId, client);
    const patRes = await client.query(
      `SELECT id, first_name, last_name, mrn
       FROM patients
       WHERE tenant_id = $1
       ORDER BY last_name ASC
       LIMIT 100`,
      [session.tenantId]
    );

    return {
      claims: clms,
      patients: patRes.rows,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Insurance & SHA Claims</h1>
        <p className="mt-1 text-sm text-slate-500">
          AfyaLink HIE claim assembly, ICD-11 coding validation, eligibility checks, and status tracking
        </p>
      </div>

      <ClaimsClient claims={claims} patients={patients} />
    </div>
  );
}

import { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import { withTenantContext } from '@/lib/db/withTenant';
import { loadUserAuthz, authorize } from '@/lib/authz/check';
import { getTheatreCases } from '@/lib/theatre/service';
import TheatreClient from './TheatreClient';

export const metadata: Metadata = {
  title: 'Theatre Schedules | HMIS',
  description: 'Operating theatre cases, WHO surgical checklists, and procedure logs',
};

export default async function TheatrePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const { cases, patients } = await withTenantContext(session.tenantId, async (client) => {
    const authz = await loadUserAuthz(client, session);
    authorize(authz, 'theatre_case:read');

    const tcCases = await getTheatreCases(session.tenantId, client);
    const patRes = await client.query(
      `SELECT id, first_name, last_name, mrn
       FROM patients
       WHERE tenant_id = $1
       ORDER BY last_name ASC
       LIMIT 100`,
      [session.tenantId]
    );

    return {
      cases: tcCases,
      patients: patRes.rows,
    };
  });

  return <TheatreClient initialCases={cases} patients={patients} />;
}

import React from 'react';
import { redirect } from 'next/navigation';
import { verifyAnySession, COOKIE_NAME } from '@/lib/auth/session';
import { cookies } from 'next/headers';
import { getEffectivePermissions, canOnEntityType } from '@/lib/auth/permissions';
import { listEntityTypes } from '@/lib/entities/types';
import { withTenantContext } from '@/lib/db/withTenant';
import { EntityTypeList } from '@/components/entities/EntityTypeList';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata = {
  title: 'Reference data',
};

export default async function EntitiesPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifyAnySession(token) : null;
  if (!session || session.sessionKind !== 'tenant') {
    redirect('/login');
  }

  // Load all entity types for the tenant
  const result = await withTenantContext(session.tenantId, async (client) => {
    return listEntityTypes(client, session.tenantId, { limit: 200 });
  });

  // Filter based on read permissions
  const perms = await getEffectivePermissions(session.tenantId, session.userId);
  const allowedEntityTypes = result.items.filter((et) => 
    canOnEntityType(perms, et.id, 'read')
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader eyebrow="Hospital configuration" title="Reference records" description="Browse and manage non-clinical reference lists configured for this hospital." />
      <EntityTypeList entityTypes={allowedEntityTypes} basePath="/entities" />
    </div>
  );
}

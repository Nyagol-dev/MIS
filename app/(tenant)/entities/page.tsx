import React from 'react';
import { redirect } from 'next/navigation';
import { verifyAnySession, COOKIE_NAME } from '@/lib/auth/session';
import { cookies } from 'next/headers';
import { getEffectivePermissions, canOnEntityType } from '@/lib/auth/permissions';
import { listEntityTypes } from '@/lib/entities/types';
import { withTenantContext } from '@/lib/db/withTenant';
import { EntityTypeList } from '@/components/entities/EntityTypeList';

export const metadata = {
  title: 'Entity Types',
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
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Entities
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Manage your organizational data records. Select an entity type to view or edit its records.
        </p>
      </div>

      <EntityTypeList entityTypes={allowedEntityTypes} basePath="/entities" />
    </div>
  );
}

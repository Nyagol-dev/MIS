import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { verifyAnySession } from '@/lib/auth/session';
import { getEffectivePermissions, canOnEntityType } from '@/lib/auth/permissions';
import { getEntityTypeBySlug, listFieldDefinitions } from '@/lib/entities/types';
import { listEntityRecords } from '@/lib/entities/records';
import { withTenantContext } from '@/lib/db/withTenant';
import { EntityRecordTable } from '@/components/entities/EntityRecordTable';

export const metadata = {
  title: 'Entity Records',
};

interface PageProps {
  params: Promise<{
    entityTypeSlug: string;
  }>;
}

export default async function EntityRecordsPage({ params }: PageProps) {
  const session = await verifyAnySession();
  if (!session || session.session_type !== 'tenant') {
    redirect('/login');
  }

  const { entityTypeSlug } = await params;

  // Resolve slug to entity type
  const entityType = await withTenantContext(session.tenantId, async (client) => {
    return getEntityTypeBySlug(client, session.tenantId, entityTypeSlug);
  });

  if (!entityType || 'error' in entityType) {
    notFound();
  }

  // Check read permission
  const perms = await getEffectivePermissions(session.tenantId, session.userId);
  if (!canOnEntityType(perms, entityType.id, 'read')) {
    redirect('/dashboard');
  }

  // Compute UI booleans
  const canCreate = canOnEntityType(perms, entityType.id, 'create');
  const canUpdate = canOnEntityType(perms, entityType.id, 'update');
  const canDelete = canOnEntityType(perms, entityType.id, 'delete');

  // Load field definitions and records
  const fieldDefsPromise = withTenantContext(session.tenantId, async (client) => {
    return listFieldDefinitions(client, session.tenantId, entityTypeSlug, {
      version: entityType.current_version,
    });
  });

  const recordsPromise = listEntityRecords(session, entityType.id, { limit: 100 });

  const [fieldDefs, records] = await Promise.all([fieldDefsPromise, recordsPromise]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          {entityType.name}
        </h1>
        {entityType.description && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {entityType.description}
          </p>
        )}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6">
        <EntityRecordTable
          records={records}
          fieldDefinitions={fieldDefs}
          permissions={{ canCreate, canUpdate, canDelete }}
          entityTypeId={entityType.id}
          entityTypeSlug={entityType.slug}
          entityTypeName={entityType.name}
        />
      </div>
    </div>
  );
}

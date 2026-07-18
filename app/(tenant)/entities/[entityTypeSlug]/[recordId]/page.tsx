import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { verifyAnySession } from '@/lib/auth/session';
import { getEffectivePermissions, canOnEntityType } from '@/lib/auth/permissions';
import { getEntityTypeBySlug, listFieldDefinitions } from '@/lib/entities/types';
import { getEntityRecord } from '@/lib/entities/records';
import { withTenantContext } from '@/lib/db/withTenant';
import { EditRecordFormWrapper } from './EditRecordFormWrapper';
import Link from 'next/link';

export const metadata = {
  title: 'Edit Record',
};

interface PageProps {
  params: Promise<{
    entityTypeSlug: string;
    recordId: string;
  }>;
}

export default async function EditRecordPage({ params }: PageProps) {
  const session = await verifyAnySession();
  if (!session || session.session_type !== 'tenant') {
    redirect('/login');
  }

  const { entityTypeSlug, recordId } = await params;

  // Resolve slug to entity type
  const entityType = await withTenantContext(session.tenantId, async (client) => {
    return getEntityTypeBySlug(client, session.tenantId, entityTypeSlug);
  });

  if (!entityType || 'error' in entityType) {
    notFound();
  }

  // Check update permission
  const perms = await getEffectivePermissions(session.tenantId, session.userId);
  if (!canOnEntityType(perms, entityType.id, 'update')) {
    redirect(`/entities/${entityTypeSlug}`);
  }

  // Load the record
  const record = await getEntityRecord(session, entityType.id, recordId);
  if (!record) {
    notFound();
  }

  // Load field definitions AT THE RECORD'S PINNED SCHEMA VERSION
  const fieldDefs = await withTenantContext(session.tenantId, async (client) => {
    return listFieldDefinitions(client, session.tenantId, entityTypeSlug, {
      version: record.schema_version,
    });
  });

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href={`/entities/${entityTypeSlug}`}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
        >
          &larr; Back to {entityType.name}
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Edit {entityType.name} Record
        </h1>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6">
        <EditRecordFormWrapper
          fieldDefinitions={fieldDefs}
          existingRecord={record}
          entityTypeId={entityType.id}
          entityTypeSlug={entityType.slug}
        />
      </div>
    </div>
  );
}

'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { EntityRecordForm } from '@/components/entities/EntityRecordForm';
import type { FieldDefinition } from '@/components/entities/fields/TextField';
import type { EntityRecord } from '@/components/entities/EntityRecordTable';

interface WrapperProps {
  fieldDefinitions: FieldDefinition[];
  existingRecord: EntityRecord;
  entityTypeId: string;
  entityTypeSlug: string;
}

export function EditRecordFormWrapper({
  fieldDefinitions,
  existingRecord,
  entityTypeId,
  entityTypeSlug,
}: WrapperProps) {
  const router = useRouter();

  const handleDone = () => {
    router.push(`/entities/${entityTypeSlug}`);
    router.refresh();
  };

  return (
    <EntityRecordForm
      fieldDefinitions={fieldDefinitions}
      existingRecord={existingRecord}
      entityTypeId={entityTypeId}
      entityTypeSlug={entityTypeSlug}
      onSuccess={handleDone}
      onCancel={handleDone}
    />
  );
}

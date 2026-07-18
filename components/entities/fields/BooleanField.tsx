'use client';

import React from 'react';
import { Checkbox } from '@/components/ui/Checkbox';
import type { FieldDefinition } from './TextField';

export interface BooleanFieldProps {
  fieldDefinition: FieldDefinition;
  value: boolean;
  onChange: (value: boolean) => void;
  error?: string;
  disabled?: boolean;
}

/**
 * BooleanField — P0 field component for `boolean` field_type.
 *
 * Renders a styled checkbox. When `is_required` is true, the checkbox must
 * be checked to pass browser-level form validation.
 */
export const BooleanField: React.FC<BooleanFieldProps> = ({
  fieldDefinition,
  value,
  onChange,
  error,
  disabled = false,
}) => {
  const { display_name, is_required } = fieldDefinition;

  return (
    <div className="flex flex-col gap-1">
      <Checkbox
        id={`field-${fieldDefinition.field_key}`}
        label={`${display_name}${is_required ? ' *' : ''}`}
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        // When required, the checkbox must be checked (native boolean validation)
        required={is_required}
        disabled={disabled}
        error={error}
      />
    </div>
  );
};

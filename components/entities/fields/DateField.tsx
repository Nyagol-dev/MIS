'use client';

import React from 'react';
import { Input } from '@/components/ui/Input';
import type { FieldDefinition } from './TextField';

export interface DateFieldProps {
  fieldDefinition: FieldDefinition;
  /** ISO date string `YYYY-MM-DD` or empty string. */
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}

/**
 * DateField — P0 field component for `date` field_type.
 *
 * Renders `<input type="date">` which browsers present as a native date picker
 * and enforce YYYY-MM-DD format. The stored/submitted value is always the
 * ISO 8601 date string the browser produces (YYYY-MM-DD), which the server
 * `checkFieldType` accepts for `date` fields.
 */
export const DateField: React.FC<DateFieldProps> = ({
  fieldDefinition,
  value,
  onChange,
  error,
  disabled = false,
}) => {
  const { display_name, is_required } = fieldDefinition;

  return (
    <Input
      id={`field-${fieldDefinition.field_key}`}
      label={`${display_name}${is_required ? ' *' : ''}`}
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error}
      required={is_required}
      disabled={disabled}
    />
  );
};

'use client';

import React from 'react';
import { Select } from '@/components/ui/Select';
import type { FieldDefinition } from './TextField';

export interface EnumFieldProps {
  fieldDefinition: FieldDefinition;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}

/**
 * EnumField — P0 field component for `enum` field_type.
 *
 * Renders a <select> whose options are derived exclusively from
 * `constraints.enum_values`. If enum_values is empty or undefined a warning
 * option is shown (field misconfigured at schema level).
 *
 * An empty "— Select —" sentinel option is prepended so the form state
 * initialises to '' (empty string) before the user makes a choice, making
 * required-field validation detectable.
 */
export const EnumField: React.FC<EnumFieldProps> = ({
  fieldDefinition,
  value,
  onChange,
  error,
  disabled = false,
}) => {
  const { display_name, is_required, constraints } = fieldDefinition;
  const enumValues = constraints.enum_values ?? [];

  const options = [
    { value: '', label: `— Select ${display_name} —` },
    ...enumValues.map((v) => ({ value: v, label: v })),
  ];

  return (
    <Select
      id={`field-${fieldDefinition.field_key}`}
      label={`${display_name}${is_required ? ' *' : ''}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={options}
      error={
        error ??
        (enumValues.length === 0
          ? 'Schema misconfiguration: this enum field has no defined values.'
          : undefined)
      }
      required={is_required}
      disabled={disabled || enumValues.length === 0}
    />
  );
};

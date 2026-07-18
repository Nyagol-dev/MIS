'use client';

import React from 'react';
import { Input } from '@/components/ui/Input';

export interface FieldConstraints {
  min?: number;
  max?: number;
  pattern?: string;
  enum_values?: string[];
  ref_entity_type?: string;
}

export interface FieldDefinition {
  id: string;
  field_key: string;
  display_name: string;
  field_type: string;
  is_required: boolean;
  default_value: unknown;
  constraints: FieldConstraints;
  sort_order: number;
  retired_at: Date | string | null;
}

export interface TextFieldProps {
  fieldDefinition: FieldDefinition;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}

/**
 * TextField — P0 field component for `text` field_type.
 *
 * Applies constraints as native HTML validation attributes:
 *   - constraints.min → minLength
 *   - constraints.max → maxLength
 *   - constraints.pattern → pattern
 *   - is_required → required
 *
 * The server re-validates all submitted data. This is UX-only validation.
 */
export const TextField: React.FC<TextFieldProps> = ({
  fieldDefinition,
  value,
  onChange,
  error,
  disabled = false,
}) => {
  const { display_name, is_required, constraints } = fieldDefinition;

  return (
    <Input
      id={`field-${fieldDefinition.field_key}`}
      label={`${display_name}${is_required ? ' *' : ''}`}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error}
      required={is_required}
      minLength={constraints.min !== undefined ? constraints.min : undefined}
      maxLength={constraints.max !== undefined ? constraints.max : undefined}
      pattern={constraints.pattern ?? undefined}
      disabled={disabled}
      placeholder={`Enter ${display_name.toLowerCase()}…`}
    />
  );
};

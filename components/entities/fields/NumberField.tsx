'use client';

import React from 'react';
import { Input } from '@/components/ui/Input';
import type { FieldDefinition } from './TextField';

export interface NumberFieldProps {
  fieldDefinition: FieldDefinition;
  /** `integer` or `decimal` field_type — `step="1"` for integer, `step="any"` for decimal. */
  value: number | '';
  onChange: (value: number | '') => void;
  error?: string;
  disabled?: boolean;
}

/**
 * NumberField — P0 field component for `integer` and `decimal` field types.
 *
 * Distinguished via field_definition.field_type:
 *   - `integer`  → step="1" (browser blocks non-integer input)
 *   - `decimal`  → step="any" (allows decimal input)
 *
 * Native HTML validation attributes applied:
 *   - constraints.min → min
 *   - constraints.max → max
 *   - is_required → required
 *
 * The server re-validates all submitted data. This is UX-only validation.
 */
export const NumberField: React.FC<NumberFieldProps> = ({
  fieldDefinition,
  value,
  onChange,
  error,
  disabled = false,
}) => {
  const { display_name, field_type, is_required, constraints } = fieldDefinition;

  const step = field_type === 'integer' ? 1 : 'any';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === '' || raw === '-') {
      onChange('');
      return;
    }
    const parsed = field_type === 'integer' ? parseInt(raw, 10) : parseFloat(raw);
    onChange(isNaN(parsed) ? '' : parsed);
  };

  return (
    <Input
      id={`field-${fieldDefinition.field_key}`}
      label={`${display_name}${is_required ? ' *' : ''}`}
      type="number"
      value={value === '' ? '' : String(value)}
      onChange={handleChange}
      error={error}
      required={is_required}
      min={constraints.min !== undefined ? constraints.min : undefined}
      max={constraints.max !== undefined ? constraints.max : undefined}
      step={step}
      disabled={disabled}
      placeholder={`Enter ${field_type === 'integer' ? 'whole number' : 'number'}…`}
    />
  );
};

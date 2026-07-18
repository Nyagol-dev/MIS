'use client';

import React from 'react';
import { Input } from '@/components/ui/Input';
import type { FieldDefinition } from './TextField';

export interface DateTimeFieldProps {
  fieldDefinition: FieldDefinition;
  /** ISO 8601 datetime string compatible with `<input type="datetime-local">` (YYYY-MM-DDTHH:mm) or empty string. */
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}

/**
 * DateTimeField — P0 field component for `datetime` field_type.
 *
 * Renders `<input type="datetime-local">` which the browser presents as a
 * combined date-and-time picker. The browser's value format is
 * `YYYY-MM-DDTHH:mm` (no timezone). Before submission, EntityRecordForm
 * converts this to a full ISO 8601 string by appending `:00.000Z`, which
 * satisfies the server's `Date.parse()` check.
 *
 * Note: `datetime-local` does not carry timezone info. All datetimes are
 * interpreted as UTC by the server. This is a known limitation; timezone
 * support is deferred (see Scope Boundary section of the Round 9 blueprint).
 */
export const DateTimeField: React.FC<DateTimeFieldProps> = ({
  fieldDefinition,
  value,
  onChange,
  error,
  disabled = false,
}) => {
  const { display_name, is_required } = fieldDefinition;

  return (
    <div className="w-full flex flex-col gap-1.5">
      <Input
        id={`field-${fieldDefinition.field_key}`}
        label={`${display_name}${is_required ? ' *' : ''}`}
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        error={error}
        required={is_required}
        disabled={disabled}
      />
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Date and time in local timezone (stored as UTC)
      </p>
    </div>
  );
};

'use client';

import React, { useState, useCallback } from 'react';
import type { FieldDefinition } from './TextField';

export interface JsonFieldProps {
  fieldDefinition: FieldDefinition;
  /** Stringified JSON or empty string. */
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}

/**
 * JsonField — P1 field component for `json` field_type.
 *
 * Renders a <textarea> that accepts raw JSON text. Performs client-side
 * JSON parse validation on blur to surface syntax errors before submission.
 * A parse error is shown as a local error (not an `error` prop error so it
 * doesn't conflict with server-returned validation errors).
 *
 * The submitted value in form state is the raw string; EntityRecordForm
 * is responsible for parsing it to a JS value before including it in the
 * POST/PUT payload (since the server expects a JSON-serializable value, not
 * a string, for `json` fields).
 */
export const JsonField: React.FC<JsonFieldProps> = ({
  fieldDefinition,
  value,
  onChange,
  error,
  disabled = false,
}) => {
  const { display_name, is_required } = fieldDefinition;
  const [parseError, setParseError] = useState<string | null>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
      // Clear parse error as the user types
      if (parseError) setParseError(null);
    },
    [onChange, parseError]
  );

  const handleBlur = useCallback(() => {
    if (value.trim() === '') {
      setParseError(null);
      return;
    }
    try {
      JSON.parse(value);
      setParseError(null);
    } catch {
      setParseError('Invalid JSON syntax. Please check your input.');
    }
  }, [value]);

  const displayError = error ?? parseError ?? undefined;

  const inputId = `field-${fieldDefinition.field_key}`;
  const errorId = `${inputId}-error`;

  const borderClass = displayError
    ? 'border-red-300 focus:border-red-500 focus:ring-red-500 dark:border-red-800'
    : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 dark:border-slate-700';

  return (
    <div className="w-full flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-sm font-medium text-slate-700 dark:text-slate-300"
      >
        {display_name}
        {is_required && ' *'}
      </label>
      <textarea
        id={inputId}
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        rows={6}
        disabled={disabled}
        required={is_required}
        aria-invalid={!!displayError}
        aria-describedby={displayError ? errorId : undefined}
        placeholder={'{\n  "key": "value"\n}'}
        className={`
          block w-full rounded-lg border px-3 py-2 text-sm font-mono shadow-sm
          transition-colors duration-200
          focus:outline-none focus:ring-2 focus:ring-offset-0
          disabled:cursor-not-allowed disabled:opacity-50
          dark:bg-slate-900 dark:text-slate-100
          resize-y
          ${borderClass}
        `}
        spellCheck={false}
      />
      {displayError && (
        <p id={errorId} className="text-xs text-red-600 dark:text-red-400">
          {displayError}
        </p>
      )}
      {!displayError && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Enter a valid JSON value (object, array, string, number, boolean, or null)
        </p>
      )}
    </div>
  );
};

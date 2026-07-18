'use client';

import React, { useState, useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from './fields/TextField';
import { NumberField } from './fields/NumberField';
import { BooleanField } from './fields/BooleanField';
import { EnumField } from './fields/EnumField';
import { DateField } from './fields/DateField';
import { DateTimeField } from './fields/DateTimeField';
import { JsonField } from './fields/JsonField';
import { ReferenceField } from './fields/ReferenceField';
import { FileField } from './fields/FileField';
import type { FieldDefinition } from './fields/TextField';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface EntityRecord {
  id: string;
  schema_version: number;
  data: Record<string, unknown>;
}

export interface EntityRecordFormProps {
  fieldDefinitions: FieldDefinition[];
  /** When provided, the form is in edit mode; fields pre-fill from existingRecord.data. */
  existingRecord?: EntityRecord;
  entityTypeId: string;
  entityTypeSlug: string;
  /** Called after a successful create/update; if omitted the component calls router.refresh(). */
  onSuccess?: (record: EntityRecord) => void;
  /** Called when the user cancels. */
  onCancel?: () => void;
}

// ─── Form state helpers ───────────────────────────────────────────────────────

/** Canonical form value type — all values are strings internally; parsing happens at submit time. */
type FormValues = Record<string, string | number | boolean | ''>;

/**
 * Converts a raw DB value to a form-state representation.
 * - `null/undefined` → field-type-appropriate empty sentinel
 * - Dates/datetimes → trimmed ISO string for the browser input
 * - JSON objects → pretty-printed string for the textarea
 * - Everything else → coerced to its native JS type
 */
function dbValueToFormValue(
  value: unknown,
  fieldType: string
): string | number | boolean | '' {
  if (value === null || value === undefined) {
    if (fieldType === 'boolean') return false;
    if (fieldType === 'integer' || fieldType === 'decimal') return '';
    return '';
  }

  switch (fieldType) {
    case 'boolean':
      return Boolean(value);

    case 'integer':
      return typeof value === 'number' ? value : parseInt(String(value), 10);

    case 'decimal':
      return typeof value === 'number' ? value : parseFloat(String(value));

    case 'datetime': {
      // datetime-local input expects "YYYY-MM-DDTHH:mm" (no seconds/TZ)
      const str = String(value);
      // ISO 8601: "2024-01-15T10:30:00.000Z" → "2024-01-15T10:30"
      return str.length >= 16 ? str.slice(0, 16) : str;
    }

    case 'json':
      if (typeof value === 'string') return value;
      return JSON.stringify(value, null, 2);

    default:
      return String(value);
  }
}

/**
 * Converts a raw default_value (from field_definitions.default_value) to a
 * form-state value. Handles the JSON-encoded default that Postgres returns.
 */
function defaultValueToFormValue(
  defaultValue: unknown,
  fieldType: string
): string | number | boolean | '' {
  if (defaultValue === null || defaultValue === undefined) {
    if (fieldType === 'boolean') return false;
    return '';
  }
  return dbValueToFormValue(defaultValue, fieldType);
}

/**
 * Builds the initial form state from field definitions.
 *  - For create: use field.default_value
 *  - For edit: use existingRecord.data[field.field_key] ?? field.default_value
 */
function buildInitialState(
  fields: FieldDefinition[],
  existingRecord?: EntityRecord
): FormValues {
  const state: FormValues = {};
  for (const field of fields) {
    const rawValue = existingRecord
      ? (existingRecord.data[field.field_key] ?? field.default_value)
      : field.default_value;
    state[field.field_key] = dbValueToFormValue(rawValue, field.field_type);
  }
  return state;
}

// ─── Client-side validation (UX mirror of server validateData) ────────────────
// ⚠ This is NOT an authorization boundary. The server re-validates on every
// request. This validation is purely to give the user immediate feedback.

interface FieldError {
  field: string;
  message: string;
}

function validateFormValues(
  values: FormValues,
  fields: FieldDefinition[]
): FieldError[] {
  const errors: FieldError[] = [];

  for (const field of fields) {
    const value = values[field.field_key];
    const isEmpty =
      value === '' ||
      value === null ||
      value === undefined ||
      (typeof value === 'string' && value.trim() === '');

    // Required check
    if (field.is_required && isEmpty && field.field_type !== 'boolean') {
      errors.push({
        field: field.field_key,
        message: `${field.display_name} is required.`,
      });
      continue;
    }

    if (isEmpty) continue;

    const { constraints } = field;

    switch (field.field_type) {
      case 'integer': {
        const n = Number(value);
        if (!Number.isInteger(n)) {
          errors.push({ field: field.field_key, message: `${field.display_name} must be a whole number.` });
          break;
        }
        if (constraints.min !== undefined && n < constraints.min)
          errors.push({ field: field.field_key, message: `${field.display_name} must be ≥ ${constraints.min}.` });
        if (constraints.max !== undefined && n > constraints.max)
          errors.push({ field: field.field_key, message: `${field.display_name} must be ≤ ${constraints.max}.` });
        break;
      }

      case 'decimal': {
        const n = Number(value);
        if (isNaN(n)) {
          errors.push({ field: field.field_key, message: `${field.display_name} must be a number.` });
          break;
        }
        if (constraints.min !== undefined && n < constraints.min)
          errors.push({ field: field.field_key, message: `${field.display_name} must be ≥ ${constraints.min}.` });
        if (constraints.max !== undefined && n > constraints.max)
          errors.push({ field: field.field_key, message: `${field.display_name} must be ≤ ${constraints.max}.` });
        break;
      }

      case 'text': {
        const s = String(value);
        if (constraints.min !== undefined && s.length < constraints.min)
          errors.push({ field: field.field_key, message: `${field.display_name} must be at least ${constraints.min} character(s).` });
        if (constraints.max !== undefined && s.length > constraints.max)
          errors.push({ field: field.field_key, message: `${field.display_name} must be at most ${constraints.max} character(s).` });
        if (constraints.pattern) {
          try {
            if (!new RegExp(constraints.pattern).test(s))
              errors.push({ field: field.field_key, message: `${field.display_name} does not match the required pattern.` });
          } catch { /* ignore invalid regex */ }
        }
        break;
      }

      case 'enum': {
        const allowed = constraints.enum_values ?? [];
        if (allowed.length > 0 && !allowed.includes(String(value))) {
          errors.push({
            field: field.field_key,
            message: `${field.display_name} must be one of: ${allowed.join(', ')}.`,
          });
        }
        break;
      }

      case 'date':
      case 'datetime': {
        const s = String(value);
        if (s && isNaN(Date.parse(s))) {
          errors.push({ field: field.field_key, message: `${field.display_name} must be a valid date.` });
        }
        break;
      }

      case 'json': {
        const s = String(value).trim();
        if (s) {
          try { JSON.parse(s); } catch {
            errors.push({ field: field.field_key, message: `${field.display_name} must be valid JSON.` });
          }
        }
        break;
      }

      case 'reference': {
        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRe.test(String(value))) {
          errors.push({ field: field.field_key, message: `${field.display_name} must be a valid record reference.` });
        }
        break;
      }
    }
  }

  return errors;
}

// ─── Convert form values → API payload ────────────────────────────────────────

/**
 * Converts the internal form state to a server-ready payload.
 * - Empty optional fields are omitted (server treats missing keys as "not provided").
 * - Datetime strings are normalised to full ISO 8601.
 * - JSON textarea strings are parsed to their JS value.
 * - Boolean fields are always included (false is a valid value).
 * - File fields are skipped entirely (stub).
 */
function buildPayload(
  values: FormValues,
  fields: FieldDefinition[]
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const field of fields) {
    if (field.field_type === 'file') continue; // stub — never submitted

    const value = values[field.field_key];

    // Always include booleans
    if (field.field_type === 'boolean') {
      payload[field.field_key] = Boolean(value);
      continue;
    }

    const isEmpty =
      value === '' || value === null || value === undefined;

    if (isEmpty) {
      // Omit optional empty fields; the server keeps the existing value on update
      continue;
    }

    switch (field.field_type) {
      case 'integer':
        payload[field.field_key] = parseInt(String(value), 10);
        break;

      case 'decimal':
        payload[field.field_key] = parseFloat(String(value));
        break;

      case 'datetime': {
        // datetime-local gives "YYYY-MM-DDTHH:mm"; normalise to full ISO
        const s = String(value);
        payload[field.field_key] = s.length === 16 ? `${s}:00.000Z` : s;
        break;
      }

      case 'json': {
        const s = String(value).trim();
        try {
          payload[field.field_key] = s ? JSON.parse(s) : null;
        } catch {
          // Shouldn't reach here if client validation ran; send raw string
          // and let the server reject it with a typed error.
          payload[field.field_key] = s;
        }
        break;
      }

      default:
        payload[field.field_key] = String(value);
    }
  }

  return payload;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const EntityRecordForm: React.FC<EntityRecordFormProps> = ({
  fieldDefinitions,
  existingRecord,
  entityTypeSlug,
  onSuccess,
  onCancel,
}) => {
  const router = useRouter();
  const isEditing = !!existingRecord;

  const [values, setValues] = useState<FormValues>(() =>
    buildInitialState(fieldDefinitions, existingRecord)
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // ── Field change handler ─────────────────────────────────────────────────

  const handleChange = useCallback(
    (fieldKey: string, value: string | number | boolean | '') => {
      setValues((prev) => ({ ...prev, [fieldKey]: value }));
      // Clear field error on edit
      setFieldErrors((prev) => {
        if (!prev[fieldKey]) return prev;
        const next = { ...prev };
        delete next[fieldKey];
        return next;
      });
    },
    []
  );

  // ── Submit ───────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      // Client-side validation pass
      const errors = validateFormValues(values, fieldDefinitions);
      if (errors.length > 0) {
        const errMap: Record<string, string> = {};
        for (const e of errors) errMap[e.field] = e.message;
        setFieldErrors(errMap);
        return;
      }

      setFieldErrors({});
      setServerError(null);

      const payload = buildPayload(values, fieldDefinitions);

      const url = isEditing
        ? `/api/entities/${encodeURIComponent(entityTypeSlug)}/records/${existingRecord!.id}`
        : `/api/entities/${encodeURIComponent(entityTypeSlug)}/records`;

      const method = isEditing ? 'PUT' : 'POST';

      try {
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const json = await res.json();

        if (!res.ok) {
          // Handle 422 field-level errors from the server
          if (res.status === 422 && json.fields && Array.isArray(json.fields)) {
            const errMap: Record<string, string> = {};
            for (const fe of json.fields as Array<{ field: string; message: string }>) {
              errMap[fe.field] = fe.message;
            }
            setFieldErrors(errMap);
            return;
          }
          setServerError(json.error ?? `Request failed with status ${res.status}.`);
          return;
        }

        // Success
        startTransition(() => {
          if (onSuccess) {
            onSuccess(json as EntityRecord);
          } else {
            router.refresh();
          }
        });
      } catch (err) {
        setServerError(
          err instanceof Error ? err.message : 'Network error — please try again.'
        );
      }
    },
    [values, fieldDefinitions, isEditing, existingRecord, entityTypeSlug, onSuccess, router]
  );

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {/* Server-level error banner */}
      {serverError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
        >
          <strong className="font-semibold">Error: </strong>
          {serverError}
        </div>
      )}

      {/* Dynamic field rendering — ordered by sort_order (already sorted by server) */}
      {fieldDefinitions.map((field) => {
        const fieldError = fieldErrors[field.field_key];
        const commonProps = {
          fieldDefinition: field,
          error: fieldError,
          disabled: isPending,
        };

        switch (field.field_type) {
          case 'text':
            return (
              <TextField
                key={field.id}
                {...commonProps}
                value={String(values[field.field_key] ?? '')}
                onChange={(v) => handleChange(field.field_key, v)}
              />
            );

          case 'integer':
          case 'decimal':
            return (
              <NumberField
                key={field.id}
                {...commonProps}
                value={values[field.field_key] as number | ''}
                onChange={(v) => handleChange(field.field_key, v)}
              />
            );

          case 'boolean':
            return (
              <BooleanField
                key={field.id}
                {...commonProps}
                value={Boolean(values[field.field_key])}
                onChange={(v) => handleChange(field.field_key, v)}
              />
            );

          case 'enum':
            return (
              <EnumField
                key={field.id}
                {...commonProps}
                value={String(values[field.field_key] ?? '')}
                onChange={(v) => handleChange(field.field_key, v)}
              />
            );

          case 'date':
            return (
              <DateField
                key={field.id}
                {...commonProps}
                value={String(values[field.field_key] ?? '')}
                onChange={(v) => handleChange(field.field_key, v)}
              />
            );

          case 'datetime':
            return (
              <DateTimeField
                key={field.id}
                {...commonProps}
                value={String(values[field.field_key] ?? '')}
                onChange={(v) => handleChange(field.field_key, v)}
              />
            );

          case 'json':
            return (
              <JsonField
                key={field.id}
                {...commonProps}
                value={String(values[field.field_key] ?? '')}
                onChange={(v) => handleChange(field.field_key, v)}
              />
            );

          case 'reference':
            return (
              <ReferenceField
                key={field.id}
                {...commonProps}
                value={String(values[field.field_key] ?? '')}
                onChange={(v) => handleChange(field.field_key, v)}
              />
            );

          case 'file':
            return (
              <FileField
                key={field.id}
                {...commonProps}
                value={values[field.field_key]}
                onChange={(v) => handleChange(field.field_key, v)}
              />
            );

          default:
            // Unknown field type — render a plain text input as fallback
            return (
              <TextField
                key={field.id}
                {...commonProps}
                value={String(values[field.field_key] ?? '')}
                onChange={(v) => handleChange(field.field_key, v)}
              />
            );
        }
      })}

      {/* Action buttons */}
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          isLoading={isPending}
          disabled={isPending}
        >
          {isEditing ? 'Save Changes' : 'Create Record'}
        </Button>
      </div>
    </form>
  );
};

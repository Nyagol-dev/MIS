'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { FieldDefinition } from './TextField';

export interface ReferenceFieldProps {
  fieldDefinition: FieldDefinition;
  /** UUID of the referenced record, or empty string if unset. */
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}

interface ReferencedRecord {
  id: string;
  /** Best-effort display label derived from the record's data payload. */
  label: string;
}

/**
 * ReferenceField — P1 field component for `reference` field_type.
 *
 * Fetches records of the referenced entity type (identified by
 * `constraints.ref_entity_type` — a UUID) from the Task 7 list route:
 *   GET /api/entities/[slug]/records
 *
 * PAGINATION / SEARCH DECISION (Round 9):
 * ─────────────────────────────────────────────────────────────────────────────
 * This component fetches up to 200 records (the API maximum) and renders
 * them as a flat <select>. This is acceptable for Round 9 because:
 *   • The entity type registry is new — most types will have small record
 *     sets in the early life of the product.
 *   • The API enforces max=200, so no infinite scroll risk.
 *
 * ⚠ FLAG FOR FUTURE: If the referenced entity type can accumulate thousands
 * of records (e.g., "Products" in a large catalog), this dropdown approach
 * will degrade. At that point, replace this component with a combobox that:
 *   1. Debounces a search query parameter to `GET /api/entities/[slug]/records?search=…`
 *      (requires adding a ?search= param to the records list route).
 *   2. Shows only the top N matches.
 *   3. Displays the selected record's label even when the full list isn't loaded.
 * Track this as a known limitation in the entity CRUD backlog.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The component resolves the entity type slug from the ref_entity_type UUID by
 * calling GET /api/entities first, then filters for the matching ID to get the
 * slug, then fetches its records.
 *
 * An empty sentinel option is prepended so required-field validation is detectable.
 */
export const ReferenceField: React.FC<ReferenceFieldProps> = ({
  fieldDefinition,
  value,
  onChange,
  error,
  disabled = false,
}) => {
  const { display_name, is_required, constraints } = fieldDefinition;
  const refEntityTypeId = constraints.ref_entity_type;

  const [options, setOptions] = useState<ReferencedRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Use a ref to avoid double-fetching in StrictMode
  const hasFetched = useRef(false);

  const deriveLabel = useCallback((record: { id: string; data: Record<string, unknown> }): string => {
    // Heuristic: look for common display fields in priority order
    const candidates = ['name', 'title', 'label', 'display_name', 'email', 'code'];
    for (const key of candidates) {
      const v = record.data[key];
      if (v && typeof v === 'string' && v.trim()) return v.trim();
      if (v && typeof v === 'number') return String(v);
    }
    // Fallback: first non-null field value + truncated ID
    const firstVal = Object.values(record.data).find(
      (v) => v !== null && v !== undefined && typeof v !== 'object'
    );
    if (firstVal !== undefined) return `${firstVal} (${record.id.slice(0, 8)}…)`;
    return record.id;
  }, []);

  useEffect(() => {
    if (!refEntityTypeId || hasFetched.current) return;
    hasFetched.current = true;

    const fetchOptions = async () => {
      setIsLoading(true);
      setFetchError(null);

      try {
        // Step 1: resolve the ref_entity_type UUID to a slug
        const typesRes = await fetch('/api/entities?limit=200');
        if (!typesRes.ok) {
          throw new Error(`Failed to load entity types: HTTP ${typesRes.status}`);
        }
        const typesJson = await typesRes.json() as { items: Array<{ id: string; slug: string; name: string }> };
        const matchedType = typesJson.items.find((t) => t.id === refEntityTypeId);

        if (!matchedType) {
          setFetchError(`Referenced entity type (${refEntityTypeId.slice(0, 8)}…) not found.`);
          return;
        }

        // Step 2: fetch records for that slug (up to 200 — documented limit above)
        const recordsRes = await fetch(
          `/api/entities/${encodeURIComponent(matchedType.slug)}/records?limit=200`
        );
        if (!recordsRes.ok) {
          throw new Error(`Failed to load ${matchedType.name} records: HTTP ${recordsRes.status}`);
        }
        const recordsJson = await recordsRes.json() as {
          items: Array<{ id: string; data: Record<string, unknown> }>;
          total: number;
        };

        const records = recordsJson.items.map((r) => ({
          id: r.id,
          label: deriveLabel(r),
        }));

        setOptions(records);

        // Warn if we hit the page ceiling — flag to consumer
        if (recordsJson.total > 200) {
          setFetchError(
            `⚠ Only showing 200 of ${recordsJson.total} ${matchedType.name} records. ` +
            `Pagination/search for large reference sets is planned for a future round.`
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error fetching reference options.';
        setFetchError(msg);
      } finally {
        setIsLoading(false);
      }
    };

    fetchOptions();
  }, [refEntityTypeId, deriveLabel]);

  if (!refEntityTypeId) {
    return (
      <div className="w-full flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {display_name}
          {is_required && ' *'}
        </label>
        <p className="text-xs text-red-600 dark:text-red-400">
          Schema misconfiguration: reference field has no ref_entity_type constraint.
        </p>
      </div>
    );
  }

  const selectId = `field-${fieldDefinition.field_key}`;
  const errorMsg = error ?? undefined;
  const warningMsg = fetchError && !error ? fetchError : undefined;

  const borderClass = errorMsg
    ? 'border-red-300 focus:border-red-500 focus:ring-red-500 dark:border-red-800 text-red-900'
    : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 dark:border-slate-700 text-slate-900 dark:text-slate-100';

  return (
    <div className="w-full flex flex-col gap-1.5">
      <label
        htmlFor={selectId}
        className="text-sm font-medium text-slate-700 dark:text-slate-300"
      >
        {display_name}
        {is_required && ' *'}
      </label>

      <div className="relative">
        <select
          id={selectId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={is_required}
          disabled={disabled || isLoading}
          aria-invalid={!!errorMsg}
          aria-describedby={errorMsg ? `${selectId}-error` : undefined}
          className={`
            block w-full appearance-none rounded-lg border px-3 py-2 pr-10 text-sm shadow-sm
            transition-colors duration-200
            focus:outline-none focus:ring-2 focus:ring-offset-0
            disabled:cursor-not-allowed disabled:opacity-50
            dark:bg-slate-900
            ${borderClass}
          `}
        >
          <option value="">
            {isLoading ? 'Loading…' : `— Select ${display_name} —`}
          </option>
          {options.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Chevron icon */}
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
          {isLoading ? (
            <svg
              className="h-4 w-4 animate-spin text-slate-400"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : (
            <svg
              className="h-4 w-4 text-slate-400"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </div>
      </div>

      {errorMsg && (
        <p id={`${selectId}-error`} className="text-xs text-red-600 dark:text-red-400">
          {errorMsg}
        </p>
      )}
      {warningMsg && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {warningMsg}
        </p>
      )}
    </div>
  );
};

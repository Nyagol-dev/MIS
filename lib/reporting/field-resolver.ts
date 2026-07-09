/**
 * lib/reporting/field-resolver.ts
 *
 * Loads and validates field_definitions rows for use in report query building.
 *
 * THREE responsibilities:
 *   1. resolveFieldForReport  — look up a single field_key for an entity type
 *                               (any schema_version). Determines existence + metadata.
 *   2. validateReportFieldKeys — batch-check a set of field_keys before SQL generation.
 *   3. getFieldSqlType         — pure function mapping field_type → Postgres cast target.
 *
 * These functions receive an already-open PoolClient whose tenant context has been
 * set by withTenantContext (i.e. SET LOCAL app.current_tenant_id is in effect).
 * They do NOT call withTenantContext themselves.
 *
 * Security note (blueprint §6 S1):
 *   validateReportFieldKeys is the primary allowlist gate. Every field_key that
 *   will appear in generated SQL MUST pass through this function first.
 */

import type { PoolClient } from 'pg';

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class UnknownFieldTypeError extends Error {
  constructor(fieldType: string) {
    super(
      `[field-resolver] Unknown field_type "${fieldType}". ` +
        `Supported types: text, integer, decimal, boolean, date, datetime, ` +
        `enum, json, reference, file.`
    );
    this.name = 'UnknownFieldTypeError';
  }
}

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

export interface ResolvedField {
  /** The key as stored in field_definitions.field_key */
  field_key: string;
  /** The canonical type string from field_definitions.field_type */
  field_type: string;
  /** The default_value from field_definitions (may be null) */
  default_value: unknown | null;
  /**
   * true  → at least one field_definitions row exists for this entity_type_id +
   *          field_key combination (across any schema_version).
   * false → no such row exists; the field_key is unknown.
   */
  exists: boolean;
}

export interface FieldKeyValidationResult {
  valid: string[];
  invalid: string[];
}

// ---------------------------------------------------------------------------
// resolveFieldForReport
// ---------------------------------------------------------------------------

/**
 * Look up a single field_key in field_definitions for the given entity type,
 * across ALL schema_versions (we only need to know the field exists and what
 * its canonical type is — the query builder handles per-record coercion via
 * LATERAL JOIN).
 *
 * Returns exists: false when no matching row is found.
 *
 * The query is automatically scoped to the caller's tenant by RLS
 * (tenant_id = current_tenant_id() is enforced by the mis_app role policy).
 * The entity_type_id and field_key are passed as bind parameters — never
 * interpolated — satisfying blueprint §6 S1 / S3.
 */
export async function resolveFieldForReport(
  client: PoolClient,
  entityTypeId: string,
  fieldKey: string
): Promise<ResolvedField> {
  // We want any row for this (entity_type_id, field_key) pair.
  // Using ORDER BY schema_version DESC LIMIT 1 gives us the most recent
  // definition row, which carries the most up-to-date field_type and
  // default_value.
  const result = await client.query<{
    field_key: string;
    field_type: string;
    default_value: unknown | null;
  }>(
    `
    SELECT field_key, field_type, default_value
      FROM field_definitions
     WHERE entity_type_id = $1
       AND field_key       = $2
     ORDER BY schema_version DESC
     LIMIT 1
    `,
    [entityTypeId, fieldKey]
  );

  if (result.rows.length === 0) {
    return {
      field_key: fieldKey,
      field_type: '',
      default_value: null,
      exists: false,
    };
  }

  const row = result.rows[0];
  return {
    field_key: row.field_key,
    field_type: row.field_type,
    default_value: row.default_value ?? null,
    exists: true,
  };
}

// ---------------------------------------------------------------------------
// validateReportFieldKeys
// ---------------------------------------------------------------------------

/**
 * Batch-check multiple field_keys against field_definitions for the given
 * entity type.  Returns two arrays:
 *   valid   — field_keys that exist in field_definitions (any schema_version)
 *   invalid — field_keys with no matching row
 *
 * The query builder calls this before generating any SQL so that unknown
 * field_keys are rejected before they can influence query construction
 * (blueprint §6 S1 — allowlist gate).
 *
 * Uses a single query with = ANY($3::text[]) so that the entire set is
 * checked in one round-trip.  node-postgres passes the JS string array
 * as a native Postgres array parameter.
 */
export async function validateReportFieldKeys(
  client: PoolClient,
  entityTypeId: string,
  fieldKeys: string[]
): Promise<FieldKeyValidationResult> {
  if (fieldKeys.length === 0) {
    return { valid: [], invalid: [] };
  }

  // De-duplicate before querying.
  const uniqueKeys = [...new Set(fieldKeys)];

  const result = await client.query<{ field_key: string }>(
    `
    SELECT DISTINCT field_key
      FROM field_definitions
     WHERE entity_type_id = $1
       AND field_key = ANY($2::text[])
    `,
    [entityTypeId, uniqueKeys]
  );

  const foundSet = new Set(result.rows.map((r) => r.field_key));

  const valid: string[] = [];
  const invalid: string[] = [];

  for (const key of uniqueKeys) {
    if (foundSet.has(key)) {
      valid.push(key);
    } else {
      invalid.push(key);
    }
  }

  return { valid, invalid };
}

// ---------------------------------------------------------------------------
// getFieldSqlType
// ---------------------------------------------------------------------------

/**
 * Pure function (no DB access).
 *
 * Maps field_definitions.field_type values to Postgres cast targets used in
 * generated SQL.  The mapping is the authoritative source of truth for the
 * query builder's type casts.
 *
 * Throws UnknownFieldTypeError for any unrecognised field_type so that
 * callers surface a clear error rather than silently producing broken SQL.
 *
 * Blueprint §6 S2: cast targets are hardcoded constants from this function —
 * they are never derived from user-supplied input.
 */
export function getFieldSqlType(fieldType: string): string {
  switch (fieldType) {
    case 'text':
      return 'TEXT';
    case 'integer':
      return 'INTEGER';
    case 'decimal':
      return 'NUMERIC';
    case 'boolean':
      return 'BOOLEAN';
    case 'date':
      return 'DATE';
    case 'datetime':
      return 'TIMESTAMPTZ';
    case 'enum':
      // Enum values are stored as text strings in the JSONB.
      return 'TEXT';
    case 'json':
      return 'JSONB';
    case 'reference':
      // UUID references are stored as text strings in the JSONB (blueprint Q4 note).
      return 'TEXT';
    case 'file':
      // File metadata identifiers are stored as text.
      return 'TEXT';
    default:
      throw new UnknownFieldTypeError(fieldType);
  }
}

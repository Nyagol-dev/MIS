/**
 * lib/entities/records.ts
 *
 * CRUD layer for tenant-defined entity records — the "hard extension"
 * mechanism (§5 of the canonical schema) that lets tenants create entirely
 * new record types at runtime via entity_types / field_definitions /
 * entity_records.
 *
 * SCHEMA VERSIONING CONTRACT (§5.4)
 * ─────────────────────────────────────────────────────────────────────────────
 * • entity_types.current_version tracks the latest schema revision.
 * • field_definitions rows are append-and-retire — never mutated in place.
 *   Each field_definitions row has a schema_version indicating which revision
 *   introduced it. A field is "active" when retired_at IS NULL.
 * • entity_records.schema_version is set to current_version at INSERT and is
 *   immutable thereafter. It pins the record to the exact field set that was
 *   active when it was written.
 * • Historical records remain valid because loading
 *   field_definitions WHERE schema_version <= record.schema_version always
 *   reconstructs the original schema.
 *
 * SOFT-DELETE ASSUMPTION
 * ─────────────────────────────────────────────────────────────────────────────
 * entity_records has no deleted_at column. deleteEntityRecord performs a hard
 * DELETE. The audit_log oldState snapshot is the sole historical record of the
 * row after deletion. If soft-delete is required (e.g. to support undelete or
 * compliance holds), add a deleted_at TIMESTAMPTZ column via migration and
 * replace the DELETE statement with an UPDATE — do NOT silently add that column
 * here without schema review.
 */

import type { PoolClient } from "pg";
import { withTenantContext } from "@/lib/db/withTenant";
import { writeAuditLog } from "@/lib/db/audit";
import {
  canOnEntityType,
  ForbiddenError,
} from "@/lib/auth/permissions";
import type { SessionPayload } from "@/lib/auth/session";
import { getEffectivePermissions } from "@/lib/auth/permissions";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * A row from entity_records, typed against the schema columns.
 * `data` is the free-form JSONB payload keyed by field_key strings.
 */
export interface EntityRecord {
  tenant_id: string;
  entity_type_id: string;
  id: string;
  /** Immutable after INSERT — pinned to the entity_type version at write time. */
  schema_version: number;
  /** JSONB payload: { [field_key]: value } */
  data: Record<string, unknown>;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * A row from field_definitions, typed for internal use by the validator.
 */
interface FieldDefinition {
  id: string;
  schema_version: number;
  field_key: string;
  display_name: string;
  field_type:
    | "text"
    | "integer"
    | "decimal"
    | "boolean"
    | "date"
    | "datetime"
    | "enum"
    | "json"
    | "reference"
    | "file";
  is_required: boolean;
  default_value: unknown;
  constraints: FieldConstraints;
  retired_at: Date | null;
}

/**
 * The shape of field_definitions.constraints JSONB.
 * All keys are optional; the validator only enforces those that are present.
 */
interface FieldConstraints {
  min?: number;
  max?: number;
  pattern?: string;
  enum_values?: string[];
  ref_entity_type?: string; // UUID of the referenced entity type
}

/**
 * Aggregated validation error thrown when the payload fails validation.
 * Contains all errors collected in a single pass (so a form can show all
 * problems at once rather than failing on the first one).
 */
export class EntityValidationError extends Error {
  public readonly code = "ENTITY_VALIDATION_ERROR" as const;
  public readonly errors: ValidationError[];

  constructor(errors: ValidationError[]) {
    super(
      `Entity record validation failed with ${errors.length} error(s):\n` +
        errors.map((e) => `  • [${e.field}] ${e.message}`).join("\n")
    );
    this.name = "EntityValidationError";
    this.errors = errors;
  }
}

export interface ValidationError {
  /** The field_key that failed, or '__root__' for record-level errors. */
  field: string;
  message: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Loads entity_types.current_version for the given entity type, returning null
 * if the entity type does not exist or is inactive.
 */
async function loadCurrentVersion(
  client: PoolClient,
  entityTypeId: string
): Promise<number | null> {
  const { rows } = await client.query<{ current_version: number }>(
    `SELECT current_version
       FROM entity_types
      WHERE id = $1
        AND is_active = TRUE`,
    [entityTypeId]
  );
  return rows[0]?.current_version ?? null;
}

/**
 * Loads field_definitions that are relevant for a given schema version boundary.
 *
 * @param upToVersion - Upper bound (inclusive) on schema_version to load.
 *                      Pass the record's pinned schema_version for reads/updates;
 *                      pass current_version for creates.
 * @param activeOnly  - When true, filters to retired_at IS NULL (active fields only).
 *                      When false, returns all fields up to upToVersion regardless
 *                      of retirement status.
 */
async function loadFieldDefinitions(
  client: PoolClient,
  entityTypeId: string,
  upToVersion: number,
  activeOnly: boolean
): Promise<FieldDefinition[]> {
  const { rows } = await client.query<FieldDefinition>(
    `SELECT id,
            schema_version,
            field_key,
            display_name,
            field_type,
            is_required,
            default_value,
            constraints,
            retired_at
       FROM field_definitions
      WHERE entity_type_id = $1
        AND schema_version  <= $2
        ${activeOnly ? "AND retired_at IS NULL" : ""}
      ORDER BY sort_order ASC, schema_version ASC`,
    [entityTypeId, upToVersion]
  );
  return rows;
}

/**
 * Validates `data` against a set of field_definitions and returns ALL errors
 * found in a single pass. Does not throw — callers inspect the array and
 * decide whether to abort.
 *
 * Rules enforced:
 *  1. No keys in `data` that are absent from any `allowedFields` (unknown-key rejection).
 *  2. Required fields must be present and non-null/non-empty.
 *  3. field_type correctness (JavaScript type checks + coercibility probes).
 *  4. constraints: min, max, pattern, enum_values, ref_entity_type (presence check only).
 */
function validateData(
  data: Record<string, unknown>,
  allowedFields: FieldDefinition[]
): ValidationError[] {
  const errors: ValidationError[] = [];
  const fieldMap = new Map<string, FieldDefinition>(
    allowedFields.map((f) => [f.field_key, f])
  );
  const allowedKeys = new Set(fieldMap.keys());

  // 1. Reject unknown keys — keys in `data` not defined in any field_definition.
  for (const key of Object.keys(data)) {
    if (!allowedKeys.has(key)) {
      errors.push({
        field: key,
        message: `Unknown field '${key}': not defined in the entity schema.`,
      });
    }
  }

  // 2–4. Per-field validation.
  for (const field of allowedFields) {
    const value = data[field.field_key];
    const isMissing = value === undefined || value === null;

    // 2. Required fields.
    if (field.is_required && isMissing) {
      errors.push({
        field: field.field_key,
        message: `Field '${field.display_name}' (${field.field_key}) is required.`,
      });
      // Can't validate type/constraints on a missing value; continue to next field.
      continue;
    }

    // Skip optional missing fields — no further checks needed.
    if (isMissing) continue;

    // 3. field_type correctness.
    const typeError = checkFieldType(field.field_key, field.display_name, field.field_type, value);
    if (typeError) {
      errors.push(typeError);
      // Type failure makes constraint checks unreliable; skip them.
      continue;
    }

    // 4. Constraint checks.
    const constraintErrors = checkConstraints(
      field.field_key,
      field.display_name,
      field.field_type,
      value,
      field.constraints
    );
    errors.push(...constraintErrors);
  }

  return errors;
}

/**
 * Returns a ValidationError if `value` is not compatible with `fieldType`,
 * or null if the type check passes.
 */
function checkFieldType(
  key: string,
  displayName: string,
  fieldType: FieldDefinition["field_type"],
  value: unknown
): ValidationError | null {
  switch (fieldType) {
    case "text":
    case "enum":
    case "reference":
    case "file":
      if (typeof value !== "string") {
        return {
          field: key,
          message: `Field '${displayName}' must be a string (got ${typeof value}).`,
        };
      }
      break;

    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return {
          field: key,
          message: `Field '${displayName}' must be an integer (got ${JSON.stringify(value)}).`,
        };
      }
      break;

    case "decimal":
      if (typeof value !== "number") {
        return {
          field: key,
          message: `Field '${displayName}' must be a number (got ${typeof value}).`,
        };
      }
      break;

    case "boolean":
      if (typeof value !== "boolean") {
        return {
          field: key,
          message: `Field '${displayName}' must be a boolean (got ${typeof value}).`,
        };
      }
      break;

    case "date":
    case "datetime": {
      // Accept ISO 8601 strings and Date objects (serialized as strings from JSON).
      const isIsoString =
        typeof value === "string" && !isNaN(Date.parse(value));
      if (!isIsoString) {
        return {
          field: key,
          message: `Field '${displayName}' must be a valid ISO 8601 date string (got ${JSON.stringify(value)}).`,
        };
      }
      break;
    }

    case "json":
      // Any JSON-serializable value is acceptable for a 'json' field.
      break;

    default:
      // Exhaustiveness guard — if a new field_type is added to the schema
      // without updating this function, validation will silently pass.
      // Add a case above and remove this comment when extending the type set.
      break;
  }
  return null;
}

/**
 * Checks constraints JSONB against the value. Returns an array of errors
 * (may be empty).
 */
function checkConstraints(
  key: string,
  displayName: string,
  fieldType: FieldDefinition["field_type"],
  value: unknown,
  constraints: FieldConstraints
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!constraints || Object.keys(constraints).length === 0) return errors;

  // min / max — applies to numeric fields and string length for text fields.
  if (fieldType === "integer" || fieldType === "decimal") {
    const num = value as number;
    if (constraints.min !== undefined && num < constraints.min) {
      errors.push({
        field: key,
        message: `Field '${displayName}' must be >= ${constraints.min} (got ${num}).`,
      });
    }
    if (constraints.max !== undefined && num > constraints.max) {
      errors.push({
        field: key,
        message: `Field '${displayName}' must be <= ${constraints.max} (got ${num}).`,
      });
    }
  }

  if (fieldType === "text" && typeof value === "string") {
    if (constraints.min !== undefined && value.length < constraints.min) {
      errors.push({
        field: key,
        message: `Field '${displayName}' must be at least ${constraints.min} character(s) long.`,
      });
    }
    if (constraints.max !== undefined && value.length > constraints.max) {
      errors.push({
        field: key,
        message: `Field '${displayName}' must be at most ${constraints.max} character(s) long.`,
      });
    }

    // pattern — regex match on text values.
    if (constraints.pattern) {
      try {
        const re = new RegExp(constraints.pattern);
        if (!re.test(value)) {
          errors.push({
            field: key,
            message: `Field '${displayName}' does not match the required pattern (${constraints.pattern}).`,
          });
        }
      } catch {
        // Invalid regex stored in constraints — treat as "no pattern constraint"
        // and log so the platform team can fix the field definition.
        console.error(
          `[entities/records] Invalid regex in field_definitions.constraints.pattern for field '${key}': ${constraints.pattern}`
        );
      }
    }
  }

  // enum_values — applies to 'enum' field_type.
  if (
    fieldType === "enum" &&
    constraints.enum_values &&
    constraints.enum_values.length > 0
  ) {
    if (!constraints.enum_values.includes(value as string)) {
      errors.push({
        field: key,
        message: `Field '${displayName}' must be one of: ${constraints.enum_values.join(", ")} (got '${value}').`,
      });
    }
  }

  // ref_entity_type — presence check only. We confirm the constraint key is
  // set (i.e. the field is typed as a reference to a specific entity type),
  // but we do NOT query the DB here to verify the referenced record exists.
  // Cross-entity referential integrity, if needed, belongs in a separate
  // validation pass that receives a DB client.
  // The value format is a UUID string; basic UUID structure is checked.
  if (fieldType === "reference" && constraints.ref_entity_type) {
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof value !== "string" || !uuidRe.test(value)) {
      errors.push({
        field: key,
        message: `Field '${displayName}' must be a valid UUID referencing an entity of type '${constraints.ref_entity_type}'.`,
      });
    }
  }

  return errors;
}

// ─── Authorization helper ─────────────────────────────────────────────────────

/**
 * Resolves the session's effective permissions and checks the entity-type
 * action grant. Throws ForbiddenError on denial.
 */
async function requireEntityAccess(
  session: SessionPayload,
  entityTypeId: string,
  action: "create" | "read" | "update" | "delete"
): Promise<void> {
  const perms = await getEffectivePermissions(session.tenantId, session.userId);
  if (!canOnEntityType(perms, entityTypeId, action)) {
    throw new ForbiddenError(
      `Permission denied: action '${action}' on entity type '${entityTypeId}' is not granted to this user.`
    );
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Creates a new entity record for the given entity type.
 *
 * Validation rules (all errors collected before throwing):
 *  - Required fields must be present.
 *  - Values must be type-correct per field_type.
 *  - Constraints JSONB (min, max, pattern, enum_values, ref_entity_type) are enforced.
 *  - Unknown keys (not defined in any active field_definition) are rejected.
 *
 * schema_version is set to entity_types.current_version at the time of insert
 * and is immutable thereafter (§5.4).
 *
 * @param session      - Verified session payload.
 * @param entityTypeId - UUID of the entity type to create a record for.
 * @param data         - Key/value payload. Keys must match active field_keys.
 * @returns The newly created EntityRecord.
 * @throws {ForbiddenError}        If the session lacks 'create' on this entity type.
 * @throws {EntityValidationError} If the data payload fails validation.
 * @throws {Error}                 If the entity type is not found or inactive.
 */
export async function createEntityRecord(
  session: SessionPayload,
  entityTypeId: string,
  data: Record<string, unknown>
): Promise<EntityRecord> {
  await requireEntityAccess(session, entityTypeId, "create");

  return withTenantContext(session.tenantId, async (client) => {
    // 1. Load the current schema version for this entity type.
    const currentVersion = await loadCurrentVersion(client, entityTypeId);
    if (currentVersion === null) {
      throw new Error(
        `Entity type '${entityTypeId}' not found or is inactive.`
      );
    }

    // 2. Load all ACTIVE field_definitions at or below current_version.
    //    "Active" means retired_at IS NULL — retired fields are excluded entirely
    //    from the create path.
    const fields = await loadFieldDefinitions(
      client,
      entityTypeId,
      currentVersion,
      true // activeOnly
    );

    // 3. Validate the payload — collect ALL errors before throwing.
    const validationErrors = validateData(data, fields);
    if (validationErrors.length > 0) {
      throw new EntityValidationError(validationErrors);
    }

    // 4. Insert the record.
    const { rows } = await client.query<EntityRecord>(
      `INSERT INTO entity_records
               (tenant_id, entity_type_id, schema_version, data, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, $5)
     RETURNING tenant_id, entity_type_id, id, schema_version, data,
               created_by, updated_by, created_at, updated_at`,
      [
        session.tenantId,
        entityTypeId,
        currentVersion,
        JSON.stringify(data),
        session.userId,
      ]
    );
    const record = rows[0];

    // 5. Audit.
    await writeAuditLog(client, {
      tenantId: session.tenantId,
      actorId: session.userId,
      action: "entity_record.created",
      entityType: entityTypeId,
      entityId: record.id,
      oldState: null,
      newState: record as unknown as Record<string, unknown>,
      context: { schema_version: currentVersion },
    });

    return record;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN RESOLUTION — updateEntityRecord field writability
// ─────────────────────────────────────────────────────────────────────────────
// The canonical schema document does not fully specify what is writable during
// an update on a record whose schema_version is lower than the type's current
// version. This function implements the following explicit policy:
//
//   WRITABLE:
//     Fields whose schema_version <= record.schema_version AND whose
//     retired_at IS NULL (currently active).
//
//   READ-ONLY (preserved, not required, not writable):
//     Fields that are retired (retired_at IS NOT NULL) regardless of which
//     schema version introduced them. If the update payload mentions a retired
//     field key, an error is returned. The stored value is left untouched.
//
//   INVISIBLE (not present on this record at all):
//     Fields introduced in schema versions AFTER the record's pinned
//     schema_version. These fields did not exist when the record was written
//     and cannot be added via update — doing so would break the invariant that
//     entity_records.schema_version pins the exact field set the record was
//     validated against. New fields require the record to be deleted and
//     re-created (or a future migration path to be defined by the platform).
//
// Rationale: the schema_version is immutable by design (see COMMENT ON COLUMN
// entity_records.schema_version in the DDL). Allowing an update to pull in
// fields from a newer version would silently change the record's effective
// schema without incrementing schema_version, breaking historical validation.
//
// ⚠ FLAG FOR REVIEW: If the product intent is to allow "schema migration on
// save" (i.e. update bumps the record to current_version and validates against
// new fields), this function must be changed. That would require agreement on
// how missing new required fields are handled (default values? reject?).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Updates an existing entity record.
 *
 * See the DESIGN RESOLUTION comment above for the exact field writability rules.
 *
 * @param session      - Verified session payload.
 * @param entityTypeId - UUID of the entity type.
 * @param recordId     - UUID of the entity record to update.
 * @param data         - Partial or full payload of writable fields.
 * @returns The updated EntityRecord.
 * @throws {ForbiddenError}        If the session lacks 'update' on this entity type.
 * @throws {EntityValidationError} If the data payload fails validation.
 * @throws {Error}                 If the record is not found.
 */
export async function updateEntityRecord(
  session: SessionPayload,
  entityTypeId: string,
  recordId: string,
  data: Record<string, unknown>
): Promise<EntityRecord> {
  await requireEntityAccess(session, entityTypeId, "update");

  return withTenantContext(session.tenantId, async (client) => {
    // 1. Load the existing record (the record's schema_version is authoritative).
    const existing = await loadRecord(client, entityTypeId, recordId);
    if (!existing) {
      throw new Error(
        `Entity record '${recordId}' not found on entity type '${entityTypeId}'.`
      );
    }

    const pinnedVersion = existing.schema_version;

    // 2. Load ALL field_definitions up to the pinned version (retired + active).
    //    We need both sets:
    //      • Active (retired_at IS NULL) → writable fields.
    //      • Retired (retired_at IS NOT NULL) → read-only; reject if mentioned in payload.
    const allFields = await loadFieldDefinitions(
      client,
      entityTypeId,
      pinnedVersion,
      false // all fields, not just active
    );

    const activeFields = allFields.filter((f) => f.retired_at === null);
    const retiredKeys = new Set(
      allFields
        .filter((f) => f.retired_at !== null)
        .map((f) => f.field_key)
    );

    // 3. Reject any attempt to write to retired fields.
    const retiredWriteErrors: ValidationError[] = [];
    for (const key of Object.keys(data)) {
      if (retiredKeys.has(key)) {
        retiredWriteErrors.push({
          field: key,
          message: `Field '${key}' has been retired and is read-only. Omit it from the update payload.`,
        });
      }
    }
    if (retiredWriteErrors.length > 0) {
      throw new EntityValidationError(retiredWriteErrors);
    }

    // 4. Validate the writable payload against active fields only.
    //    We pass activeFields as the "allowed" set so that keys not in
    //    activeFields (including post-pinned-version fields) are rejected.
    const validationErrors = validateData(data, activeFields);
    if (validationErrors.length > 0) {
      throw new EntityValidationError(validationErrors);
    }

    // 5. Merge: start from the existing stored data and overlay the incoming
    //    payload. This preserves retired-field values untouched.
    const mergedData = {
      ...(existing.data as Record<string, unknown>),
      ...data,
    };

    // 6. Write.
    const { rows } = await client.query<EntityRecord>(
      `UPDATE entity_records
          SET data       = $1,
              updated_by = $2,
              updated_at = now()
        WHERE tenant_id      = $3
          AND entity_type_id = $4
          AND id             = $5
      RETURNING tenant_id, entity_type_id, id, schema_version, data,
                created_by, updated_by, created_at, updated_at`,
      [
        JSON.stringify(mergedData),
        session.userId,
        session.tenantId,
        entityTypeId,
        recordId,
      ]
    );

    if (rows.length === 0) {
      // Race condition: record was deleted between the SELECT and UPDATE.
      throw new Error(
        `Entity record '${recordId}' was not found during update (possible concurrent deletion).`
      );
    }

    const updated = rows[0];

    // 7. Audit with pre/post state.
    await writeAuditLog(client, {
      tenantId: session.tenantId,
      actorId: session.userId,
      action: "entity_record.updated",
      entityType: entityTypeId,
      entityId: recordId,
      oldState: existing as unknown as Record<string, unknown>,
      newState: updated as unknown as Record<string, unknown>,
      context: { schema_version: pinnedVersion },
    });

    return updated;
  });
}

/**
 * Hard-deletes an entity record.
 *
 * SOFT-DELETE NOTE: There is no deleted_at column on entity_records by design
 * (see the schema DDL). This is a hard DELETE. The audit_log oldState snapshot
 * written here is the sole historical record of the row's last known state
 * after deletion. If the product requires soft-delete (undelete, compliance
 * holds, etc.), add a deleted_at TIMESTAMPTZ column via a schema migration and
 * change this function accordingly — do NOT add it silently here.
 *
 * @param session      - Verified session payload.
 * @param entityTypeId - UUID of the entity type.
 * @param recordId     - UUID of the entity record to delete.
 * @throws {ForbiddenError} If the session lacks 'delete' on this entity type.
 * @throws {Error}          If the record is not found.
 */
export async function deleteEntityRecord(
  session: SessionPayload,
  entityTypeId: string,
  recordId: string
): Promise<void> {
  await requireEntityAccess(session, entityTypeId, "delete");

  return withTenantContext(session.tenantId, async (client) => {
    // 1. Load the record first so we can capture the pre-delete state for audit.
    const existing = await loadRecord(client, entityTypeId, recordId);
    if (!existing) {
      throw new Error(
        `Entity record '${recordId}' not found on entity type '${entityTypeId}'.`
      );
    }

    // 2. Hard DELETE.
    await client.query(
      `DELETE FROM entity_records
        WHERE tenant_id      = $1
          AND entity_type_id = $2
          AND id             = $3`,
      [session.tenantId, entityTypeId, recordId]
    );

    // 3. Audit — newState is null because the row no longer exists.
    await writeAuditLog(client, {
      tenantId: session.tenantId,
      actorId: session.userId,
      action: "entity_record.deleted",
      entityType: entityTypeId,
      entityId: recordId,
      oldState: existing as unknown as Record<string, unknown>,
      newState: null,
      context: { schema_version: existing.schema_version },
    });
  });
}

/**
 * Returns a single entity record by ID.
 *
 * Reads are not audited in this design (audit_log is mutation-only).
 *
 * @param session      - Verified session payload.
 * @param entityTypeId - UUID of the entity type.
 * @param recordId     - UUID of the entity record.
 * @returns The EntityRecord, or null if not found.
 * @throws {ForbiddenError} If the session lacks 'read' on this entity type.
 */
export async function getEntityRecord(
  session: SessionPayload,
  entityTypeId: string,
  recordId: string
): Promise<EntityRecord | null> {
  await requireEntityAccess(session, entityTypeId, "read");

  return withTenantContext(session.tenantId, async (client) => {
    return loadRecord(client, entityTypeId, recordId);
  });
}

/**
 * Returns a paginated list of entity records for the given entity type,
 * ordered by created_at DESC (matching idx_entity_records_type).
 *
 * TODO: JSONB data filtering (e.g. WHERE data->>'status' = 'active') is NOT
 * implemented here. Adding an unindexed `data @> '{"key":"value"}'` scan
 * would require a full table scan within the tenant+type partition and is
 * unsuitable for production load. When filtering by a JSONB key is needed:
 *   1. Ensure the field_definition has is_indexed = TRUE.
 *   2. Create a GIN or expression index for that field_key (see schema §7 tip).
 *   3. Add a typed `filter` parameter to this function and construct a WHERE
 *      clause that uses the index (e.g. `data->>'field_key' = $N`).
 *
 * @param session      - Verified session payload.
 * @param entityTypeId - UUID of the entity type.
 * @param options      - Pagination options.
 * @param options.limit  - Maximum rows to return (default 50, max 200).
 * @param options.offset - Row offset for cursor pagination (default 0).
 * @returns An array of EntityRecord rows (may be empty).
 * @throws {ForbiddenError} If the session lacks 'read' on this entity type.
 */
export async function listEntityRecords(
  session: SessionPayload,
  entityTypeId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<EntityRecord[]> {
  await requireEntityAccess(session, entityTypeId, "read");

  const limit = Math.min(options.limit ?? 50, 200);
  const offset = options.offset ?? 0;

  return withTenantContext(session.tenantId, async (client) => {
    const { rows } = await client.query<EntityRecord>(
      `SELECT tenant_id, entity_type_id, id, schema_version, data,
              created_by, updated_by, created_at, updated_at
         FROM entity_records
        WHERE tenant_id      = $1
          AND entity_type_id = $2
        ORDER BY created_at DESC
        LIMIT $3
       OFFSET $4`,
      [session.tenantId, entityTypeId, limit, offset]
    );
    return rows;
  });
}

// ─── Private utility ──────────────────────────────────────────────────────────

/**
 * Loads a single entity record from within an active withTenantContext
 * transaction. RLS enforces tenant scoping; entity_type_id is included in
 * the WHERE to prevent cross-type access.
 */
async function loadRecord(
  client: PoolClient,
  entityTypeId: string,
  recordId: string
): Promise<EntityRecord | null> {
  const { rows } = await client.query<EntityRecord>(
    `SELECT tenant_id, entity_type_id, id, schema_version, data,
            created_by, updated_by, created_at, updated_at
       FROM entity_records
      WHERE entity_type_id = $1
        AND id             = $2`,
    [entityTypeId, recordId]
  );
  return rows[0] ?? null;
}

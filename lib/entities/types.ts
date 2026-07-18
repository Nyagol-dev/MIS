/**
 * lib/entities/types.ts
 *
 * Data-access layer for tenant-defined entity types (entity_types) and their
 * field schema (field_definitions).
 *
 * SCHEMA REFERENCES
 * ─────────────────────────────────────────────────────────────────────────────
 * • entity_types      §5.1 — one row per tenant-defined record type.
 * • field_definitions §5.2 — append-and-retire schema registry.
 *   Field rows are NEVER mutated in place. Adding a field bumps
 *   entity_types.current_version and inserts a new field_definitions row
 *   at that version. Retiring a field sets retired_at on its row and also
 *   bumps current_version.
 *
 * PERMISSION MODEL
 * ─────────────────────────────────────────────────────────────────────────────
 * All write operations require the caller to have already verified the session
 * and called requireTenantAdmin (or an equivalent entity-type admin guard)
 * BEFORE entering withTenantContext. These functions do NOT perform auth
 * checks themselves — that is the route handler's responsibility.
 *
 * SOFT-DELETE CONVENTION FOR entity_types (retire, not hard-delete)
 * ─────────────────────────────────────────────────────────────────────────────
 * entity_types has an `is_active` flag but no `deleted_at` column. The
 * "retire" operation sets is_active = FALSE. A hard DELETE is blocked at the
 * route layer if any entity_records reference the type (FK enforcement at
 * the DB layer via ON DELETE CASCADE, but we refuse at the application layer
 * before that).
 *
 * CONTRACT: All functions accept a tenant-scoped PoolClient from
 * withTenantContext and run inside that transaction. They do NOT open their
 * own connections.
 */

import type { PoolClient } from "pg";
import { writeAuditLog } from "@/lib/db/audit";

// ─── Public types ─────────────────────────────────────────────────────────────

/** A row from entity_types, exactly as stored. */
export interface EntityType {
  tenant_id: string;
  id: string;
  name: string;
  slug: string;
  description: string;
  current_version: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** entity_type row plus its active field_definitions inlined. */
export interface EntityTypeDetail extends EntityType {
  fields: FieldDefinitionRow[];
}

/** A row from field_definitions, as returned to API callers. */
export interface FieldDefinitionRow {
  tenant_id: string;
  entity_type_id: string;
  id: string;
  schema_version: number;
  field_key: string;
  display_name: string;
  field_type: string;
  is_required: boolean;
  is_indexed: boolean;
  sort_order: number;
  default_value: unknown;
  constraints: Record<string, unknown>;
  retired_at: Date | null;
  created_at: Date;
}

/** Standard paginated list envelope used across all list endpoints. */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Typed error shapes ───────────────────────────────────────────────────────

export interface NotFoundError {
  code: "NOT_FOUND";
  message: string;
}

export interface ConflictError {
  code: "CONFLICT";
  message: string;
}

export interface ValidationError {
  code: "VALIDATION_ERROR";
  message: string;
}

export interface EntityTypeInUseError {
  code: "ENTITY_TYPE_IN_USE";
  message: string;
}

export type EntityTypeError =
  | NotFoundError
  | ConflictError
  | ValidationError
  | EntityTypeInUseError;

// ─── Allowed field_type values (mirrors schema CHECK constraint §5.2) ─────────

const ALLOWED_FIELD_TYPES = new Set([
  "text",
  "integer",
  "decimal",
  "boolean",
  "date",
  "datetime",
  "enum",
  "json",
  "reference",
  "file",
]);

// ─── 1. listEntityTypes ───────────────────────────────────────────────────────

/**
 * Returns a paginated list of entity_types for the current tenant.
 *
 * Only active entity types are returned by default (is_active = TRUE).
 * Pass `includeRetired: true` to include retired types (used by platform admin
 * views).
 *
 * Response shape matches the project-wide { items, total, limit, offset }
 * pagination contract.
 *
 * @param client        - PoolClient from withTenantContext.
 * @param tenantId      - The tenant UUID.
 * @param options       - Pagination options.
 */
export async function listEntityTypes(
  client: PoolClient,
  tenantId: string,
  options: { limit?: number; offset?: number; includeRetired?: boolean } = {}
): Promise<PaginatedResult<EntityType>> {
  const limit = Math.min(options.limit ?? 50, 200);
  const offset = options.offset ?? 0;
  const includeRetired = options.includeRetired ?? false;

  const activeFilter = includeRetired ? "" : "AND is_active = TRUE";

  // COUNT query for the total.
  const { rows: countRows } = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
       FROM entity_types
      WHERE tenant_id = $1
        ${activeFilter}`,
    [tenantId]
  );
  const total = parseInt(countRows[0]?.total ?? "0", 10);

  // Data query.
  const { rows } = await client.query<EntityType>(
    `SELECT tenant_id, id, name, slug, description,
            current_version, is_active, created_at, updated_at
       FROM entity_types
      WHERE tenant_id = $1
        ${activeFilter}
      ORDER BY name ASC
      LIMIT $2
     OFFSET $3`,
    [tenantId, limit, offset]
  );

  return { items: rows, total, limit, offset };
}

// ─── 2. getEntityTypeBySlug ───────────────────────────────────────────────────

/**
 * Loads a single entity_type by its URL slug, plus all current field_definitions
 * (active fields at the current_version, i.e. retired_at IS NULL).
 *
 * @param client   - PoolClient from withTenantContext.
 * @param tenantId - The tenant UUID.
 * @param slug     - The URL-safe slug (e.g. 'patient').
 * @returns EntityTypeDetail or a NotFoundError.
 */
export async function getEntityTypeBySlug(
  client: PoolClient,
  tenantId: string,
  slug: string
): Promise<EntityTypeDetail | NotFoundError> {
  const { rows: typeRows } = await client.query<EntityType>(
    `SELECT tenant_id, id, name, slug, description,
            current_version, is_active, created_at, updated_at
       FROM entity_types
      WHERE tenant_id = $1
        AND slug      = $2`,
    [tenantId, slug]
  );

  if (typeRows.length === 0) {
    return {
      code: "NOT_FOUND",
      message: `Entity type with slug '${slug}' not found.`,
    };
  }

  const entityType = typeRows[0];

  // Load active fields at the current version.
  const { rows: fieldRows } = await client.query<FieldDefinitionRow>(
    `SELECT tenant_id, entity_type_id, id, schema_version, field_key,
            display_name, field_type, is_required, is_indexed, sort_order,
            default_value, constraints, retired_at, created_at
       FROM field_definitions
      WHERE tenant_id      = $1
        AND entity_type_id = $2
        AND schema_version <= $3
        AND retired_at IS NULL
      ORDER BY sort_order ASC, schema_version ASC`,
    [tenantId, entityType.id, entityType.current_version]
  );

  return { ...entityType, fields: fieldRows };
}

// ─── 3. createEntityType ──────────────────────────────────────────────────────

/**
 * Creates a new entity_type for the tenant.
 *
 * The slug must be unique within the tenant (enforced by a UNIQUE constraint
 * in the schema). If it already exists this function returns a ConflictError.
 *
 * current_version starts at 1 (the schema default); field_definitions are
 * added separately via createFieldDefinition.
 *
 * @param client      - PoolClient from withTenantContext.
 * @param tenantId    - The tenant UUID.
 * @param input       - Create payload.
 * @param actorUserId - UUID of the session user performing the action.
 * @returns The newly created EntityType or a typed error.
 */
export async function createEntityType(
  client: PoolClient,
  tenantId: string,
  input: {
    name: string;
    slug: string;
    description?: string;
  },
  actorUserId: string
): Promise<EntityType | ConflictError | ValidationError> {
  // Basic validation.
  if (!input.name || !input.name.trim()) {
    return { code: "VALIDATION_ERROR", message: "Field 'name' is required." };
  }
  if (!input.slug || !input.slug.trim()) {
    return { code: "VALIDATION_ERROR", message: "Field 'slug' is required." };
  }

  // Validate slug format: lowercase alphanumeric + hyphens/underscores only.
  if (!/^[a-z0-9_-]+$/.test(input.slug)) {
    return {
      code: "VALIDATION_ERROR",
      message:
        "Field 'slug' must be lowercase alphanumeric with optional hyphens or underscores (e.g. 'patient-record').",
    };
  }

  let entityType: EntityType;
  try {
    const { rows } = await client.query<EntityType>(
      `INSERT INTO entity_types
               (tenant_id, name, slug, description)
        VALUES ($1, $2, $3, $4)
     RETURNING tenant_id, id, name, slug, description,
               current_version, is_active, created_at, updated_at`,
      [tenantId, input.name.trim(), input.slug.trim(), input.description?.trim() ?? ""]
    );
    entityType = rows[0];
  } catch (err: unknown) {
    // Postgres unique-violation error code is '23505'.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "23505") {
      return {
        code: "CONFLICT",
        message: `An entity type with slug '${input.slug}' already exists for this tenant.`,
      };
    }
    throw err;
  }

  await writeAuditLog(client, {
    tenantId,
    actorId: actorUserId,
    action: "entity_type.created",
    entityType: "entity_type",
    entityId: entityType.id,
    oldState: null,
    newState: entityType as unknown as Record<string, unknown>,
  });

  return entityType;
}

// ─── 4. updateEntityType ──────────────────────────────────────────────────────

/**
 * Updates metadata fields on an entity_type (name and/or description).
 *
 * The slug is intentionally NOT updatable here — changing a slug breaks all
 * URL bookmarks and any code that references the type by slug. If slug
 * renaming is ever needed it requires a separate, deliberate migration.
 *
 * @param client      - PoolClient from withTenantContext.
 * @param tenantId    - The tenant UUID.
 * @param slug        - The current URL slug of the entity type to update.
 * @param input       - Fields to update (partial).
 * @param actorUserId - UUID of the session user performing the action.
 * @returns The updated EntityType or a typed error.
 */
export async function updateEntityType(
  client: PoolClient,
  tenantId: string,
  slug: string,
  input: {
    name?: string;
    description?: string;
  },
  actorUserId: string
): Promise<EntityType | NotFoundError | ValidationError> {
  // Load existing row first so we can audit the diff.
  const { rows: existing } = await client.query<EntityType>(
    `SELECT tenant_id, id, name, slug, description,
            current_version, is_active, created_at, updated_at
       FROM entity_types
      WHERE tenant_id = $1
        AND slug      = $2`,
    [tenantId, slug]
  );

  if (existing.length === 0) {
    return { code: "NOT_FOUND", message: `Entity type '${slug}' not found.` };
  }

  const before = existing[0];

  // Validate any provided fields.
  if (input.name !== undefined && !input.name.trim()) {
    return { code: "VALIDATION_ERROR", message: "Field 'name' cannot be blank." };
  }

  const newName = input.name !== undefined ? input.name.trim() : before.name;
  const newDesc =
    input.description !== undefined ? input.description.trim() : before.description;

  const { rows } = await client.query<EntityType>(
    `UPDATE entity_types
        SET name        = $1,
            description = $2,
            updated_at  = now()
      WHERE tenant_id = $3
        AND slug      = $4
  RETURNING tenant_id, id, name, slug, description,
            current_version, is_active, created_at, updated_at`,
    [newName, newDesc, tenantId, slug]
  );

  const updated = rows[0];

  await writeAuditLog(client, {
    tenantId,
    actorId: actorUserId,
    action: "entity_type.updated",
    entityType: "entity_type",
    entityId: before.id,
    oldState: before as unknown as Record<string, unknown>,
    newState: updated as unknown as Record<string, unknown>,
  });

  return updated;
}

// ─── 5. retireEntityType ──────────────────────────────────────────────────────

/**
 * Soft-deletes (retires) an entity_type by setting is_active = FALSE.
 *
 * HARD-DELETE BLOCKED: If any entity_records reference this entity type we
 * refuse to retire it and return an EntityTypeInUseError. This matches the
 * append-and-retire convention — we never destroy data that is still
 * referenced. A hard DELETE is never issued here.
 *
 * @param client      - PoolClient from withTenantContext.
 * @param tenantId    - The tenant UUID.
 * @param slug        - URL slug of the entity type to retire.
 * @param actorUserId - UUID of the session user performing the action.
 * @returns undefined on success, or a typed error.
 */
export async function retireEntityType(
  client: PoolClient,
  tenantId: string,
  slug: string,
  actorUserId: string
): Promise<NotFoundError | EntityTypeInUseError | undefined> {
  // 1. Resolve the entity type.
  const { rows: typeRows } = await client.query<EntityType>(
    `SELECT tenant_id, id, name, slug, description,
            current_version, is_active, created_at, updated_at
       FROM entity_types
      WHERE tenant_id = $1
        AND slug      = $2`,
    [tenantId, slug]
  );

  if (typeRows.length === 0) {
    return { code: "NOT_FOUND", message: `Entity type '${slug}' not found.` };
  }

  const entityType = typeRows[0];

  // 2. Guard: refuse if any entity_records reference this type.
  const { rows: refRows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM entity_records
        WHERE tenant_id      = $1
          AND entity_type_id = $2
        LIMIT 1
     ) AS exists`,
    [tenantId, entityType.id]
  );

  if (refRows[0]?.exists) {
    return {
      code: "ENTITY_TYPE_IN_USE",
      message: `Entity type '${slug}' cannot be retired because it has existing records. ` +
        `Archive or delete all entity_records for this type before retiring it.`,
    };
  }

  // 3. Soft-delete: flip is_active flag, do NOT hard-delete.
  await client.query(
    `UPDATE entity_types
        SET is_active  = FALSE,
            updated_at = now()
      WHERE tenant_id = $1
        AND slug      = $2`,
    [tenantId, slug]
  );

  await writeAuditLog(client, {
    tenantId,
    actorId: actorUserId,
    action: "entity_type.retired",
    entityType: "entity_type",
    entityId: entityType.id,
    oldState: entityType as unknown as Record<string, unknown>,
    newState: { ...entityType, is_active: false } as unknown as Record<string, unknown>,
  });

  return undefined;
}

// ─── 6. listFieldDefinitions ──────────────────────────────────────────────────

/**
 * Lists field_definitions for an entity type, paginated.
 *
 * By default returns only active fields at the current schema version
 * (retired_at IS NULL AND schema_version <= current_version).
 *
 * Passing `version` overrides the schema_version upper-bound so callers can
 * reconstruct the field set that was active at a historical version.
 * Passing `includeRetired: true` includes retired fields at or below the
 * resolved version boundary (useful for schema history views).
 *
 * @param client         - PoolClient from withTenantContext.
 * @param tenantId       - The tenant UUID.
 * @param slug           - URL slug of the parent entity type.
 * @param options        - Query options.
 */
export async function listFieldDefinitions(
  client: PoolClient,
  tenantId: string,
  slug: string,
  options: {
    version?: number;
    includeRetired?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<PaginatedResult<FieldDefinitionRow> | NotFoundError> {
  // Resolve the entity type by slug first.
  const { rows: typeRows } = await client.query<{
    id: string;
    current_version: number;
  }>(
    `SELECT id, current_version
       FROM entity_types
      WHERE tenant_id = $1
        AND slug      = $2`,
    [tenantId, slug]
  );

  if (typeRows.length === 0) {
    return {
      code: "NOT_FOUND",
      message: `Entity type '${slug}' not found.`,
    };
  }

  const { id: entityTypeId, current_version } = typeRows[0];
  const versionBound = options.version ?? current_version;
  const includeRetired = options.includeRetired ?? false;
  const limit = Math.min(options.limit ?? 50, 200);
  const offset = options.offset ?? 0;

  const retiredFilter = includeRetired ? "" : "AND retired_at IS NULL";

  const { rows: countRows } = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
       FROM field_definitions
      WHERE tenant_id      = $1
        AND entity_type_id = $2
        AND schema_version <= $3
        ${retiredFilter}`,
    [tenantId, entityTypeId, versionBound]
  );
  const total = parseInt(countRows[0]?.total ?? "0", 10);

  const { rows } = await client.query<FieldDefinitionRow>(
    `SELECT tenant_id, entity_type_id, id, schema_version, field_key,
            display_name, field_type, is_required, is_indexed, sort_order,
            default_value, constraints, retired_at, created_at
       FROM field_definitions
      WHERE tenant_id      = $1
        AND entity_type_id = $2
        AND schema_version <= $3
        ${retiredFilter}
      ORDER BY sort_order ASC, schema_version ASC
      LIMIT $4
     OFFSET $5`,
    [tenantId, entityTypeId, versionBound, limit, offset]
  );

  return { items: rows, total, limit, offset };
}

// ─── 7. createFieldDefinition ─────────────────────────────────────────────────

/**
 * Appends a new field_definition to an entity type, bumping current_version.
 *
 * APPEND-AND-RETIRE INVARIANT: this function ALWAYS inserts a new row — it
 * never mutates an existing field_definitions row. This preserves the
 * historical validity guarantee (§5.4).
 *
 * Steps:
 *   1. Resolve the entity type (404 if not found).
 *   2. Validate the field payload.
 *   3. Confirm field_key uniqueness at the new version
 *      (UNIQUE constraint: tenant_id, entity_type_id, schema_version, field_key).
 *   4. Bump entity_types.current_version.
 *   5. Insert the field_definitions row at the new version.
 *   6. Audit.
 *
 * @param client      - PoolClient from withTenantContext.
 * @param tenantId    - The tenant UUID.
 * @param slug        - URL slug of the parent entity type.
 * @param input       - New field payload.
 * @param actorUserId - UUID of the session user.
 * @returns The created FieldDefinitionRow or a typed error.
 */
export async function createFieldDefinition(
  client: PoolClient,
  tenantId: string,
  slug: string,
  input: {
    field_key: string;
    display_name: string;
    field_type: string;
    is_required?: boolean;
    is_indexed?: boolean;
    sort_order?: number;
    default_value?: unknown;
    constraints?: Record<string, unknown>;
  },
  actorUserId: string
): Promise<FieldDefinitionRow | NotFoundError | ConflictError | ValidationError> {
  // ── Validation ────────────────────────────────────────────────────────────
  if (!input.field_key || !input.field_key.trim()) {
    return { code: "VALIDATION_ERROR", message: "Field 'field_key' is required." };
  }
  if (!/^[a-z0-9_]+$/.test(input.field_key)) {
    return {
      code: "VALIDATION_ERROR",
      message: "Field 'field_key' must be lowercase alphanumeric with underscores only.",
    };
  }
  if (!input.display_name || !input.display_name.trim()) {
    return { code: "VALIDATION_ERROR", message: "Field 'display_name' is required." };
  }
  if (!ALLOWED_FIELD_TYPES.has(input.field_type)) {
    return {
      code: "VALIDATION_ERROR",
      message: `Invalid 'field_type': '${input.field_type}'. Must be one of: ${[...ALLOWED_FIELD_TYPES].join(", ")}.`,
    };
  }

  // ── Resolve entity type and lock the row for update ───────────────────────
  const { rows: typeRows } = await client.query<{ id: string; current_version: number }>(
    `SELECT id, current_version
       FROM entity_types
      WHERE tenant_id = $1
        AND slug      = $2
      FOR UPDATE`,
    [tenantId, slug]
  );

  if (typeRows.length === 0) {
    return { code: "NOT_FOUND", message: `Entity type '${slug}' not found.` };
  }

  const { id: entityTypeId, current_version } = typeRows[0];
  const newVersion = current_version + 1;

  // ── Check field_key uniqueness within this entity type (any version) ──────
  // A field_key that already exists at any version (active or retired) should
  // be rejected — reusing a retired key is confusing and risks data shape
  // collisions in historical entity_records.
  const { rows: dupRows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM field_definitions
        WHERE tenant_id      = $1
          AND entity_type_id = $2
          AND field_key      = $3
        LIMIT 1
     ) AS exists`,
    [tenantId, entityTypeId, input.field_key]
  );

  if (dupRows[0]?.exists) {
    return {
      code: "CONFLICT",
      message: `A field with key '${input.field_key}' already exists for entity type '${slug}'.`,
    };
  }

  // ── Bump current_version ──────────────────────────────────────────────────
  await client.query(
    `UPDATE entity_types
        SET current_version = $1,
            updated_at      = now()
      WHERE tenant_id = $2
        AND id        = $3`,
    [newVersion, tenantId, entityTypeId]
  );

  // ── Insert the new field_definitions row ──────────────────────────────────
  const { rows: fieldRows } = await client.query<FieldDefinitionRow>(
    `INSERT INTO field_definitions
             (tenant_id, entity_type_id, schema_version, field_key, display_name,
              field_type, is_required, is_indexed, sort_order, default_value, constraints)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
   RETURNING tenant_id, entity_type_id, id, schema_version, field_key,
             display_name, field_type, is_required, is_indexed, sort_order,
             default_value, constraints, retired_at, created_at`,
    [
      tenantId,
      entityTypeId,
      newVersion,
      input.field_key.trim(),
      input.display_name.trim(),
      input.field_type,
      input.is_required ?? false,
      input.is_indexed ?? false,
      input.sort_order ?? 0,
      input.default_value !== undefined ? JSON.stringify(input.default_value) : null,
      JSON.stringify(input.constraints ?? {}),
    ]
  );

  const field = fieldRows[0];

  await writeAuditLog(client, {
    tenantId,
    actorId: actorUserId,
    action: "field_definition.created",
    entityType: "entity_type",
    entityId: entityTypeId,
    oldState: null,
    newState: { ...field, schema_version: newVersion } as unknown as Record<string, unknown>,
    context: { entity_type_slug: slug, new_schema_version: newVersion },
  });

  return field;
}

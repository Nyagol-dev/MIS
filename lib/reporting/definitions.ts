import { withTenantContext } from '@/lib/db/withTenant';
import { writeAuditLog } from '@/lib/db/audit';
import { getEffectivePermissions, canOnEntityType, ForbiddenError } from '@/lib/auth/permissions';
import type { SessionPayload } from '@/lib/auth/session';
import { validateReportFieldKeys } from './field-resolver';
import type { ReportDefinitionRow, ReportTemplateType } from './types';

export class ValidationError extends Error {
  public readonly code = 'VALIDATION_ERROR' as const;
  constructor(public invalidKeys: string[]) {
    super(`Invalid field keys in parameters: ${invalidKeys.join(', ')}`);
    this.name = 'ValidationError';
  }
}

/**
 * Extracts any potential field key references from report parameters.
 */
function extractFieldKeys(parameters: Record<string, unknown>): string[] {
  const keys: string[] = [];

  if (typeof parameters.group_field === 'string') keys.push(parameters.group_field);
  if (typeof parameters.sum_field === 'string') keys.push(parameters.sum_field);
  if (typeof parameters.date_field === 'string') keys.push(parameters.date_field);
  if (typeof parameters.target_field === 'string') keys.push(parameters.target_field);
  if (typeof parameters.sort_field === 'string') keys.push(parameters.sort_field);

  if (Array.isArray(parameters.fields)) {
    for (const f of parameters.fields) {
      if (typeof f === 'string') keys.push(f);
    }
  }

  // Also check filters if present
  if (Array.isArray(parameters.filters)) {
    for (const filter of parameters.filters) {
      if (filter && typeof filter === 'object' && typeof (filter as any).field_key === 'string') {
        keys.push((filter as any).field_key);
      }
    }
  }

  return keys;
}

export async function createReportDefinition(
  session: SessionPayload,
  params: {
    name: string;
    description?: string;
    entity_type_id: string;
    template_type: ReportTemplateType;
    parameters: Record<string, unknown>;
  }
): Promise<ReportDefinitionRow> {
  const perms = await getEffectivePermissions(session.tenantId, session.userId);
  if (!canOnEntityType(perms, params.entity_type_id, 'read')) {
    throw new ForbiddenError(
      `Permission denied: action 'read' on entity type '${params.entity_type_id}' is not granted.`
    );
  }

  return withTenantContext(session.tenantId, async (client) => {
    // 1. Confirm entity_type_id exists and is_active = TRUE
    const { rows: entityTypeRows } = await client.query(
      `SELECT id FROM entity_types WHERE id = $1 AND is_active = TRUE`,
      [params.entity_type_id]
    );
    if (entityTypeRows.length === 0) {
      throw new Error(`Entity type '${params.entity_type_id}' not found or is inactive.`);
    }

    // 2. Extract and validate field keys
    const fieldKeys = extractFieldKeys(params.parameters);
    if (fieldKeys.length > 0) {
      const { invalid } = await validateReportFieldKeys(client, params.entity_type_id, fieldKeys);
      if (invalid.length > 0) {
        throw new ValidationError(invalid);
      }
    }

    // 3. Insert report definition
    const { rows } = await client.query<ReportDefinitionRow>(
      `
      INSERT INTO report_definitions (
        tenant_id,
        name,
        description,
        entity_type_id,
        template_type,
        parameters,
        is_active,
        created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, TRUE, $7
      ) RETURNING *
      `,
      [
        session.tenantId,
        params.name,
        params.description ?? '',
        params.entity_type_id,
        params.template_type,
        JSON.stringify(params.parameters),
        session.userId,
      ]
    );

    const created = rows[0];

    // 4. Audit
    await writeAuditLog(client, {
      tenantId: session.tenantId,
      actorId: session.userId,
      action: 'report_definition.created',
      entityType: 'report_definition',
      entityId: created.id,
      oldState: null,
      newState: created as unknown as Record<string, unknown>,
    });

    return created;
  });
}

export async function updateReportDefinition(
  session: SessionPayload,
  definitionId: string,
  params: Partial<Pick<ReportDefinitionRow, 'name' | 'description' | 'parameters' | 'is_active'>>
): Promise<ReportDefinitionRow> {
  const perms = await getEffectivePermissions(session.tenantId, session.userId);

  return withTenantContext(session.tenantId, async (client) => {
    // 1. Load existing row
    const { rows: existingRows } = await client.query<ReportDefinitionRow>(
      `SELECT * FROM report_definitions WHERE tenant_id = $1 AND id = $2`,
      [session.tenantId, definitionId]
    );

    if (existingRows.length === 0) {
      const error = new Error(`Report definition '${definitionId}' not found.`);
      (error as any).status = 404;
      throw error;
    }
    const existing = existingRows[0];

    // Check permission on the associated entity type
    if (!canOnEntityType(perms, existing.entity_type_id, 'read')) {
      throw new ForbiddenError(
        `Permission denied: action 'read' on entity type '${existing.entity_type_id}' is not granted.`
      );
    }

    // 2. Re-validate parameters if they are being updated
    if (params.parameters) {
      const fieldKeys = extractFieldKeys(params.parameters);
      if (fieldKeys.length > 0) {
        const { invalid } = await validateReportFieldKeys(client, existing.entity_type_id, fieldKeys);
        if (invalid.length > 0) {
          throw new ValidationError(invalid);
        }
      }
    }

    // 3. Update
    const mergedParams = params.parameters !== undefined ? params.parameters : existing.parameters;
    
    const { rows: updatedRows } = await client.query<ReportDefinitionRow>(
      `
      UPDATE report_definitions
         SET name = COALESCE($1, name),
             description = COALESCE($2, description),
             parameters = $3,
             is_active = COALESCE($4, is_active),
             updated_at = now()
       WHERE tenant_id = $5
         AND id = $6
       RETURNING *
      `,
      [
        params.name ?? null,
        params.description ?? null,
        JSON.stringify(mergedParams),
        params.is_active ?? null,
        session.tenantId,
        definitionId,
      ]
    );

    const updated = updatedRows[0];

    // 4. Audit
    await writeAuditLog(client, {
      tenantId: session.tenantId,
      actorId: session.userId,
      action: 'report_definition.updated',
      entityType: 'report_definition',
      entityId: updated.id,
      oldState: existing as unknown as Record<string, unknown>,
      newState: updated as unknown as Record<string, unknown>,
    });

    return updated;
  });
}

export async function deleteReportDefinition(
  session: SessionPayload,
  definitionId: string
): Promise<void> {
  const perms = await getEffectivePermissions(session.tenantId, session.userId);

  return withTenantContext(session.tenantId, async (client) => {
    // 1. Load existing row
    const { rows: existingRows } = await client.query<ReportDefinitionRow>(
      `SELECT * FROM report_definitions WHERE tenant_id = $1 AND id = $2`,
      [session.tenantId, definitionId]
    );

    if (existingRows.length === 0) {
      const error = new Error(`Report definition '${definitionId}' not found.`);
      (error as any).status = 404;
      throw error;
    }
    const existing = existingRows[0];

    // Check permission
    if (!canOnEntityType(perms, existing.entity_type_id, 'read')) {
      throw new ForbiddenError(
        `Permission denied: action 'read' on entity type '${existing.entity_type_id}' is not granted.`
      );
    }

    // 2. Hard DELETE
    await client.query(
      `DELETE FROM report_definitions WHERE tenant_id = $1 AND id = $2`,
      [session.tenantId, definitionId]
    );

    // 3. Audit
    await writeAuditLog(client, {
      tenantId: session.tenantId,
      actorId: session.userId,
      action: 'report_definition.deleted',
      entityType: 'report_definition',
      entityId: definitionId,
      oldState: existing as unknown as Record<string, unknown>,
      newState: null,
    });
  });
}

export async function getReportDefinition(
  session: SessionPayload,
  definitionId: string
): Promise<ReportDefinitionRow | null> {
  const perms = await getEffectivePermissions(session.tenantId, session.userId);

  return withTenantContext(session.tenantId, async (client) => {
    const { rows } = await client.query<ReportDefinitionRow>(
      `SELECT * FROM report_definitions WHERE tenant_id = $1 AND id = $2`,
      [session.tenantId, definitionId]
    );

    if (rows.length === 0) {
      return null;
    }

    const definition = rows[0];

    // Permission check
    if (!canOnEntityType(perms, definition.entity_type_id, 'read')) {
      throw new ForbiddenError(
        `Permission denied: action 'read' on entity type '${definition.entity_type_id}' is not granted.`
      );
    }

    return definition;
  });
}

export async function listReportDefinitions(
  session: SessionPayload,
  entityTypeId?: string
): Promise<ReportDefinitionRow[]> {
  const perms = await getEffectivePermissions(session.tenantId, session.userId);

  return withTenantContext(session.tenantId, async (client) => {
    let query = \`SELECT * FROM report_definitions WHERE tenant_id = $1 AND is_active = TRUE\`;
    const params: unknown[] = [session.tenantId];

    if (entityTypeId) {
      query += \` AND entity_type_id = $2\`;
      params.push(entityTypeId);
    }

    query += \` ORDER BY created_at DESC\`;

    const { rows } = await client.query<ReportDefinitionRow>(query, params);

    // Filter by permissions: only return definitions whose entity_type_id the session can read
    return rows.filter((row) => canOnEntityType(perms, row.entity_type_id, 'read'));
  });
}

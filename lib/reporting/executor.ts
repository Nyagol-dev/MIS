import { randomUUID } from 'crypto';
import { withTenantContext } from '@/lib/db/withTenant';
import { getEffectivePermissions, canOnEntityType, ForbiddenError } from '@/lib/auth/permissions';
import type { SessionPayload } from '@/lib/auth/session';
import type {
  ReportResult,
  ReportTemplateType,
  AdHocReportParams,
  ReportDefinitionRow,
} from './types';
import { buildReportQuery } from './query-builder';
import { readCache, writeCache } from './cache';

const TEMPLATE_STRATEGY_MAP: Record<ReportTemplateType, 'live' | 'cached'> = {
  count_by_field: 'live',
  record_list: 'live',
  sum_by_field: 'cached',
  timeline: 'cached',
  field_distribution: 'cached',
};

const DEFAULT_CACHE_TTL_SECONDS = 300; // 5 minutes

export async function executeReport(
  session: SessionPayload,
  reportDefinitionId: string
): Promise<ReportResult> {
  return withTenantContext(session.tenantId, async (client) => {
    // 1. Load report_definitions row.
    const { rows: defRows } = await client.query<ReportDefinitionRow>(
      `SELECT * FROM report_definitions WHERE tenant_id = $1 AND id = $2`,
      [session.tenantId, reportDefinitionId]
    );

    if (defRows.length === 0) {
      const error = new Error(`Report definition '${reportDefinitionId}' not found.`);
      (error as any).status = 404;
      throw error;
    }
    const definition = defRows[0];

    // 2. Load permissions
    const perms = await getEffectivePermissions(session.tenantId, session.userId);
    if (!canOnEntityType(perms, definition.entity_type_id, 'read')) {
      throw new ForbiddenError(
        `Permission denied: action 'read' on entity type '${definition.entity_type_id}' is not granted.`
      );
    }

    // 3. Determine strategy
    const strategy = TEMPLATE_STRATEGY_MAP[definition.template_type];

    // 4. Cached strategy handling
    if (strategy === 'cached') {
      const cachedRow = await readCache(client, reportDefinitionId);
      if (cachedRow) {
        return {
          data: cachedRow.result as Record<string, unknown>[],
          metadata: {
            report_definition_id: reportDefinitionId,
            template_type: definition.template_type,
            entity_type_id: definition.entity_type_id,
            computed_at: cachedRow.computed_at.toISOString(),
            from_cache: true,
            row_count: cachedRow.row_count,
            is_stale: false,
          },
        };
      }
    }

    // 5. Build query
    const query = await buildReportQuery(client, definition);

    // 6. Execute
    const { rows } = await client.query(query.sql, query.params);

    // 7. Shape rows
    const data = rows as Record<string, unknown>[];

    // 8. Write to cache if strategy is 'cached'
    if (strategy === 'cached') {
      await writeCache(
        client,
        reportDefinitionId,
        data,
        data.length,
        DEFAULT_CACHE_TTL_SECONDS,
        session.userId
      );
    }

    // 9. Return ReportResult
    return {
      data,
      metadata: {
        report_definition_id: reportDefinitionId,
        template_type: definition.template_type,
        entity_type_id: definition.entity_type_id,
        computed_at: new Date().toISOString(),
        from_cache: false,
        row_count: data.length,
        is_stale: false,
      },
    };
  });
}

export async function executeAdHocReport(
  session: SessionPayload,
  params: AdHocReportParams
): Promise<ReportResult> {
  return withTenantContext(session.tenantId, async (client) => {
    // 1. Validate template_type
    if (!(params.template_type in TEMPLATE_STRATEGY_MAP)) {
      throw new Error(`Unknown report template type: ${params.template_type}`);
    }

    // 2. Permission check
    const perms = await getEffectivePermissions(session.tenantId, session.userId);
    if (!canOnEntityType(perms, params.entity_type_id, 'read')) {
      throw new ForbiddenError(
        `Permission denied: action 'read' on entity type '${params.entity_type_id}' is not granted.`
      );
    }

    // 3. Construct synthetic definition
    const syntheticId = randomUUID();
    const syntheticDefinition: ReportDefinitionRow = {
      tenant_id: session.tenantId,
      id: syntheticId,
      name: 'Ad-Hoc Report',
      description: '',
      entity_type_id: params.entity_type_id,
      template_type: params.template_type,
      parameters: params.parameters,
      is_active: true,
      created_by: session.userId,
      created_at: new Date(),
      updated_at: new Date(),
    };

    // 4. Build query
    const query = await buildReportQuery(client, syntheticDefinition);

    // 5. Execute
    const { rows } = await client.query(query.sql, query.params);
    const data = rows as Record<string, unknown>[];

    // 6. Do NOT write to cache (ad-hoc reports are never cached)

    // 7. Return ReportResult
    return {
      data,
      metadata: {
        report_definition_id: syntheticId,
        template_type: params.template_type,
        entity_type_id: params.entity_type_id,
        computed_at: new Date().toISOString(),
        from_cache: false,
        row_count: data.length,
        is_stale: false,
      },
    };
  });
}

export async function refreshReport(
  session: SessionPayload,
  reportDefinitionId: string
): Promise<ReportResult> {
  return withTenantContext(session.tenantId, async (client) => {
    // 1. Load definition + permission check
    const { rows: defRows } = await client.query<ReportDefinitionRow>(
      `SELECT * FROM report_definitions WHERE tenant_id = $1 AND id = $2`,
      [session.tenantId, reportDefinitionId]
    );

    if (defRows.length === 0) {
      const error = new Error(`Report definition '${reportDefinitionId}' not found.`);
      (error as any).status = 404;
      throw error;
    }
    const definition = defRows[0];

    const perms = await getEffectivePermissions(session.tenantId, session.userId);
    if (!canOnEntityType(perms, definition.entity_type_id, 'read')) {
      throw new ForbiddenError(
        `Permission denied: action 'read' on entity type '${definition.entity_type_id}' is not granted.`
      );
    }

    // 2. Check strategy
    const strategy = TEMPLATE_STRATEGY_MAP[definition.template_type];
    if (strategy === 'live') {
      throw new Error(`Report '${reportDefinitionId}' is a live report and cannot be manually refreshed.`);
    }

    // 3. Build query and execute
    const query = await buildReportQuery(client, definition);
    const { rows } = await client.query(query.sql, query.params);
    const data = rows as Record<string, unknown>[];

    // 4. writeCache (UPSERT)
    await writeCache(
      client,
      reportDefinitionId,
      data,
      data.length,
      DEFAULT_CACHE_TTL_SECONDS,
      session.userId
    );

    // 5. Return fresh ReportResult
    return {
      data,
      metadata: {
        report_definition_id: reportDefinitionId,
        template_type: definition.template_type,
        entity_type_id: definition.entity_type_id,
        computed_at: new Date().toISOString(),
        from_cache: false,
        row_count: data.length,
        is_stale: false,
      },
    };
  });
}

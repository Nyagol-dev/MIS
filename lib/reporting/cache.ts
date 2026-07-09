import type { PoolClient } from 'pg';
import type { ReportCacheRow } from './types';

export async function readCache(
  client: PoolClient,
  reportDefinitionId: string
): Promise<ReportCacheRow | null> {
  const { rows } = await client.query<ReportCacheRow>(
    `
    SELECT *
      FROM report_cache
     WHERE report_definition_id = $1
       AND is_stale = FALSE
       AND computed_at + (ttl_seconds * interval '1 second') > now()
    `,
    [reportDefinitionId]
  );
  return rows[0] ?? null;
}

export async function writeCache(
  client: PoolClient,
  reportDefinitionId: string,
  result: Record<string, unknown>[],
  rowCount: number,
  ttlSeconds: number,
  computedBy: string | null
): Promise<void> {
  await client.query(
    `
    INSERT INTO report_cache (
      tenant_id,
      report_definition_id,
      result,
      row_count,
      ttl_seconds,
      computed_at,
      is_stale,
      computed_by
    ) VALUES (
      current_tenant_id(),
      $1,
      $2,
      $3,
      $4,
      now(),
      FALSE,
      $5
    )
    ON CONFLICT (tenant_id, report_definition_id) DO UPDATE SET
      result = EXCLUDED.result,
      row_count = EXCLUDED.row_count,
      computed_at = EXCLUDED.computed_at,
      ttl_seconds = EXCLUDED.ttl_seconds,
      is_stale = FALSE,
      computed_by = EXCLUDED.computed_by
    `,
    [
      reportDefinitionId,
      JSON.stringify(result),
      rowCount,
      ttlSeconds,
      computedBy
    ]
  );
}

export async function invalidateCacheForEntityType(
  client: PoolClient,
  entityTypeId: string
): Promise<{ rowsMarked: number }> {
  const { rowCount } = await client.query(
    `
    UPDATE report_cache
       SET is_stale = TRUE
     WHERE tenant_id = current_tenant_id()
       AND report_definition_id IN (
         SELECT id
           FROM report_definitions
          WHERE tenant_id = current_tenant_id()
            AND entity_type_id = $1
       )
    RETURNING id
    `,
    [entityTypeId]
  );
  return { rowsMarked: rowCount ?? 0 };
}

export async function deleteCacheForDefinition(
  client: PoolClient,
  reportDefinitionId: string
): Promise<void> {
  await client.query(
    `
    DELETE FROM report_cache
     WHERE tenant_id = current_tenant_id()
       AND report_definition_id = $1
    `,
    [reportDefinitionId]
  );
}

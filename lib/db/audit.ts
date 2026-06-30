import type { PoolClient } from 'pg';

export interface AuditLogParams {
  tenantId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  oldState: Record<string, unknown> | null;
  newState: Record<string, unknown> | null;
  ipAddress?: string;
  context?: Record<string, unknown>;
}

// Takes a PoolClient (instead of a Pool) to ensure the audit row is written atomically within the caller's active transaction.
export async function writeAuditLog(
  client: PoolClient,
  params: AuditLogParams
): Promise<void> {
  const query = `
    INSERT INTO audit_log (
      tenant_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      old_state,
      new_state,
      ip_address,
      context
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `;

  const values = [
    params.tenantId,
    params.actorId,
    params.action,
    params.entityType,
    params.entityId,
    params.oldState ? JSON.stringify(params.oldState) : null,
    params.newState ? JSON.stringify(params.newState) : null,
    params.ipAddress || null,
    params.context ? JSON.stringify(params.context) : '{}'
  ];

  await client.query(query, values);
}

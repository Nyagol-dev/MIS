/**
 * lib/events/actions/field-update.ts
 *
 * Executor for action_type = 'field_update'.
 *
 * TRANSACTION OWNERSHIP
 * ─────────────────────────────────────────────────────────────────────────────
 * The `client` parameter is already inside an open transaction started by
 * withTenantContext in the processor (lib/events/processor.ts).
 * Do NOT call withTenantContext here — that would attempt to BEGIN inside an
 * already-open transaction. Use `client` directly for every query.
 *
 * Do NOT call createEntityRecord or updateEntityRecord from
 * lib/entities/records.ts — those helpers open their own transactions and
 * would nest inside the processor's transaction, causing a runtime error.
 *
 * EXPECTED action_config SHAPE
 * ─────────────────────────────────────────────────────────────────────────────
 * {
 *   "target_field": "status",   // JSONB key inside entity_records.data
 *   "value":        "approved"  // New scalar or JSON value
 * }
 */

import type { PoolClient } from 'pg';
import type { ActionExecutor, ActionResult, EventSubscriptionRow, MutationEvent } from '../types';
import { writeAuditLog } from '../../db/audit';

export const executeFieldUpdate: ActionExecutor = async (
  subscription: EventSubscriptionRow,
  event: MutationEvent,
  logId: string,
  client: PoolClient,
): Promise<ActionResult> => {
  const config = subscription.action_config as {
    target_field: string;
    value: unknown;
  };

  if (!config.target_field) {
    return {
      success: false,
      errorMessage: 'field_update action_config is missing required key "target_field".',
    };
  }

  // ── 1. Confirm the entity_records row exists within this tenant ──────────
  const selectResult = await client.query<{ id: string; data: Record<string, unknown> }>(
    `SELECT id, data
       FROM entity_records
      WHERE tenant_id = $1
        AND id        = $2`,
    [event.tenantId, event.entityId],
  );

  if (selectResult.rowCount === 0) {
    return {
      success: false,
      errorMessage: `entity_records row not found: tenant_id=${event.tenantId}, id=${event.entityId}`,
    };
  }

  const oldData = selectResult.rows[0].data;

  // ── 2. Apply the field update using jsonb_set ────────────────────────────
  //
  // jsonb_set(target, path, new_value, create_missing)
  //   • path is a text[] literal, e.g. '{status}'
  //   • new_value must be a valid JSON expression; we cast the $3 bind
  //     parameter with ::jsonb so PostgreSQL handles all type coercion.
  //   • create_missing = TRUE means the key is upserted even if absent.
  //
  // Using a parameterised query prevents any injection through target_field
  // or value, but note that target_field is used to build a text[] literal —
  // we validate that it contains no special characters before interpolation.
  const fieldKey = config.target_field;
  if (!/^[a-zA-Z0-9_]+$/.test(fieldKey)) {
    return {
      success: false,
      errorMessage: `action_config.target_field "${fieldKey}" contains invalid characters. Only alphanumeric and underscores are permitted.`,
    };
  }

  // Serialize the value to a JSON string so ::jsonb cast works for any type.
  const jsonValue = JSON.stringify(config.value);

  const updateResult = await client.query<{ data: Record<string, unknown> }>(
    // The path literal `'{<fieldKey>}'` is safe because fieldKey passed the
    // /^[a-zA-Z0-9_]+$/ guard above — no injection vector.
    `UPDATE entity_records
        SET data       = jsonb_set(data, $1::text[], $2::jsonb, TRUE),
            updated_at = now()
      WHERE tenant_id = $3
        AND id        = $4
      RETURNING data`,
    [`{${fieldKey}}`, jsonValue, event.tenantId, event.entityId],
  );

  if (updateResult.rowCount === 0) {
    return {
      success: false,
      errorMessage: 'UPDATE on entity_records matched zero rows — concurrent delete?',
    };
  }

  const newData = updateResult.rows[0].data;

  // ── 3. Write audit log (actor is null — system-initiated action) ─────────
  await writeAuditLog(client, {
    tenantId:   event.tenantId,
    actorId:    null,
    action:     'entity_record.field_update_automated',
    entityType: 'entity_records',
    entityId:   event.entityId,
    oldState:   oldData,
    newState:   newData,
    context:    { subscription_id: subscription.id },
  });

  return {
    success: true,
    responsePayload: { updatedField: fieldKey, newValue: config.value },
  };
};

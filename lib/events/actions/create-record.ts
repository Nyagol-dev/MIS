/**
 * lib/events/actions/create-record.ts
 *
 * Executor for action_type = 'create_record'.
 *
 * TRANSACTION OWNERSHIP
 * ─────────────────────────────────────────────────────────────────────────────
 * The `client` parameter is already inside an open transaction started by
 * withTenantContext in the processor (lib/events/processor.ts).
 * Do NOT call withTenantContext here. Do NOT call createEntityRecord from
 * lib/entities/records.ts — that helper opens its own transaction and would
 * nest inside the processor's transaction, causing a runtime error.
 * Write the INSERT directly on the provided client.
 *
 * EXPECTED action_config SHAPE
 * ─────────────────────────────────────────────────────────────────────────────
 * {
 *   "entity_type_slug": "audit_entry",     // slug in entity_types table
 *   "template":         { "note": "{{status}} changed" }  // mustache-style placeholders
 * }
 *
 * Placeholders inside `template` are resolved against event.newData using
 * resolveTemplatePlaceholders from lib/events/utils.ts. Placeholders that
 * do not match a key in newData are left as-is (no error thrown).
 */

import type { PoolClient } from 'pg';
import type { ActionExecutor, ActionResult, EventSubscriptionRow, MutationEvent } from '../types';
import { resolveTemplatePlaceholders } from '../utils';
import { writeAuditLog } from '../../db/audit';

export const executeCreateRecord: ActionExecutor = async (
  subscription: EventSubscriptionRow,
  event: MutationEvent,
  logId: string,
  client: PoolClient,
): Promise<ActionResult> => {
  const config = subscription.action_config as {
    entity_type_slug: string;
    template: Record<string, unknown>;
  };

  if (!config.entity_type_slug) {
    return {
      success: false,
      errorMessage: 'create_record action_config is missing required key "entity_type_slug".',
    };
  }

  if (!config.template || typeof config.template !== 'object') {
    return {
      success: false,
      errorMessage: 'create_record action_config is missing or has invalid "template" (must be an object).',
    };
  }

  // ── 1. Resolve entity_type_id from slug ──────────────────────────────────
  const etResult = await client.query<{ id: string; current_version: number }>(
    `SELECT id, current_version
       FROM entity_types
      WHERE tenant_id = $1
        AND slug      = $2`,
    [event.tenantId, config.entity_type_slug],
  );

  if (etResult.rowCount === 0) {
    return {
      success: false,
      errorMessage: `entity_type with slug "${config.entity_type_slug}" not found for tenant ${event.tenantId}.`,
    };
  }

  const { id: entityTypeId, current_version: schemaVersion } = etResult.rows[0];

  // ── 2. Resolve template placeholders against the triggering event data ───
  const resolvedData = resolveTemplatePlaceholders(
    config.template,
    event.newData ?? {},
  );

  // ── 3. INSERT directly into entity_records ───────────────────────────────
  //
  // actor_id of the triggering event is NOT carried through to created_by here
  // because this is a system-generated record. created_by and updated_by are
  // left NULL to signal system authorship, consistent with writeAuditLog
  // receiving actorId: null below.
  const insertResult = await client.query<{ id: string }>(
    `INSERT INTO entity_records (
        tenant_id,
        entity_type_id,
        schema_version,
        data,
        created_by,
        updated_by
     ) VALUES ($1, $2, $3, $4::jsonb, NULL, NULL)
     RETURNING id`,
    [
      event.tenantId,
      entityTypeId,
      schemaVersion,
      JSON.stringify(resolvedData),
    ],
  );

  const newRecordId = insertResult.rows[0].id;

  // ── 4. Write audit log (actor is null — system-initiated action) ─────────
  await writeAuditLog(client, {
    tenantId:   event.tenantId,
    actorId:    null,
    action:     'entity_record.created_automated',
    entityType: 'entity_records',
    entityId:   newRecordId,
    oldState:   null,
    newState:   resolvedData,
    context:    { subscription_id: subscription.id },
  });

  return {
    success: true,
    responsePayload: {
      createdRecordId:  newRecordId,
      entityTypeId,
      entityTypeSlug:   config.entity_type_slug,
    },
  };
};

import { PoolClient } from 'pg';

export interface ChangedField {
  field: string;
  from: unknown;
  to: unknown;
}

export interface MutationEvent {
  tenantId: string;
  sourceType: 'core_entity' | 'custom_entity';
  sourceTarget: string;
  event: 'created' | 'updated' | 'deleted' | 'status_changed' | 'field_changed';
  entityTypeId: string;
  entityId: string;
  actorId: string | null;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  changedFields: ChangedField[];
  schemaVersion: number;
  timestamp: string;
}

export interface EventSubscriptionRow {
  tenant_id: string;
  id: string;
  name: string;
  description: string;
  source_type: 'core_entity' | 'custom_entity';
  source_target: string;
  event: 'created' | 'updated' | 'deleted' | 'status_changed' | 'field_changed';
  event_filter: Record<string, unknown>;
  action_type: 'webhook' | 'internal_notification' | 'field_update' | 'create_record' | 'send_email_template' | 'invalidate_report_cache';
  action_config: Record<string, unknown>;
  is_active: boolean;
  priority: number;
  max_retries: number;
  created_at: Date;
  updated_at: Date;
}

export interface EventExecutionLogRow {
  id: string;
  tenant_id: string;
  subscription_id: string;
  trigger_event: string;
  trigger_entity_type: string;
  trigger_entity_id: string | null;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'retrying';
  attempt: number;
  request_payload: Record<string, unknown> | null;
  response_payload: Record<string, unknown> | null;
  error_message: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

export interface ActionResult {
  success: boolean;
  responsePayload?: unknown;
  errorMessage?: string;
}

export type ActionExecutor = (
  subscription: EventSubscriptionRow,
  event: MutationEvent,
  logId: string,
  client: PoolClient
) => Promise<ActionResult>;

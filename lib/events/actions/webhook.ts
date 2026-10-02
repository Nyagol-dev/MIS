import { PoolClient } from 'pg';
import { ActionExecutor, ActionResult, EventSubscriptionRow, MutationEvent } from '../types';
import { writeAuditLog } from '@/lib/db/audit';

export const executeWebhook: ActionExecutor = async (
  subscription: EventSubscriptionRow,
  event: MutationEvent,
  logId: string,
  client: PoolClient
): Promise<ActionResult> => {
  // User-configured destinations create an SSRF channel and receive arbitrary
  // mutation payloads that may contain PHI. Keep queued subscriptions
  // terminally handled while disabling all outbound delivery until a reviewed
  // allow-list, payload contract and approval model are implemented.
  await writeAuditLog(client, {
    tenantId: subscription.tenant_id,
    actorId: event.actorId,
    action: 'integration.webhook_blocked',
    entityType: 'event_subscription',
    entityId: subscription.id,
    oldState: null,
    newState: null,
    context: {
      executionId: logId,
      sourceType: event.sourceType,
      eventType: event.event,
      reason: 'outbound_webhooks_disabled_pending_security_review',
    },
  });

  return {
    success: true,
    responsePayload: { skipped: true, reason: 'Outbound webhooks are disabled.' },
  };
};

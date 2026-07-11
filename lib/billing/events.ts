import { PoolClient } from 'pg';
import { EventSubscriptionRow } from '@/lib/events/types';

export interface BillingEvent {
  tenantId: string;
  eventType: string;          // 'invoice.paid', 'subscription.canceled', etc.
  resourceType: string;       // 'invoice', 'subscription', 'payment_request'
  resourceId: string;         // the billing entity's UUID
  actorId: string | null;     // NULL for webhook-originated events (no human actor)
  data: Record<string, unknown>;  // event-specific payload (amounts, statuses, etc.)
  timestamp: string;
}

/**
 * Note: matchesEventFilter from lib/events/filter.ts cannot be reused here
 * because its signature strictly expects a MutationEvent and accesses
 * event.changedFields, which a BillingEvent lacks. Passing a BillingEvent
 * would cause a TypeError. We provide an equivalent filter logic here that
 * gracefully handles arbitrary payload properties for billing events.
 */
function matchesBillingEventFilter(
  filter: Record<string, unknown>,
  event: BillingEvent
): boolean {
  if (!filter || Object.keys(filter).length === 0) {
    return true;
  }

  // Example simple payload matching logic: { field: "providerSlug", value: "stripe" }
  if ('field' in filter && typeof filter.field === 'string') {
    const filterField = filter.field;
    if (!event.data || typeof event.data !== 'object') {
      return false;
    }
    const actualValue = event.data[filterField];

    if (actualValue === undefined) {
      return false;
    }

    if ('value' in filter) {
      return JSON.stringify(actualValue) === JSON.stringify(filter.value);
    }

    return true;
  }

  return true;
}

export async function dispatchBillingEvent(client: PoolClient, event: BillingEvent): Promise<void> {
  // Query matching subscriptions with source_type = 'billing'
  const subsResult = await client.query<EventSubscriptionRow>(
    `SELECT *
       FROM event_subscriptions
      WHERE tenant_id    = $1
        AND source_type  = 'billing'
        AND source_target = $2
        AND event        = $3
        AND is_active    = TRUE
      ORDER BY priority ASC`,
    [event.tenantId, event.resourceType, event.eventType]
  );

  // For each passing subscription, insert one row into event_execution_log
  for (const sub of subsResult.rows) {
    if (matchesBillingEventFilter(sub.event_filter, event)) {
      await client.query(
        `INSERT INTO event_execution_log (
          tenant_id,
          subscription_id,
          trigger_event,
          trigger_entity_type,
          trigger_entity_id,
          status,
          attempt,
          request_payload
        ) VALUES ($1, $2, $3, $4, $5, 'pending', 1, $6::jsonb)`,
        [
          event.tenantId,
          sub.id,
          event.eventType,
          event.resourceType,
          event.resourceId,
          JSON.stringify(event),
        ]
      );
    }
  }
}

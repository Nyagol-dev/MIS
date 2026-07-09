import { PoolClient } from 'pg';
import { MutationEvent, EventSubscriptionRow } from './types';
import { matchesEventFilter } from './filter';

export async function dispatchEntityEvent(client: PoolClient, event: MutationEvent): Promise<void> {
  // a. Resolve the entity_type slug
  const slugResult = await client.query(
    `SELECT slug FROM entity_types WHERE tenant_id = $1 AND id = $2`,
    [event.tenantId, event.entityTypeId]
  );

  if (slugResult.rowCount === 0) {
    return;
  }
  
  const slug = slugResult.rows[0].slug;

  // b. Query matching subscriptions using the exact SQL in blueprint §5
  const subsResult = await client.query<EventSubscriptionRow>(
    `SELECT *
       FROM event_subscriptions
      WHERE tenant_id    = $1
        AND source_type  = $2
        AND source_target = $3
        AND event        = $4
        AND is_active    = TRUE
      ORDER BY priority ASC`,
    [event.tenantId, event.sourceType, slug, event.event]
  );

  // c. For each subscription, call matchesEventFilter(subscription.event_filter, event) — skip if false.
  // d. For each passing subscription, INSERT one row into event_execution_log
  for (const sub of subsResult.rows) {
    if (matchesEventFilter(sub.event_filter, event)) {
      await client.query(
        `INSERT INTO event_execution_log (
          tenant_id,
          subscription_id,
          trigger_event,
          trigger_entity_type,
          trigger_entity_id,
          status,
          attempt
        ) VALUES ($1, $2, $3, $4, $5, 'pending', 1)`,
        [
          event.tenantId,
          sub.id,
          event.event,
          event.entityTypeId,
          event.entityId
        ]
      );
    }
  }
}

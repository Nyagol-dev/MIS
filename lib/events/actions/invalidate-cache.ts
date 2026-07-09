import type { PoolClient } from 'pg';
import type { ActionExecutor, EventSubscriptionRow, MutationEvent, ActionResult } from '../types';
import { invalidateCacheForEntityType } from '@/lib/reporting/cache';

export const executeInvalidateReportCache: ActionExecutor = async (
  subscription: EventSubscriptionRow,
  event: MutationEvent,
  logId: string,
  client: PoolClient
): Promise<ActionResult> => {
  // Extract entity_type_id from event.entityTypeId.
  const entityTypeId = event.entityTypeId;

  // Call invalidateCacheForEntityType
  const { rowsMarked } = await invalidateCacheForEntityType(client, entityTypeId);

  // TODO: Stub: marks cache stale but does not auto-recompute. A future round can add scheduled recomputation via the cron infrastructure.
  
  return {
    success: true,
    responsePayload: { rowsMarked },
  };
};

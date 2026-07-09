import { PoolClient } from 'pg';
import { ActionExecutor, ActionResult, EventSubscriptionRow, MutationEvent } from '../types';

export const executeInternalNotification: ActionExecutor = async (
  subscription: EventSubscriptionRow,
  event: MutationEvent,
  logId: string,
  client: PoolClient
): Promise<ActionResult> => {
  // TODO: No notification infrastructure — implement when notifications table and channel are added.
  console.log('Intent: Execute Internal Notification for subscription', subscription.id, 'event', event.event);
  return { success: true };
};

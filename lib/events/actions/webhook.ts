import { PoolClient } from 'pg';
import { ActionExecutor, ActionResult, EventSubscriptionRow, MutationEvent } from '../types';

export const executeWebhook: ActionExecutor = async (
  subscription: EventSubscriptionRow,
  event: MutationEvent,
  logId: string,
  client: PoolClient
): Promise<ActionResult> => {
  const config = subscription.action_config as Record<string, any>;
  const url = config.url;
  const method = config.method || 'POST';
  const headers = config.headers || {};

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      return {
        success: false,
        errorMessage: `HTTP Error: ${response.status} ${response.statusText}`
      };
    }

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
};

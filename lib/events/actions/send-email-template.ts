import { PoolClient } from 'pg';
import { ActionExecutor, ActionResult, EventSubscriptionRow, MutationEvent } from '../types';

export const executeSendEmailTemplate: ActionExecutor = async (
  subscription: EventSubscriptionRow,
  event: MutationEvent,
  logId: string,
  client: PoolClient
): Promise<ActionResult> => {
  const config = subscription.action_config as Record<string, any>;
  
  // TODO: No email provider configured — implement when EMAIL_* env vars and provider SDK are added.
  console.log(
    'Intent: Send Email Template. Template ID:', config.template_id, 
    'Recipient field:', config.recipient_field
  );
  
  return { success: true };
};

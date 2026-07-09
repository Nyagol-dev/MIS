/**
 * lib/events/actions/registry.ts
 *
 * Single registration point for all action executors.
 *
 * getActionExecutor(actionType) returns the ActionExecutor for the given
 * action_type value.  Throws a descriptive error for unknown types so
 * processor.ts surfaces a clear message rather than an opaque undefined-call.
 *
 * HOW TO ADD A NEW EXECUTOR
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Add the action_type value to the CHECK constraint in the schema (§6).
 * 2. Create lib/events/actions/<action-type>.ts exporting your executor.
 * 3. Import it here and add an entry to EXECUTOR_MAP below.
 * 4. Update the ActionExecutorRow.action_type union in lib/events/types.ts.
 */

import type { ActionExecutor } from '../types';

import { executeWebhook }              from './webhook';
import { executeInternalNotification } from './internal-notification';
import { executeFieldUpdate }          from './field-update';
import { executeCreateRecord }         from './create-record';
import { executeSendEmailTemplate }    from './send-email-template';
import { executeInvalidateReportCache } from './invalidate-cache';

// ── Registry map ─────────────────────────────────────────────────────────────

const EXECUTOR_MAP: Readonly<Record<string, ActionExecutor>> = {
  webhook:               executeWebhook,
  internal_notification: executeInternalNotification,
  field_update:          executeFieldUpdate,
  create_record:         executeCreateRecord,
  send_email_template:   executeSendEmailTemplate,
  invalidate_report_cache: executeInvalidateReportCache,
} as const;

/**
 * Returns the ActionExecutor for the given action_type string.
 *
 * @throws If actionType is not a known value from the CHECK constraint in the
 *         event_subscriptions schema.  This is a hard programming error —
 *         the database should never surface a row with an unknown action_type,
 *         but we guard defensively.
 */
export function getActionExecutor(actionType: string): ActionExecutor {
  const executor = EXECUTOR_MAP[actionType];

  if (!executor) {
    throw new Error(
      `[event-registry] Unknown action_type "${actionType}". ` +
      `Valid types: ${Object.keys(EXECUTOR_MAP).join(', ')}.`,
    );
  }

  return executor;
}

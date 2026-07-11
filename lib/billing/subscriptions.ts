/**
 * lib/billing/subscriptions.ts
 *
 * CRUD + state-machine layer for the `subscriptions` table — Task 8.5
 * (Round 8, Billing & Subscriptions).
 *
 * DESIGN CONTRACTS
 * ────────────────────────────────────────────────────────────────────────────
 * • All functions accept a PoolClient obtained externally via withTenantContext.
 *   They do NOT open their own connections or transactions. The caller owns the
 *   transaction lifecycle (BEGIN / COMMIT / ROLLBACK).
 *
 * • Errors for EXPECTED failure modes (e.g. subscription not found, invalid
 *   state transition) are returned as typed objects with a `code` property —
 *   never thrown as raw Errors.
 *
 *   ⚠ DELIBERATE DEVIATION FROM BLUEPRINT SKETCH:
 *   The Round 8 Q5 blueprint sketch shows `assertValidTransition` throwing an
 *   `InvalidStateTransitionError` class. This implementation instead returns a
 *   typed error object (code: 'INVALID_STATE_TRANSITION') from
 *   `transitionSubscriptionStatus`, consistent with the established convention
 *   used in every Round 5–7 module (roles.ts, users.ts, customers.ts,
 *   plans.ts). Throwing for an expected, recoverable failure would be an
 *   anomaly in this codebase's error-handling contract. The blueprint sketch
 *   is treated as a structural guide, not a literal implementation mandate,
 *   when it conflicts with codebase-wide patterns.
 *
 * • writeAuditLog is called on the SAME client, inside the SAME transaction,
 *   immediately after every mutation query — before the function returns.
 *
 * • Pagination follows the Task 7.2 contract:
 *   { items, total, limit, offset } — limit capped at 200, default 50.
 */

import type { PoolClient } from "pg";
import { writeAuditLog } from "@/lib/db/audit";

// ─── Row type ─────────────────────────────────────────────────────────────────

export interface SubscriptionRow {
  tenant_id: string;
  id: string;
  billing_customer_id: string;
  plan_id: string;
  status: "trialing" | "active" | "past_due" | "canceled";
  provider_slug: "stripe" | "mpesa";
  provider_subscription_id: string | null;
  current_period_start: Date;
  current_period_end: Date;
  trial_end: Date | null;
  canceled_at: Date | null;
  cancel_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

// ─── Params ───────────────────────────────────────────────────────────────────

export interface CreateSubscriptionParams {
  billingCustomerId: string;
  planId: string;
  providerSlug: "stripe" | "mpesa";
  /** Override the plan's default trial_days. Pass 0 to force immediate 'active'. */
  trialDays?: number;
}

// ─── Error types ──────────────────────────────────────────────────────────────

export interface NotFoundError {
  code: "NOT_FOUND";
  message: string;
}

export interface ValidationError {
  code: "VALIDATION_ERROR";
  message: string;
}

/**
 * Returned (never thrown) when a requested status transition is not permitted
 * by the VALID_TRANSITIONS state machine.
 *
 * ⚠ See file-level note: the blueprint sketch uses a thrown
 * InvalidStateTransitionError class; this codebase returns typed error objects
 * instead, for consistency with every other Round 5–7 data-layer function.
 */
export interface InvalidStateTransitionError {
  code: "INVALID_STATE_TRANSITION";
  message: string;
  fromStatus: string;
  toStatus: string;
}

// ─── Result union types ───────────────────────────────────────────────────────

export type SubscriptionResult = SubscriptionRow | NotFoundError;

export type TransitionResult =
  | SubscriptionRow
  | NotFoundError
  | InvalidStateTransitionError;

export type CancelResult = SubscriptionRow | NotFoundError | InvalidStateTransitionError;

// ─── State machine ────────────────────────────────────────────────────────────

/**
 * Valid status transitions for the subscription state machine.
 *
 * Allowed paths:
 *   trialing  → active, canceled
 *   active    → past_due, canceled
 *   past_due  → active, canceled
 *   canceled  → (terminal — no transitions out)
 *
 * The map keys are FROM-statuses; values are the set of valid TO-statuses.
 */
export const VALID_TRANSITIONS: ReadonlyMap<
  SubscriptionRow["status"],
  ReadonlySet<SubscriptionRow["status"]>
> = new Map([
  ["trialing", new Set<SubscriptionRow["status"]>(["active", "canceled"])],
  ["active",   new Set<SubscriptionRow["status"]>(["past_due", "canceled"])],
  ["past_due", new Set<SubscriptionRow["status"]>(["active", "canceled"])],
  ["canceled", new Set<SubscriptionRow["status"]>([])],        // terminal state
]);

/**
 * Asserts that the given status transition is permitted by the state machine.
 *
 * Returns true if valid, false if invalid. Callers decide how to surface the
 * invalidity (this file returns a typed error; it does NOT throw).
 *
 * Keeping this as a pure predicate (rather than a throwing guard) lets the
 * calling function own error construction and stay consistent with the
 * typed-return convention.
 */
export function assertValidTransition(
  fromStatus: SubscriptionRow["status"],
  toStatus: SubscriptionRow["status"]
): boolean {
  const allowed = VALID_TRANSITIONS.get(fromStatus);
  return allowed !== undefined && allowed.has(toStatus);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Returns a full SELECT column list (avoids SELECT *). */
const SUBSCRIPTION_COLUMNS = `
  tenant_id,
  id,
  billing_customer_id,
  plan_id,
  status,
  provider_slug,
  provider_subscription_id,
  current_period_start,
  current_period_end,
  trial_end,
  canceled_at,
  cancel_reason,
  metadata,
  created_at,
  updated_at
`.trim();

function toAuditSnapshot(row: SubscriptionRow): Record<string, unknown> {
  return { ...row };
}

async function fetchSubscriptionRow(
  client: PoolClient,
  tenantId: string,
  subscriptionId: string
): Promise<SubscriptionRow | undefined> {
  const { rows } = await client.query<SubscriptionRow>(
    `SELECT ${SUBSCRIPTION_COLUMNS}
       FROM subscriptions
      WHERE tenant_id = $1
        AND id        = $2`,
    [tenantId, subscriptionId]
  );
  return rows[0];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Creates a new subscription.
 *
 * Status logic:
 *   • If `trialDays` param > 0  → status = 'trialing', trial_end = now() + trialDays days.
 *   • If `trialDays` param = 0  → status = 'active', no trial window.
 *   • If `trialDays` param is omitted → look up the plan's default `trial_days`;
 *     apply the same 0 / >0 logic against that value.
 *
 * current_period_start is always now(); current_period_end is set to
 * now() + 30 days as a safe default (the billing renewal job is responsible
 * for advancing the period end on renewal events from the payment provider).
 *
 * @param client   - PoolClient from withTenantContext.
 * @param tenantId - The tenant UUID.
 * @param params   - { billingCustomerId, planId, providerSlug, trialDays? }
 * @returns The newly created SubscriptionRow, or NOT_FOUND if the plan is absent.
 */
export async function createSubscription(
  client: PoolClient,
  tenantId: string,
  params: CreateSubscriptionParams
): Promise<SubscriptionRow | NotFoundError> {
  const { billingCustomerId, planId, providerSlug, trialDays: trialDaysParam } = params;

  // Resolve effective trial days: explicit param takes precedence over plan default.
  let effectiveTrialDays: number;

  if (trialDaysParam !== undefined) {
    effectiveTrialDays = trialDaysParam;
  } else {
    // Fall back to the plan's configured default.
    const { rows: planRows } = await client.query<{ trial_days: number }>(
      `SELECT trial_days FROM billing_plans WHERE tenant_id = $1 AND id = $2`,
      [tenantId, planId]
    );
    if (planRows.length === 0) {
      return {
        code: "NOT_FOUND",
        message: `Billing plan '${planId}' not found in tenant '${tenantId}'.`,
      };
    }
    effectiveTrialDays = planRows[0].trial_days;
  }

  const isTrialing = effectiveTrialDays > 0;
  const initialStatus: SubscriptionRow["status"] = isTrialing ? "trialing" : "active";

  // trial_end is only set when the subscription starts in 'trialing'.
  const trialEndExpr = isTrialing
    ? `now() + ($5 || ' days')::interval`
    : "NULL";

  const { rows } = await client.query<SubscriptionRow>(
    `INSERT INTO subscriptions (
       tenant_id,
       billing_customer_id,
       plan_id,
       status,
       provider_slug,
       current_period_start,
       current_period_end,
       trial_end
     ) VALUES (
       $1, $2, $3, $4,
       $6,
       now(),
       now() + interval '30 days',
       ${trialEndExpr}
     )
     RETURNING ${SUBSCRIPTION_COLUMNS}`,
    isTrialing
      ? [tenantId, billingCustomerId, planId, initialStatus, effectiveTrialDays, providerSlug]
      : [tenantId, billingCustomerId, planId, initialStatus, null, providerSlug]
  );

  const subscription = rows[0];

  await writeAuditLog(client, {
    tenantId,
    actorId: null,
    action: "subscription.created",
    entityType: "subscription",
    entityId: subscription.id,
    oldState: null,
    newState: toAuditSnapshot(subscription),
    context: {
      billingCustomerId,
      planId,
      providerSlug,
      initialStatus,
      trialDays: effectiveTrialDays,
    },
  });

  return subscription;
}

/**
 * Transitions a subscription to a new status, enforcing the state machine.
 *
 * If the requested transition is not permitted by VALID_TRANSITIONS, returns
 * a typed INVALID_STATE_TRANSITION error — does NOT throw.
 *
 * @param client         - PoolClient from withTenantContext.
 * @param tenantId       - The tenant UUID.
 * @param subscriptionId - UUID of the subscription to transition.
 * @param toStatus       - Target status.
 * @param reason         - Optional human-readable reason (stored in cancel_reason
 *                         when transitioning to 'canceled'; ignored otherwise).
 * @returns The updated SubscriptionRow, or a typed error.
 */
export async function transitionSubscriptionStatus(
  client: PoolClient,
  tenantId: string,
  subscriptionId: string,
  toStatus: SubscriptionRow["status"],
  reason?: string
): Promise<TransitionResult> {
  const existing = await fetchSubscriptionRow(client, tenantId, subscriptionId);

  if (!existing) {
    return {
      code: "NOT_FOUND",
      message: `Subscription '${subscriptionId}' not found in tenant '${tenantId}'.`,
    };
  }

  // Guard: validate the transition before issuing any mutation.
  if (!assertValidTransition(existing.status, toStatus)) {
    return {
      code: "INVALID_STATE_TRANSITION",
      message: `Cannot transition subscription '${subscriptionId}' from '${existing.status}' to '${toStatus}'. Valid transitions from '${existing.status}': [${[...(VALID_TRANSITIONS.get(existing.status) ?? [])].join(", ") || "none"}].`,
      fromStatus: existing.status,
      toStatus,
    };
  }

  // Build dynamic SET clause — canceled_at is only set on 'canceled' transitions.
  const isCanceling = toStatus === "canceled";

  const { rows } = await client.query<SubscriptionRow>(
    `UPDATE subscriptions
        SET status       = $3,
            cancel_reason = CASE WHEN $4::boolean THEN $5 ELSE cancel_reason END,
            canceled_at   = CASE WHEN $4::boolean THEN now() ELSE canceled_at END,
            updated_at    = now()
      WHERE tenant_id = $1
        AND id        = $2
      RETURNING ${SUBSCRIPTION_COLUMNS}`,
    [tenantId, subscriptionId, toStatus, isCanceling, reason ?? null]
  );

  const updated = rows[0];
  if (!updated) {
    // Race condition — row disappeared between fetch and update.
    return {
      code: "NOT_FOUND",
      message: `Subscription '${subscriptionId}' not found in tenant '${tenantId}'.`,
    };
  }

  const oldSnapshot = toAuditSnapshot(existing);
  const newSnapshot = toAuditSnapshot(updated);

  await writeAuditLog(client, {
    tenantId,
    actorId: null,
    action: "subscription.status_changed",
    entityType: "subscription",
    entityId: subscriptionId,
    oldState: oldSnapshot,
    newState: newSnapshot,
    context: {
      fromStatus: existing.status,
      toStatus,
      reason: reason ?? null,
    },
  });

  return updated;
}

/**
 * Convenience wrapper that cancels a subscription by transitioning it to
 * 'canceled', setting canceled_at = now() and recording an optional reason.
 *
 * Internally delegates to transitionSubscriptionStatus; the state-machine
 * check still applies.
 *
 * @param client         - PoolClient from withTenantContext.
 * @param tenantId       - The tenant UUID.
 * @param subscriptionId - UUID of the subscription to cancel.
 * @param reason         - Optional cancellation reason for the audit trail.
 * @returns The updated SubscriptionRow, or a typed error.
 */
export async function cancelSubscription(
  client: PoolClient,
  tenantId: string,
  subscriptionId: string,
  reason?: string
): Promise<CancelResult> {
  return transitionSubscriptionStatus(
    client,
    tenantId,
    subscriptionId,
    "canceled",
    reason
  );
}

/**
 * Retrieves a single subscription by (tenantId, subscriptionId).
 *
 * @param client         - PoolClient from withTenantContext.
 * @param tenantId       - The tenant UUID.
 * @param subscriptionId - UUID of the subscription.
 * @returns SubscriptionRow on success, NotFoundError otherwise.
 */
export async function getSubscription(
  client: PoolClient,
  tenantId: string,
  subscriptionId: string
): Promise<SubscriptionResult> {
  const row = await fetchSubscriptionRow(client, tenantId, subscriptionId);

  if (!row) {
    return {
      code: "NOT_FOUND",
      message: `Subscription '${subscriptionId}' not found in tenant '${tenantId}'.`,
    };
  }

  return row;
}

/**
 * Lists subscriptions for a tenant with optional filters and pagination.
 *
 * Task 7.2 pagination contract: { items, total, limit, offset }.
 * limit defaults to 50, max 200. offset defaults to 0.
 *
 * @param client     - PoolClient from withTenantContext.
 * @param tenantId   - The tenant UUID.
 * @param filters    - Optional { status?, billingCustomerId?, planId? }
 * @param pagination - Optional { limit?, offset? }
 * @returns Paginated result or VALIDATION_ERROR.
 */
export async function listSubscriptions(
  client: PoolClient,
  tenantId: string,
  filters?: {
    status?: SubscriptionRow["status"];
    billingCustomerId?: string;
    planId?: string;
  },
  pagination?: { limit?: number; offset?: number }
): Promise<
  | { items: SubscriptionRow[]; total: number; limit: number; offset: number }
  | ValidationError
> {
  const limitVal = pagination?.limit !== undefined ? pagination.limit : 50;
  const offsetVal = pagination?.offset !== undefined ? pagination.offset : 0;

  if (!Number.isInteger(limitVal) || limitVal < 0) {
    return {
      code: "VALIDATION_ERROR",
      message: "limit must be a non-negative integer",
    };
  }
  if (!Number.isInteger(offsetVal) || offsetVal < 0) {
    return {
      code: "VALIDATION_ERROR",
      message: "offset must be a non-negative integer",
    };
  }

  const finalLimit = Math.min(limitVal, 200);

  const conditions: string[] = ["tenant_id = $1"];
  const values: unknown[] = [tenantId];

  if (filters?.status !== undefined) {
    conditions.push(`status = $${values.length + 1}`);
    values.push(filters.status);
  }
  if (filters?.billingCustomerId !== undefined) {
    conditions.push(`billing_customer_id = $${values.length + 1}`);
    values.push(filters.billingCustomerId);
  }
  if (filters?.planId !== undefined) {
    conditions.push(`plan_id = $${values.length + 1}`);
    values.push(filters.planId);
  }

  const whereClause = conditions.join(" AND ");

  const countResult = await client.query<{ count: string }>(
    `SELECT count(*) FROM subscriptions WHERE ${whereClause}`,
    values
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const limitParam = values.length + 1;
  const offsetParam = values.length + 2;
  const queryValues = [...values, finalLimit, offsetVal];

  const { rows } = await client.query<SubscriptionRow>(
    `SELECT ${SUBSCRIPTION_COLUMNS}
       FROM subscriptions
      WHERE ${whereClause}
      ORDER BY created_at ASC
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    queryValues
  );

  return {
    items: rows,
    total,
    limit: finalLimit,
    offset: offsetVal,
  };
}

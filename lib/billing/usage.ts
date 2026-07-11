/**
 * lib/billing/usage.ts
 *
 * Resource usage limit enforcement layer — Task 8.6 (Round 8, Billing).
 *
 * DESIGN CONTRACTS
 * ────────────────────────────────────────────────────────────────────────────
 * • All functions accept a PoolClient obtained externally via withTenantContext.
 *   They do NOT open their own connections or transactions. The caller owns the
 *   transaction lifecycle (BEGIN / COMMIT / ROLLBACK).
 *
 * • Errors for EXPECTED failure modes (limit exceeded) are returned as typed
 *   objects with a `code` property — never thrown as raw Errors.
 *
 *   ⚠ DELIBERATE DEVIATION FROM BLUEPRINT SKETCH:
 *   The Round 8 Q5 blueprint sketch defines BillingLimitExceeded as a thrown
 *   Error class. This implementation instead returns a typed error object
 *   (code: 'BILLING_LIMIT_EXCEEDED') from checkUsageLimit, consistent with the
 *   established typed-return convention in every other Round 5–7 data-layer
 *   function (roles.ts, users.ts, customers.ts, plans.ts). Throwing for an
 *   expected, recoverable condition would be an anomaly in this codebase.
 *
 * • Team Decision #2 (opt-in enforcement): checkUsageLimit is a no-op if the
 *   tenant has no enforcing subscription — see checkUsageLimit for full
 *   rationale.
 *
 * RESOURCE QUERY CONVENTION
 * ────────────────────────────────────────────────────────────────────────────
 * The `resource` key maps to a COUNT query against the appropriate table.
 * This file ships with handlers for 'users' and 'entity_records'. Additional
 * resource types can be added to RESOURCE_QUERY_MAP without changing the
 * public API.
 */

import type { PoolClient } from "pg";

// ─── Error type ───────────────────────────────────────────────────────────────

/**
 * Returned (never thrown) when a tenant would exceed a plan limit.
 *
 * ⚠ See file-level note: the blueprint sketch uses a thrown
 * BillingLimitExceeded error class; this codebase returns typed error objects
 * instead, for consistency with every other Round 5–7 data-layer function.
 */
export interface BillingLimitExceededError {
  code: "BILLING_LIMIT_EXCEEDED";
  message: string;
  resource: string;
  currentUsage: number;
  limit: number;
  delta: number;
}

// ─── Result type ──────────────────────────────────────────────────────────────

/**
 * undefined means "no problem, proceed". BillingLimitExceededError means
 * "reject the operation".
 */
export type UsageLimitResult = undefined | BillingLimitExceededError;

// ─── Resource query map ───────────────────────────────────────────────────────

/**
 * Maps a resource key (as stored in billing_plans.limits JSONB) to a SQL
 * COUNT query that returns the current usage for that resource in the tenant.
 *
 * Each query must:
 *   - Accept exactly one parameter: $1 = tenant_id (UUID).
 *   - Return a single row with a single column named `count` (TEXT — pg
 *     always returns count(*) as text; callers parse with parseInt).
 *
 * Add new resources here as the schema grows. Unknown resource keys are
 * treated as unlimited (no-op) by checkUsageLimit.
 */
const RESOURCE_QUERY_MAP: Readonly<Record<string, string>> = {
  users: `
    SELECT count(*)::text AS count
      FROM users
     WHERE tenant_id = $1
       AND is_active  = TRUE
  `,
  entity_records: `
    SELECT count(*)::text AS count
      FROM entity_records
     WHERE tenant_id = $1
  `,
};

// ─── Subscription status semantics ────────────────────────────────────────────

/**
 * The set of subscription statuses that activate limit enforcement.
 *
 * Team Decision #2 — Opt-in enforcement:
 *   Only 'active' and 'trialing' subscriptions trigger limit checks.
 *   'past_due' and no-subscription-at-all are both treated as no-op.
 *
 * Rationale for excluding 'past_due':
 *   A tenant whose payment is overdue is already in a degraded state; making
 *   them MORE restricted than a tenant with no subscription at all would be
 *   counterproductive and could block them from taking corrective action (e.g.
 *   updating their payment method). The intent of opt-in enforcement is that
 *   paying/trialing tenants agree to be bound by plan limits; a past_due tenant
 *   is neither fully opted-in (payment failed) nor fully opted-out (they still
 *   have a subscription row), but the safer default is to not restrict them
 *   further than the baseline no-subscription experience.
 */
const ENFORCING_STATUSES = new Set(["active", "trialing"]);

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Checks whether a tenant can consume `delta` additional units of `resource`
 * without exceeding their plan's limit.
 *
 * ENFORCEMENT FLOW
 * ────────────────────────────────────────────────────────────────────────────
 * 1. Look for an enforcing subscription (status IN ('active', 'trialing')).
 *    If none exists → no-op (return undefined). This covers:
 *      - Tenants with no subscription at all.
 *      - Tenants whose subscription is 'past_due' or 'canceled'.
 *
 * 2. Look up the plan's `limits` JSONB for the given `resource` key.
 *    If the key is absent → unlimited (no-op, return undefined).
 *
 * 3. Determine current usage via a live COUNT query for the resource.
 *
 * 4. If current_usage + delta > limit → return BillingLimitExceededError.
 *    Otherwise → return undefined (operation is permitted).
 *
 * @param client    - PoolClient from withTenantContext.
 * @param tenantId  - The tenant UUID.
 * @param resource  - Resource key matching a key in billing_plans.limits JSONB
 *                    (e.g. 'users', 'entity_records').
 * @param delta     - How many additional units the caller wants to create.
 *                    Typically 1 for single-record creation. Must be >= 0.
 * @returns undefined if the operation is permitted, BillingLimitExceededError
 *          if it would exceed the plan limit.
 */
export async function checkUsageLimit(
  client: PoolClient,
  tenantId: string,
  resource: string,
  delta: number
): Promise<UsageLimitResult> {
  // ── Step 1: Find the tenant's enforcing subscription ──────────────────────
  //
  // Join subscriptions → billing_plans in one query to also fetch limits JSONB
  // atomically. Use the most recently created enforcing subscription if there
  // are multiple (edge case for multi-plan tenants).
  //
  // Only 'active' and 'trialing' trigger enforcement. See ENFORCING_STATUSES
  // above for the rationale on excluding 'past_due'.
  const { rows: enforcingRows } = await client.query<{
    limits: Record<string, unknown>;
  }>(
    `SELECT bp.limits
       FROM subscriptions s
       JOIN billing_plans bp
         ON bp.tenant_id = s.tenant_id
        AND bp.id        = s.plan_id
      WHERE s.tenant_id = $1
        AND s.status    IN ('active', 'trialing')
      ORDER BY s.created_at DESC
      LIMIT 1`,
    [tenantId]
  );

  // No enforcing subscription → opt-in means we do nothing.
  if (enforcingRows.length === 0) {
    return undefined;
  }

  const limits = enforcingRows[0].limits;

  // ── Step 2: Check if this resource is governed by a limit ─────────────────
  if (!(resource in limits)) {
    // Resource key absent from plan limits → unlimited.
    return undefined;
  }

  const rawLimit = limits[resource];
  const planLimit = Number(rawLimit);

  if (!Number.isFinite(planLimit) || planLimit < 0) {
    // Malformed or sentinel limit value (e.g. null, -1, "unlimited") → treat
    // as unlimited for safety. Callers that want hard zeros should store 0.
    return undefined;
  }

  // ── Step 3: Count current usage ───────────────────────────────────────────
  const countQuery = RESOURCE_QUERY_MAP[resource];

  if (!countQuery) {
    // Unknown resource type — no COUNT query registered → treat as unlimited.
    // This prevents false limit enforcement for future resource types before
    // their queries are registered.
    return undefined;
  }

  const { rows: countRows } = await client.query<{ count: string }>(
    countQuery,
    [tenantId]
  );

  const currentUsage = parseInt(countRows[0]?.count ?? "0", 10);

  // ── Step 4: Compare ───────────────────────────────────────────────────────
  if (currentUsage + delta > planLimit) {
    return {
      code: "BILLING_LIMIT_EXCEEDED",
      message:
        `Tenant '${tenantId}' would exceed the plan limit for resource '${resource}'. ` +
        `Current usage: ${currentUsage}, delta: ${delta}, limit: ${planLimit}.`,
      resource,
      currentUsage,
      limit: planLimit,
      delta,
    };
  }

  return undefined;
}

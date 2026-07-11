import type { PoolClient } from "pg";
import { writeAuditLog } from "@/lib/db/audit";

export interface BillingPlanRow {
  tenant_id: string;
  id: string;
  name: string;
  description: string;
  amount_minor_units: string;
  currency: string;
  interval: string;
  interval_count: number;
  trial_days: number;
  limits: Record<string, unknown>;
  stripe_price_id: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreatePlanParams {
  name: string;
  description?: string;
  amountMinorUnits: number | string;
  currency: string;
  interval: "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "one_time";
  intervalCount?: number;
  trialDays?: number;
  limits?: Record<string, unknown>;
}

export interface UpdatePlanParams {
  name?: string;
  description?: string;
  amountMinorUnits?: number | string;
  currency?: string;
  interval?: "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "one_time";
  intervalCount?: number;
  trialDays?: number;
  limits?: Record<string, unknown>;
}

export interface NotFoundError {
  code: "NOT_FOUND";
  message: string;
}

export interface ValidationError {
  code: "VALIDATION_ERROR";
  message: string;
}

export interface PlanInUseError {
  code: "PLAN_IN_USE";
  message: string;
}

export type BillingPlanResult = BillingPlanRow | NotFoundError;
export type DeactivatePlanResult = BillingPlanRow | NotFoundError | PlanInUseError;

const VALID_INTERVALS = new Set([
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
  "one_time",
]);

function buildDiff(
  oldState: Record<string, unknown>,
  newState: Record<string, unknown>
): Record<string, { from: unknown; to: unknown }> | undefined {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const allKeys = new Set([...Object.keys(oldState), ...Object.keys(newState)]);

  for (const key of allKeys) {
    const from = oldState[key];
    const to = newState[key];

    const equal =
      from === to ||
      (typeof from === "object" &&
        from !== null &&
        typeof to === "object" &&
        to !== null &&
        JSON.stringify(from) === JSON.stringify(to));

    if (!equal) {
      diff[key] = { from, to };
    }
  }

  return Object.keys(diff).length > 0 ? diff : undefined;
}

function toAuditSnapshot(plan: BillingPlanRow): Record<string, unknown> {
  return { ...plan };
}

export async function createPlan(
  client: PoolClient,
  tenantId: string,
  params: CreatePlanParams
): Promise<BillingPlanRow | ValidationError> {
  const {
    name,
    description,
    amountMinorUnits,
    currency,
    interval,
    intervalCount,
    trialDays,
    limits,
  } = params;

  if (!VALID_INTERVALS.has(interval)) {
    return {
      code: "VALIDATION_ERROR",
      message: `Invalid interval: ${interval}. Must be one of daily, weekly, monthly, quarterly, yearly, one_time.`,
    };
  }

  const { rows } = await client.query<BillingPlanRow>(
    `INSERT INTO billing_plans (tenant_id, name, description, amount_minor_units, currency, interval, interval_count, trial_days, limits)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING tenant_id, id, name, description, amount_minor_units, currency, interval, interval_count, trial_days, limits, stripe_price_id, is_active, created_at, updated_at`,
    [
      tenantId,
      name,
      description ?? "",
      amountMinorUnits,
      currency,
      interval,
      intervalCount ?? 1,
      trialDays ?? 0,
      limits ?? {},
    ]
  );

  const plan = rows[0];

  await writeAuditLog(client, {
    tenantId,
    actorId: null,
    action: "billing_plan.created",
    entityType: "billing_plan",
    entityId: plan.id,
    oldState: null,
    newState: toAuditSnapshot(plan),
    context: {
      name,
      interval,
      amountMinorUnits,
    },
  });

  return plan;
}

async function fetchPlanRow(
  client: PoolClient,
  tenantId: string,
  planId: string
): Promise<BillingPlanRow | undefined> {
  const { rows } = await client.query<BillingPlanRow>(
    `SELECT tenant_id, id, name, description, amount_minor_units, currency, interval, interval_count, trial_days, limits, stripe_price_id, is_active, created_at, updated_at
     FROM billing_plans
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, planId]
  );
  return rows[0];
}

export async function updatePlan(
  client: PoolClient,
  tenantId: string,
  planId: string,
  params: UpdatePlanParams
): Promise<BillingPlanResult | ValidationError> {
  const existing = await fetchPlanRow(client, tenantId, planId);

  if (!existing) {
    return {
      code: "NOT_FOUND",
      message: `Billing plan '${planId}' not found in tenant '${tenantId}'.`,
    };
  }

  const {
    name,
    description,
    amountMinorUnits,
    currency,
    interval,
    intervalCount,
    trialDays,
    limits,
  } = params;

  if (interval !== undefined && !VALID_INTERVALS.has(interval)) {
    return {
      code: "VALIDATION_ERROR",
      message: `Invalid interval: ${interval}. Must be one of daily, weekly, monthly, quarterly, yearly, one_time.`,
    };
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (name !== undefined) {
    setClauses.push(`name = $${paramIndex++}`);
    values.push(name);
  }
  if (description !== undefined) {
    setClauses.push(`description = $${paramIndex++}`);
    values.push(description);
  }
  if (amountMinorUnits !== undefined) {
    setClauses.push(`amount_minor_units = $${paramIndex++}`);
    values.push(amountMinorUnits);
  }
  if (currency !== undefined) {
    setClauses.push(`currency = $${paramIndex++}`);
    values.push(currency);
  }
  if (interval !== undefined) {
    setClauses.push(`interval = $${paramIndex++}`);
    values.push(interval);
  }
  if (intervalCount !== undefined) {
    setClauses.push(`interval_count = $${paramIndex++}`);
    values.push(intervalCount);
  }
  if (trialDays !== undefined) {
    setClauses.push(`trial_days = $${paramIndex++}`);
    values.push(trialDays);
  }
  if (limits !== undefined) {
    setClauses.push(`limits = $${paramIndex++}`);
    values.push(limits);
  }

  if (setClauses.length === 0) {
    return existing;
  }

  setClauses.push("updated_at = now()");

  values.push(tenantId);
  values.push(planId);

  const tenantParam = paramIndex;
  const planParam = paramIndex + 1;

  const { rows } = await client.query<BillingPlanRow>(
    `UPDATE billing_plans
        SET ${setClauses.join(", ")}
      WHERE tenant_id = $${tenantParam}
        AND id        = $${planParam}
      RETURNING tenant_id, id, name, description, amount_minor_units, currency, interval, interval_count, trial_days, limits, stripe_price_id, is_active, created_at, updated_at`,
    values
  );

  const updated = rows[0];
  if (!updated) {
    return {
      code: "NOT_FOUND",
      message: `Billing plan '${planId}' not found in tenant '${tenantId}'.`,
    };
  }

  const oldSnapshot = toAuditSnapshot(existing);
  const newSnapshot = toAuditSnapshot(updated);
  const diff = buildDiff(oldSnapshot, newSnapshot);

  await writeAuditLog(client, {
    tenantId,
    actorId: null,
    action: "billing_plan.updated",
    entityType: "billing_plan",
    entityId: planId,
    oldState: oldSnapshot,
    newState: newSnapshot,
    context: {
      diff: diff ?? {},
    },
  });

  return updated;
}

export async function getPlan(
  client: PoolClient,
  tenantId: string,
  planId: string
): Promise<BillingPlanResult> {
  const plan = await fetchPlanRow(client, tenantId, planId);

  if (!plan) {
    return {
      code: "NOT_FOUND",
      message: `Billing plan '${planId}' not found in tenant '${tenantId}'.`,
    };
  }

  return plan;
}

export async function listPlans(
  client: PoolClient,
  tenantId: string,
  filters?: { isActive?: boolean },
  pagination?: { limit?: number; offset?: number }
): Promise<
  | { items: BillingPlanRow[]; total: number; limit: number; offset: number }
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

  if (filters?.isActive !== undefined) {
    conditions.push(`is_active = $${values.length + 1}`);
    values.push(filters.isActive);
  }

  const countResult = await client.query<{ count: string }>(
    `SELECT count(*) FROM billing_plans WHERE ${conditions.join(" AND ")}`,
    values
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const queryValues = [...values, finalLimit, offsetVal];
  const limitParam = values.length + 1;
  const offsetParam = values.length + 2;

  const { rows } = await client.query<BillingPlanRow>(
    `SELECT tenant_id, id, name, description, amount_minor_units, currency, interval, interval_count, trial_days, limits, stripe_price_id, is_active, created_at, updated_at
       FROM billing_plans
      WHERE ${conditions.join(" AND ")}
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

export async function deactivatePlan(
  client: PoolClient,
  tenantId: string,
  planId: string
): Promise<DeactivatePlanResult> {
  const existing = await fetchPlanRow(client, tenantId, planId);

  if (!existing) {
    return {
      code: "NOT_FOUND",
      message: `Billing plan '${planId}' not found in tenant '${tenantId}'.`,
    };
  }

  // Check for active subscriptions
  const { rows: subRows } = await client.query(
    `SELECT 1 FROM subscriptions
     WHERE tenant_id = $1 AND plan_id = $2 AND status IN ('active', 'trialing', 'past_due')
     LIMIT 1`,
    [tenantId, planId]
  );

  if (subRows.length > 0) {
    return {
      code: "PLAN_IN_USE",
      message: `Plan '${planId}' is currently in use by one or more active subscriptions and cannot be deactivated.`,
    };
  }

  const { rows } = await client.query<BillingPlanRow>(
    `UPDATE billing_plans
        SET is_active = FALSE,
            updated_at = now()
      WHERE tenant_id = $1
        AND id        = $2
      RETURNING tenant_id, id, name, description, amount_minor_units, currency, interval, interval_count, trial_days, limits, stripe_price_id, is_active, created_at, updated_at`,
    [tenantId, planId]
  );

  const updated = rows[0];
  if (!updated) {
    return {
      code: "NOT_FOUND",
      message: `Billing plan '${planId}' not found in tenant '${tenantId}'.`,
    };
  }

  const oldSnapshot = toAuditSnapshot(existing);
  const newSnapshot = toAuditSnapshot(updated);
  const diff = buildDiff(oldSnapshot, newSnapshot);

  await writeAuditLog(client, {
    tenantId,
    actorId: null,
    action: "billing_plan.deactivated",
    entityType: "billing_plan",
    entityId: planId,
    oldState: oldSnapshot,
    newState: newSnapshot,
    context: {
      diff: diff ?? {},
    },
  });

  return updated;
}

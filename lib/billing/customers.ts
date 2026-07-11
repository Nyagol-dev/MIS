import type { PoolClient } from "pg";
import { writeAuditLog } from "@/lib/db/audit";

export interface BillingCustomerRow {
  tenant_id: string;
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  stripe_customer_id: string | null;
  user_id: string | null;
  metadata: Record<string, unknown>;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateBillingCustomerParams {
  displayName: string;
  email?: string;
  phone?: string;
  userId?: string;
}

export interface UpdateBillingCustomerParams {
  displayName?: string;
  email?: string;
  phone?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export interface NotFoundError {
  code: "NOT_FOUND";
  message: string;
}

export interface ValidationError {
  code: "VALIDATION_ERROR";
  message: string;
}

export type BillingCustomerResult = BillingCustomerRow | NotFoundError;

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

function toAuditSnapshot(customer: BillingCustomerRow): Record<string, unknown> {
  return { ...customer };
}

export async function createBillingCustomer(
  client: PoolClient,
  tenantId: string,
  params: CreateBillingCustomerParams
): Promise<BillingCustomerRow> {
  const { displayName, email, phone, userId } = params;

  const { rows } = await client.query<BillingCustomerRow>(
    `INSERT INTO billing_customers (tenant_id, display_name, email, phone, user_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING tenant_id, id, display_name, email, phone, stripe_customer_id, user_id, metadata, is_active, created_at, updated_at`,
    [tenantId, displayName, email ?? null, phone ?? null, userId ?? null]
  );

  const customer = rows[0];

  await writeAuditLog(client, {
    tenantId,
    actorId: null,
    action: "billing_customer.created",
    entityType: "billing_customer",
    entityId: customer.id,
    oldState: null,
    newState: toAuditSnapshot(customer),
    context: {
      displayName,
      email: email ?? null,
      phone: phone ?? null,
      userId: userId ?? null,
    },
  });

  return customer;
}

async function fetchCustomerRow(
  client: PoolClient,
  tenantId: string,
  customerId: string
): Promise<BillingCustomerRow | undefined> {
  const { rows } = await client.query<BillingCustomerRow>(
    `SELECT tenant_id, id, display_name, email, phone, stripe_customer_id, user_id, metadata, is_active, created_at, updated_at
     FROM billing_customers
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, customerId]
  );
  return rows[0];
}

export async function updateBillingCustomer(
  client: PoolClient,
  tenantId: string,
  customerId: string,
  params: UpdateBillingCustomerParams
): Promise<BillingCustomerResult> {
  const existing = await fetchCustomerRow(client, tenantId, customerId);

  if (!existing) {
    return {
      code: "NOT_FOUND",
      message: `Billing customer '${customerId}' not found in tenant '${tenantId}'.`,
    };
  }

  const { displayName, email, phone, userId, metadata } = params;

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (displayName !== undefined) {
    setClauses.push(`display_name = $${paramIndex++}`);
    values.push(displayName);
  }
  if (email !== undefined) {
    setClauses.push(`email = $${paramIndex++}`);
    values.push(email);
  }
  if (phone !== undefined) {
    setClauses.push(`phone = $${paramIndex++}`);
    values.push(phone);
  }
  if (userId !== undefined) {
    setClauses.push(`user_id = $${paramIndex++}`);
    values.push(userId);
  }
  if (metadata !== undefined) {
    setClauses.push(`metadata = $${paramIndex++}`);
    values.push(metadata);
  }

  if (setClauses.length === 0) {
    return existing;
  }

  setClauses.push("updated_at = now()");

  values.push(tenantId);
  values.push(customerId);

  const tenantParam = paramIndex;
  const customerParam = paramIndex + 1;

  const { rows } = await client.query<BillingCustomerRow>(
    `UPDATE billing_customers
        SET ${setClauses.join(", ")}
      WHERE tenant_id = $${tenantParam}
        AND id        = $${customerParam}
      RETURNING tenant_id, id, display_name, email, phone, stripe_customer_id, user_id, metadata, is_active, created_at, updated_at`,
    values
  );

  const updated = rows[0];
  if (!updated) {
    return {
      code: "NOT_FOUND",
      message: `Billing customer '${customerId}' not found in tenant '${tenantId}'.`,
    };
  }

  const oldSnapshot = toAuditSnapshot(existing);
  const newSnapshot = toAuditSnapshot(updated);
  const diff = buildDiff(oldSnapshot, newSnapshot);

  await writeAuditLog(client, {
    tenantId,
    actorId: null,
    action: "billing_customer.updated",
    entityType: "billing_customer",
    entityId: customerId,
    oldState: oldSnapshot,
    newState: newSnapshot,
    context: {
      diff: diff ?? {},
    },
  });

  return updated;
}

export async function getBillingCustomer(
  client: PoolClient,
  tenantId: string,
  customerId: string
): Promise<BillingCustomerResult> {
  const customer = await fetchCustomerRow(client, tenantId, customerId);

  if (!customer) {
    return {
      code: "NOT_FOUND",
      message: `Billing customer '${customerId}' not found in tenant '${tenantId}'.`,
    };
  }

  return customer;
}

export async function listBillingCustomers(
  client: PoolClient,
  tenantId: string,
  filters?: { isActive?: boolean },
  pagination?: { limit?: number; offset?: number }
): Promise<
  | { items: BillingCustomerRow[]; total: number; limit: number; offset: number }
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
    `SELECT count(*) FROM billing_customers WHERE ${conditions.join(" AND ")}`,
    values
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const queryValues = [...values, finalLimit, offsetVal];
  const limitParam = values.length + 1;
  const offsetParam = values.length + 2;

  const { rows } = await client.query<BillingCustomerRow>(
    `SELECT tenant_id, id, display_name, email, phone, stripe_customer_id, user_id, metadata, is_active, created_at, updated_at
       FROM billing_customers
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

export async function deactivateBillingCustomer(
  client: PoolClient,
  tenantId: string,
  customerId: string
): Promise<BillingCustomerResult> {
  const existing = await fetchCustomerRow(client, tenantId, customerId);

  if (!existing) {
    return {
      code: "NOT_FOUND",
      message: `Billing customer '${customerId}' not found in tenant '${tenantId}'.`,
    };
  }

  const { rows } = await client.query<BillingCustomerRow>(
    `UPDATE billing_customers
        SET is_active = FALSE,
            updated_at = now()
      WHERE tenant_id = $1
        AND id        = $2
      RETURNING tenant_id, id, display_name, email, phone, stripe_customer_id, user_id, metadata, is_active, created_at, updated_at`,
    [tenantId, customerId]
  );

  const updated = rows[0];
  if (!updated) {
    return {
      code: "NOT_FOUND",
      message: `Billing customer '${customerId}' not found in tenant '${tenantId}'.`,
    };
  }

  const oldSnapshot = toAuditSnapshot(existing);
  const newSnapshot = toAuditSnapshot(updated);
  const diff = buildDiff(oldSnapshot, newSnapshot);

  await writeAuditLog(client, {
    tenantId,
    actorId: null,
    action: "billing_customer.deactivated",
    entityType: "billing_customer",
    entityId: customerId,
    oldState: oldSnapshot,
    newState: newSnapshot,
    context: {
      diff: diff ?? {},
    },
  });

  return updated;
}

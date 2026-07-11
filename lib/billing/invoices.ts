/**
 * lib/billing/invoices.ts
 *
 * CRUD + state-machine layer for the `invoices` and `invoice_line_items`
 * tables — Task 8.6 (Round 8, Billing & Subscriptions).
 *
 * DESIGN CONTRACTS
 * ────────────────────────────────────────────────────────────────────────────
 * • All functions accept a PoolClient obtained externally via withTenantContext.
 *   They do NOT open their own connections or transactions. The caller owns the
 *   transaction lifecycle (BEGIN / COMMIT / ROLLBACK).
 *
 * • Errors for EXPECTED failure modes (invoice not found, invalid state
 *   transition, voiding a paid invoice) are returned as typed objects with a
 *   `code` property — never thrown as raw Errors.
 *
 * • writeAuditLog is called on the SAME client, inside the SAME transaction,
 *   immediately after every mutation query — before the function returns.
 *
 * • All monetary arithmetic uses BIGINT (number in TypeScript, BIGINT in
 *   Postgres). No floating-point operations are performed on minor-unit
 *   amounts anywhere in this file.
 *
 * • Pagination follows the Task 7.2 contract:
 *   { items, total, limit, offset } — limit capped at 200, default 50.
 *
 * INVOICE NUMBERING
 * ────────────────────────────────────────────────────────────────────────────
 * Each tenant has a row in `tenant_invoice_sequences` (PRIMARY KEY tenant_id,
 * next_seq BIGINT DEFAULT 0). generateInvoiceNumber atomically increments
 * next_seq with UPDATE … RETURNING, which takes a row-level lock implicitly —
 * no explicit FOR UPDATE is required. The returned BIGINT is formatted as:
 *
 *   'INV-' + String(seq).padStart(5, '0')
 *
 * If next_seq exceeds 99999 the string grows past 5 digits naturally (no
 * truncation, no data loss). Sequences that have never been created are
 * inserted on first use via INSERT … ON CONFLICT DO NOTHING before the UPDATE.
 */

import type { PoolClient } from "pg";
import { writeAuditLog } from "@/lib/db/audit";

// ─── Row types ────────────────────────────────────────────────────────────────

export interface InvoiceRow {
  tenant_id: string;
  id: string;
  subscription_id: string | null;
  billing_customer_id: string;
  invoice_number: string;
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  subtotal_minor_units: bigint;
  tax_minor_units: bigint;
  total_minor_units: bigint;
  currency: string;
  due_date: string | null;   // DATE is returned as a string by node-postgres
  paid_at: Date | null;
  stripe_invoice_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface InvoiceLineItemRow {
  tenant_id: string;
  invoice_id: string;
  id: string;
  description: string;
  quantity: number;
  unit_amount_minor_units: bigint;
  total_minor_units: bigint;
  metadata: Record<string, unknown>;
  created_at: Date;
}

// ─── Params ───────────────────────────────────────────────────────────────────

export interface CreateInvoiceLineItemParam {
  description: string;
  /** Positive integer. */
  quantity: number;
  /** Amount in smallest currency unit (BIGINT — NO floating-point). */
  unitAmountMinorUnits: bigint;
  metadata?: Record<string, unknown>;
}

export interface CreateInvoiceParams {
  billingCustomerId: string;
  /** Optional — NULL for one-time invoices not tied to a subscription. */
  subscriptionId?: string;
  /** ISO 4217 currency code, e.g. 'KES'. Defaults to 'KES'. */
  currency?: string;
  /** Due date in 'YYYY-MM-DD' format, or omit for no due date. */
  dueDate?: string;
  /** At least one line item is required. */
  lineItems: CreateInvoiceLineItemParam[];
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
 * Returned (never thrown) when a requested invoice status transition is not
 * permitted by the invoice state machine.
 */
export interface InvalidInvoiceStateError {
  code: "INVALID_INVOICE_STATE";
  message: string;
  currentStatus: InvoiceRow["status"];
  requiredStatus: InvoiceRow["status"];
}

/**
 * Returned (never thrown) when the caller attempts to void a paid invoice.
 *
 * A paid invoice may only be reversed via an explicit 'uncollectible' path
 * (e.g., a write-off or credit note workflow) — voiding is not the correct
 * mechanism once payment has been received. This error surfaces that
 * distinction explicitly rather than silently failing or misrouting.
 */
export interface CannotVoidPaidInvoiceError {
  code: "CANNOT_VOID_PAID_INVOICE";
  message: string;
}

// ─── Result union types ───────────────────────────────────────────────────────

export type InvoiceResult = InvoiceRow | NotFoundError;

export type FinalizeResult =
  | InvoiceRow
  | NotFoundError
  | InvalidInvoiceStateError;

export type MarkPaidResult =
  | InvoiceRow
  | NotFoundError
  | InvalidInvoiceStateError;

export type VoidResult =
  | InvoiceRow
  | NotFoundError
  | InvalidInvoiceStateError
  | CannotVoidPaidInvoiceError;

// ─── Column lists ─────────────────────────────────────────────────────────────

/** Full SELECT column list for `invoices` — avoids SELECT *. */
const INVOICE_COLUMNS = `
  tenant_id,
  id,
  subscription_id,
  billing_customer_id,
  invoice_number,
  status,
  subtotal_minor_units,
  tax_minor_units,
  total_minor_units,
  currency,
  due_date,
  paid_at,
  stripe_invoice_id,
  metadata,
  created_at,
  updated_at
`.trim();

/** Full SELECT column list for `invoice_line_items` — avoids SELECT *. */
const LINE_ITEM_COLUMNS = `
  tenant_id,
  invoice_id,
  id,
  description,
  quantity,
  unit_amount_minor_units,
  total_minor_units,
  metadata,
  created_at
`.trim();

// ─── Internal helpers ─────────────────────────────────────────────────────────

function toAuditSnapshot(row: InvoiceRow): Record<string, unknown> {
  // BigInt is not JSON-serialisable; convert to string for audit storage.
  return {
    ...row,
    subtotal_minor_units: String(row.subtotal_minor_units),
    tax_minor_units:      String(row.tax_minor_units),
    total_minor_units:    String(row.total_minor_units),
  };
}

async function fetchInvoiceRow(
  client: PoolClient,
  tenantId: string,
  invoiceId: string
): Promise<InvoiceRow | undefined> {
  const { rows } = await client.query<InvoiceRow>(
    `SELECT ${INVOICE_COLUMNS}
       FROM invoices
      WHERE tenant_id = $1
        AND id        = $2`,
    [tenantId, invoiceId]
  );
  return rows[0];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Atomically increments the tenant's invoice sequence counter and returns the
 * formatted invoice number string.
 *
 * The row-level lock is acquired implicitly by the UPDATE statement — no
 * explicit FOR UPDATE is needed. The sequence row is created on first use
 * (INSERT … ON CONFLICT DO NOTHING) before the UPDATE.
 *
 * Formatting rule:
 *   seq →  'INV-' + String(seq).padStart(5, '0')
 *   e.g. 47 → 'INV-00047', 100000 → 'INV-100000' (no truncation past 5 digits)
 *
 * @param client   - PoolClient from withTenantContext (inside an open transaction).
 * @param tenantId - The tenant UUID.
 * @returns Formatted invoice number string, e.g. 'INV-00001'.
 */
export async function generateInvoiceNumber(
  client: PoolClient,
  tenantId: string
): Promise<string> {
  // Ensure the tenant has a sequence row (idempotent — ignored if already exists).
  await client.query(
    `INSERT INTO tenant_invoice_sequences (tenant_id, next_seq)
     VALUES ($1, 0)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId]
  );

  // Atomically increment and return the new sequence value.
  const { rows } = await client.query<{ next_seq: bigint }>(
    `UPDATE tenant_invoice_sequences
        SET next_seq   = next_seq + 1,
            updated_at = now()
      WHERE tenant_id  = $1
      RETURNING next_seq`,
    [tenantId]
  );

  const seq: bigint = rows[0].next_seq;

  // Format: zero-pad to 5 digits minimum; if seq > 99999 let the string grow.
  const seqStr = String(seq);
  const paddedSeq = seqStr.length < 5 ? seqStr.padStart(5, "0") : seqStr;

  return `INV-${paddedSeq}`;
}

/**
 * Creates a new invoice (status 'draft') with all its line items in a single
 * round-trip batch, within the caller's existing transaction.
 *
 * Subtotal and total are computed using pure BIGINT arithmetic:
 *   line.total_minor_units = line.quantity * line.unitAmountMinorUnits
 *   subtotal               = Σ line.total_minor_units
 *   total                  = subtotal + tax_minor_units (tax is always 0 here;
 *                            a dedicated tax step can update the invoice later)
 *
 * Audit action: 'invoice.created'.
 *
 * @param client   - PoolClient from withTenantContext.
 * @param tenantId - The tenant UUID.
 * @param params   - { billingCustomerId, subscriptionId?, currency?, dueDate?, lineItems }
 * @returns The newly created InvoiceRow.
 * @throws ValidationError if lineItems is empty (returned, not thrown).
 */
export async function createInvoice(
  client: PoolClient,
  tenantId: string,
  params: CreateInvoiceParams
): Promise<InvoiceRow | ValidationError> {
  const {
    billingCustomerId,
    subscriptionId,
    currency = "KES",
    dueDate,
    lineItems,
  } = params;

  if (lineItems.length === 0) {
    return {
      code: "VALIDATION_ERROR",
      message: "An invoice must have at least one line item.",
    };
  }

  // ── Compute totals using BIGINT arithmetic (no floating-point) ──────────────
  let subtotal = BigInt(0);
  const computedLineItems = lineItems.map((item) => {
    const lineTotal = BigInt(item.quantity) * item.unitAmountMinorUnits;
    subtotal += lineTotal;
    return { ...item, lineTotal };
  });

  // Tax is 0 at invoice creation; a separate update step handles tax later.
  const taxMinorUnits = BigInt(0);
  const total = subtotal + taxMinorUnits;

  // ── Generate the invoice number (inside the same transaction) ────────────────
  const invoiceNumber = await generateInvoiceNumber(client, tenantId);

  // ── Insert the invoice row ───────────────────────────────────────────────────
  const { rows: invoiceRows } = await client.query<InvoiceRow>(
    `INSERT INTO invoices (
       tenant_id,
       billing_customer_id,
       subscription_id,
       invoice_number,
       status,
       subtotal_minor_units,
       tax_minor_units,
       total_minor_units,
       currency,
       due_date
     ) VALUES (
       $1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9
     )
     RETURNING ${INVOICE_COLUMNS}`,
    [
      tenantId,
      billingCustomerId,
      subscriptionId ?? null,
      invoiceNumber,
      subtotal,
      taxMinorUnits,
      total,
      currency,
      dueDate ?? null,
    ]
  );

  const invoice = invoiceRows[0];

  // ── Insert all line items in one batch ──────────────────────────────────────
  // Build a multi-row VALUES list to avoid N+1 round-trips.
  // Each row: (tenant_id, invoice_id, description, quantity,
  //            unit_amount_minor_units, total_minor_units, metadata)
  const valuesClauses: string[] = [];
  const lineValues: unknown[] = [];
  let pIdx = 1;

  for (const item of computedLineItems) {
    valuesClauses.push(
      `($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`
    );
    lineValues.push(
      tenantId,
      invoice.id,
      item.description,
      item.quantity,
      item.unitAmountMinorUnits,
      item.lineTotal,
      JSON.stringify(item.metadata ?? {})
    );
  }

  await client.query(
    `INSERT INTO invoice_line_items (
       tenant_id,
       invoice_id,
       description,
       quantity,
       unit_amount_minor_units,
       total_minor_units,
       metadata
     ) VALUES ${valuesClauses.join(", ")}`,
    lineValues
  );

  // ── Audit log ────────────────────────────────────────────────────────────────
  await writeAuditLog(client, {
    tenantId,
    actorId: null,
    action: "invoice.created",
    entityType: "invoice",
    entityId: invoice.id,
    oldState: null,
    newState: toAuditSnapshot(invoice),
    context: {
      invoiceNumber,
      billingCustomerId,
      subscriptionId: subscriptionId ?? null,
      currency,
      lineItemCount: lineItems.length,
      subtotalMinorUnits: String(subtotal),
      totalMinorUnits: String(total),
    },
  });

  return invoice;
}

/**
 * Transitions an invoice from 'draft' → 'open'.
 *
 * Returns a typed INVALID_INVOICE_STATE error if the invoice is not currently
 * 'draft'. This is the only valid transition into 'open'.
 *
 * Audit action: 'invoice.finalized'.
 *
 * @param client    - PoolClient from withTenantContext.
 * @param tenantId  - The tenant UUID.
 * @param invoiceId - UUID of the invoice to finalize.
 * @returns The updated InvoiceRow, or a typed error.
 */
export async function finalizeInvoice(
  client: PoolClient,
  tenantId: string,
  invoiceId: string
): Promise<FinalizeResult> {
  const existing = await fetchInvoiceRow(client, tenantId, invoiceId);

  if (!existing) {
    return {
      code: "NOT_FOUND",
      message: `Invoice '${invoiceId}' not found in tenant '${tenantId}'.`,
    };
  }

  if (existing.status !== "draft") {
    return {
      code: "INVALID_INVOICE_STATE",
      message: `Invoice '${invoiceId}' cannot be finalized: current status is '${existing.status}', expected 'draft'.`,
      currentStatus: existing.status,
      requiredStatus: "draft",
    };
  }

  const { rows } = await client.query<InvoiceRow>(
    `UPDATE invoices
        SET status     = 'open',
            updated_at = now()
      WHERE tenant_id  = $1
        AND id         = $2
      RETURNING ${INVOICE_COLUMNS}`,
    [tenantId, invoiceId]
  );

  const updated = rows[0];
  if (!updated) {
    // Race condition — row disappeared between fetch and update.
    return {
      code: "NOT_FOUND",
      message: `Invoice '${invoiceId}' not found in tenant '${tenantId}'.`,
    };
  }

  await writeAuditLog(client, {
    tenantId,
    actorId: null,
    action: "invoice.finalized",
    entityType: "invoice",
    entityId: invoiceId,
    oldState: toAuditSnapshot(existing),
    newState: toAuditSnapshot(updated),
    context: {
      fromStatus: "draft",
      toStatus: "open",
    },
  });

  return updated;
}

/**
 * Transitions an invoice to 'paid', recording the payment timestamp.
 *
 * This function is primarily called from the payment-processing path
 * (Task 8.8 — processPaymentResult) rather than directly from route handlers.
 * It is exposed as a reusable, standalone function so that the payment
 * processor can call it inside its own transaction without coupling to
 * the invoice route handler.
 *
 * Valid source statuses: 'open' or 'past_due' (the invoice was in an open
 * state when payment arrived). A 'draft' invoice cannot be paid directly
 * without first being finalized; attempting to do so returns
 * INVALID_INVOICE_STATE.
 *
 * Audit action: 'invoice.paid'.
 *
 * @param client    - PoolClient from withTenantContext.
 * @param tenantId  - The tenant UUID.
 * @param invoiceId - UUID of the invoice.
 * @param paidAt    - Optional timestamp; defaults to now() in SQL if omitted.
 * @returns The updated InvoiceRow, or a typed error.
 */
export async function markInvoicePaid(
  client: PoolClient,
  tenantId: string,
  invoiceId: string,
  paidAt?: Date
): Promise<MarkPaidResult> {
  const existing = await fetchInvoiceRow(client, tenantId, invoiceId);

  if (!existing) {
    return {
      code: "NOT_FOUND",
      message: `Invoice '${invoiceId}' not found in tenant '${tenantId}'.`,
    };
  }

  // Only 'open' invoices should be transitioned to 'paid'.
  // 'draft' must be finalized first; 'paid'/'void'/'uncollectible' are terminal.
  if (existing.status !== "open") {
    return {
      code: "INVALID_INVOICE_STATE",
      message: `Invoice '${invoiceId}' cannot be marked paid: current status is '${existing.status}', expected 'open'.`,
      currentStatus: existing.status,
      requiredStatus: "open",
    };
  }

  const { rows } = await client.query<InvoiceRow>(
    `UPDATE invoices
        SET status     = 'paid',
            paid_at    = $3,
            updated_at = now()
      WHERE tenant_id  = $1
        AND id         = $2
      RETURNING ${INVOICE_COLUMNS}`,
    [tenantId, invoiceId, paidAt ?? new Date()]
  );

  const updated = rows[0];
  if (!updated) {
    return {
      code: "NOT_FOUND",
      message: `Invoice '${invoiceId}' not found in tenant '${tenantId}'.`,
    };
  }

  await writeAuditLog(client, {
    tenantId,
    actorId: null,
    action: "invoice.paid",
    entityType: "invoice",
    entityId: invoiceId,
    oldState: toAuditSnapshot(existing),
    newState: toAuditSnapshot(updated),
    context: {
      fromStatus: "open",
      toStatus: "paid",
      paidAt: updated.paid_at?.toISOString() ?? null,
    },
  });

  return updated;
}

/**
 * Voids an invoice, transitioning it to 'void'.
 *
 * A paid invoice CANNOT be voided — use a separate 'uncollectible' path
 * (write-off / credit note) for reversals of paid invoices. Attempting to
 * void a paid invoice returns CANNOT_VOID_PAID_INVOICE (a distinct error
 * code that directs the caller to the correct resolution path).
 *
 * Valid source statuses for voiding: 'draft' or 'open'.
 * Terminal statuses ('void', 'uncollectible') are also rejected.
 *
 * Audit action: 'invoice.voided'.
 *
 * @param client    - PoolClient from withTenantContext.
 * @param tenantId  - The tenant UUID.
 * @param invoiceId - UUID of the invoice to void.
 * @returns The updated InvoiceRow, or a typed error.
 */
export async function voidInvoice(
  client: PoolClient,
  tenantId: string,
  invoiceId: string
): Promise<VoidResult> {
  const existing = await fetchInvoiceRow(client, tenantId, invoiceId);

  if (!existing) {
    return {
      code: "NOT_FOUND",
      message: `Invoice '${invoiceId}' not found in tenant '${tenantId}'.`,
    };
  }

  // Paid invoices must go through an explicit 'uncollectible' path —
  // return a specific error code so callers know exactly why voiding is
  // rejected and which alternative to use.
  if (existing.status === "paid") {
    return {
      code: "CANNOT_VOID_PAID_INVOICE",
      message:
        `Invoice '${invoiceId}' is already paid and cannot be voided. ` +
        `To reverse a paid invoice, mark it 'uncollectible' via a dedicated ` +
        `write-off or credit note path rather than voiding it.`,
    };
  }

  // Reject already-terminal statuses.
  if (existing.status === "void" || existing.status === "uncollectible") {
    return {
      code: "INVALID_INVOICE_STATE",
      message: `Invoice '${invoiceId}' cannot be voided: current status is '${existing.status}' (already terminal).`,
      currentStatus: existing.status,
      requiredStatus: "draft",  // nearest valid source — surfaces intent
    };
  }

  // At this point status is 'draft' or 'open' — both are voidable.
  const { rows } = await client.query<InvoiceRow>(
    `UPDATE invoices
        SET status     = 'void',
            updated_at = now()
      WHERE tenant_id  = $1
        AND id         = $2
      RETURNING ${INVOICE_COLUMNS}`,
    [tenantId, invoiceId]
  );

  const updated = rows[0];
  if (!updated) {
    return {
      code: "NOT_FOUND",
      message: `Invoice '${invoiceId}' not found in tenant '${tenantId}'.`,
    };
  }

  await writeAuditLog(client, {
    tenantId,
    actorId: null,
    action: "invoice.voided",
    entityType: "invoice",
    entityId: invoiceId,
    oldState: toAuditSnapshot(existing),
    newState: toAuditSnapshot(updated),
    context: {
      fromStatus: existing.status,
      toStatus: "void",
    },
  });

  return updated;
}

/**
 * Retrieves a single invoice by (tenantId, invoiceId), including its line
 * items.
 *
 * @param client    - PoolClient from withTenantContext.
 * @param tenantId  - The tenant UUID.
 * @param invoiceId - UUID of the invoice.
 * @returns { invoice, lineItems } on success, or NotFoundError.
 */
export async function getInvoice(
  client: PoolClient,
  tenantId: string,
  invoiceId: string
): Promise<{ invoice: InvoiceRow; lineItems: InvoiceLineItemRow[] } | NotFoundError> {
  const invoice = await fetchInvoiceRow(client, tenantId, invoiceId);

  if (!invoice) {
    return {
      code: "NOT_FOUND",
      message: `Invoice '${invoiceId}' not found in tenant '${tenantId}'.`,
    };
  }

  const { rows: lineItems } = await client.query<InvoiceLineItemRow>(
    `SELECT ${LINE_ITEM_COLUMNS}
       FROM invoice_line_items
      WHERE tenant_id  = $1
        AND invoice_id = $2
      ORDER BY created_at ASC`,
    [tenantId, invoiceId]
  );

  return { invoice, lineItems };
}

/**
 * Lists invoices for a tenant with optional filters and pagination.
 *
 * Task 7.2 pagination contract: { items, total, limit, offset }.
 * limit defaults to 50, max 200. offset defaults to 0.
 *
 * @param client     - PoolClient from withTenantContext.
 * @param tenantId   - The tenant UUID.
 * @param filters    - Optional { status?, billingCustomerId?, subscriptionId? }
 * @param pagination - Optional { limit?, offset? }
 * @returns Paginated result or ValidationError.
 */
export async function listInvoices(
  client: PoolClient,
  tenantId: string,
  filters?: {
    status?: InvoiceRow["status"];
    billingCustomerId?: string;
    subscriptionId?: string;
  },
  pagination?: { limit?: number; offset?: number }
): Promise<
  | { items: InvoiceRow[]; total: number; limit: number; offset: number }
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
  if (filters?.subscriptionId !== undefined) {
    conditions.push(`subscription_id = $${values.length + 1}`);
    values.push(filters.subscriptionId);
  }

  const whereClause = conditions.join(" AND ");

  const countResult = await client.query<{ count: string }>(
    `SELECT count(*) FROM invoices WHERE ${whereClause}`,
    values
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const limitParam = values.length + 1;
  const offsetParam = values.length + 2;
  const queryValues = [...values, finalLimit, offsetVal];

  const { rows } = await client.query<InvoiceRow>(
    `SELECT ${INVOICE_COLUMNS}
       FROM invoices
      WHERE ${whereClause}
      ORDER BY created_at DESC
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

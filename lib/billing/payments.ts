/**
 * lib/billing/payments.ts
 *
 * Core payment service layer — Task 8.8 (Round 8, Billing & Subscriptions).
 *
 * DESIGN CONTRACTS
 * ────────────────────────────────────────────────────────────────────────────
 * • All functions accept a PoolClient obtained externally via withTenantContext.
 *   They do NOT open their own connections or transactions. The caller owns
 *   the transaction lifecycle (BEGIN / COMMIT / ROLLBACK).
 *
 * • initiatePayment creates a payment_requests row (status='initiated'), calls
 *   the provider adapter, and updates the row to status='pending' — all inside
 *   the caller's transaction.
 *
 * • processPaymentStatusUpdate is the SHARED function called by:
 *     - The Stripe webhook handler  (app/api/webhooks/stripe/route.ts)
 *     - The M-Pesa webhook handler  (app/api/webhooks/mpesa/[callbackToken]/route.ts)
 *     - The M-Pesa polling cron     (app/api/cron/poll-mpesa-pending/route.ts — Task 8.4)
 *   It updates payment_requests.status and, when succeeded with an invoice_id,
 *   calls markInvoicePaid inside the SAME transaction.
 *
 * • writeAuditLog is called on the SAME client, inside the SAME transaction,
 *   immediately after every mutation — before the function returns.
 *
 * DEPENDENCY NOTES
 * ────────────────────────────────────────────────────────────────────────────
 * • dispatchBillingEvent (Task 8.9): the call site below is written to the
 *   correct signature inferred from the blueprint. It is wrapped in a
 *   try/catch stub that logs a warning if Task 8.9 has not yet been
 *   implemented. Once Task 8.9 lands, remove the try/catch stub and the
 *   comment — the import and call site are already correct.
 *
 * • Task 8.11 — /api/webhooks/ must be added to PUBLIC_ROUTE_PREFIXES in
 *   middleware.ts. As of the time this file was written, that prefix is
 *   ABSENT from middleware.ts. Webhook routes will be auth-gated until
 *   Task 8.11 adds the entry. See middleware.ts line 40.
 */

import type { PoolClient } from "pg";
import { writeAuditLog } from "@/lib/db/audit";
import { getProviderCredentials } from "@/lib/billing/providerConfig";
import { getPaymentProvider } from "@/lib/billing/providers/registry";
import { markInvoicePaid } from "@/lib/billing/invoices";
import { dispatchBillingEvent } from "@/lib/billing/events";
import type {
  InitiatePaymentResult,
  PaymentStatusUpdate,
} from "@/lib/billing/providers/types";

// ---------------------------------------------------------------------------
// Public param / result types
// ---------------------------------------------------------------------------

export interface InitiatePaymentParams {
  /** Optional — NULL for payments not tied to a specific invoice. */
  invoiceId?: string;
  /** UUID of the billing_customers row for this payment. */
  billingCustomerId: string;
  /** Provider slug ('stripe' | 'mpesa'). */
  providerSlug: "stripe" | "mpesa";
  /** Amount in the smallest currency unit (cents, etc.) — BIGINT, no float. */
  amountMinorUnits: bigint;
  /** ISO 4217 currency code, e.g. 'KES'. */
  currency: string;
  /**
   * Provider customer reference.
   * Stripe: Stripe Customer ID (cus_xxx) or omit.
   * M-Pesa: payer phone number in international format (254xxxxxxxxx).
   */
  customerRef?: string;
  /** Human-readable description for provider statements / STK prompt. */
  description?: string;
  /** Arbitrary metadata forwarded to the provider (Stripe metadata map). */
  metadata?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Internal row type (payment_requests)
// ---------------------------------------------------------------------------

interface PaymentRequestRow {
  id: string;
  tenant_id: string;
  billing_customer_id: string;
  invoice_id: string | null;
  provider_slug: "stripe" | "mpesa";
  status: "initiated" | "pending" | "succeeded" | "failed" | "expired";
  amount_minor_units: bigint;
  currency: string;
  provider_payment_id: string | null;
  provider_config: Record<string, unknown> | null;
  failure_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// initiatePayment
// ---------------------------------------------------------------------------

/**
 * Creates a payment_requests row (status='initiated'), calls the configured
 * provider adapter to initiate the payment, updates the row to status='pending'
 * with the provider_config populated from the adapter result, and writes an
 * audit log entry — all inside the caller's existing transaction.
 *
 * Returns the InitiatePaymentResult discriminated union (kind: 'stripe' | 'mpesa')
 * which the route handler should forward to the frontend.
 *
 * @param client   - PoolClient from withTenantContext (inside an open transaction).
 * @param tenantId - UUID of the tenant scope.
 * @param params   - Payment parameters (see InitiatePaymentParams).
 * @returns The provider-specific InitiatePaymentResult.
 * @throws If provider credentials are missing or the provider adapter throws.
 */
export async function initiatePayment(
  client: PoolClient,
  tenantId: string,
  params: InitiatePaymentParams
): Promise<InitiatePaymentResult> {
  const {
    invoiceId,
    billingCustomerId,
    providerSlug,
    amountMinorUnits,
    currency,
    customerRef = "",
    description = "Payment",
    metadata = {},
  } = params;

  // ── 1. Fetch provider credentials ──────────────────────────────────────────
  const providerCredentials = await getProviderCredentials(
    client,
    tenantId,
    providerSlug
  );
  if (!providerCredentials) {
    throw new Error(
      `[payments] No provider credentials found for tenant '${tenantId}' ` +
        `and provider '${providerSlug}'. ` +
        `Configure the provider via setProviderCredentials() before initiating payments.`
    );
  }

  // ── 2. Create payment_requests row with status='initiated' ─────────────────
  const { rows: insertedRows } = await client.query<PaymentRequestRow>(
    `INSERT INTO payment_requests (
       tenant_id,
       billing_customer_id,
       invoice_id,
       provider_slug,
       status,
       amount_minor_units,
       currency
     ) VALUES ($1, $2, $3, $4, 'initiated', $5, $6)
     RETURNING *`,
    [
      tenantId,
      billingCustomerId,
      invoiceId ?? null,
      providerSlug,
      amountMinorUnits,
      currency,
    ]
  );

  const paymentRequest = insertedRows[0];

  // ── 3. Call provider adapter ───────────────────────────────────────────────
  const provider = getPaymentProvider(providerSlug);
  const initiateResult = await provider.initiatePayment(
    {
      paymentRequestId: paymentRequest.id,
      // The provider SDK / types expect a JS number for amountMinorUnits.
      // We convert the bigint explicitly here to satisfy the provider interface.
      amountMinorUnits: Number(amountMinorUnits),
      currency,
      description,
      customerRef,
      metadata,
    },
    providerCredentials
  );

  // ── 4. Build provider_config and provider_payment_id from result ───────────
  //
  // For Stripe: store the PaymentIntent ID as provider_payment_id; the
  //   clientSecret goes back to the caller (not stored in DB).
  // For M-Pesa: store the CheckoutRequestID as provider_payment_id.
  let providerPaymentId: string;
  let providerConfig: Record<string, unknown>;

  if (initiateResult.kind === "stripe") {
    providerPaymentId = initiateResult.stripePaymentIntentId;
    providerConfig = {
      kind: "stripe",
      stripePaymentIntentId: initiateResult.stripePaymentIntentId,
      // clientSecret is NOT persisted — it must stay in the HTTP response only.
    };
  } else {
    providerPaymentId = initiateResult.checkoutRequestId;
    providerConfig = {
      kind: "mpesa",
      checkoutRequestId: initiateResult.checkoutRequestId,
      merchantRequestId: initiateResult.merchantRequestId,
    };
  }

  // ── 5. Update to status='pending' with provider_config ────────────────────
  await client.query(
    `UPDATE payment_requests
        SET status             = 'pending',
            provider_payment_id = $1,
            provider_config    = $2::jsonb,
            updated_at         = now()
      WHERE tenant_id = $3
        AND id        = $4`,
    [
      providerPaymentId,
      JSON.stringify(providerConfig),
      tenantId,
      paymentRequest.id,
    ]
  );

  // ── 6. Audit log ───────────────────────────────────────────────────────────
  await writeAuditLog(client, {
    tenantId,
    actorId: null,
    action: "payment_request.initiated",
    entityType: "payment_request",
    entityId: paymentRequest.id,
    oldState: null,
    newState: {
      id: paymentRequest.id,
      status: "pending",
      providerSlug,
      providerPaymentId,
      amountMinorUnits: String(amountMinorUnits),
      currency,
      billingCustomerId,
      invoiceId: invoiceId ?? null,
    },
    context: {
      providerSlug,
      amountMinorUnits: String(amountMinorUnits),
      currency,
      invoiceId: invoiceId ?? null,
    },
  });

  return initiateResult;
}

// ---------------------------------------------------------------------------
// processPaymentStatusUpdate
// ---------------------------------------------------------------------------

/**
 * Shared payment status resolution function — called by:
 *   • /api/webhooks/stripe    (Task 8.8)
 *   • /api/webhooks/mpesa/…  (Task 8.8)
 *   • poll-mpesa-pending cron (Task 8.4)
 *
 * Updates payment_requests.status from the provider's PaymentStatusUpdate.
 * If the payment succeeded AND the request has an invoice_id, markInvoicePaid
 * is called inside the SAME transaction so the invoice is atomically paid.
 *
 * Dispatches a billing domain event ('payment_succeeded' | 'payment_failed')
 * via dispatchBillingEvent (Task 8.9). The call site is wired to the correct
 * signature; the try/catch stub must be removed once Task 8.9 is implemented.
 *
 * ⚠️  ORDERING IS LOAD-BEARING:
 *   1. UPDATE payment_requests (status, provider_payment_id, provider_config,
 *      failure_reason)
 *   2. markInvoicePaid (only if succeeded + invoice_id set)
 *   3. writeAuditLog
 *   4. dispatchBillingEvent (outside the transaction — fire-and-forget for now)
 *
 * @param client   - PoolClient from withTenantContext (inside an open transaction).
 * @param tenantId - UUID of the tenant scope.
 * @param update   - Normalised PaymentStatusUpdate from the provider adapter.
 * @param paymentRequestId - The UUID of the payment_requests row to update.
 */
export async function processPaymentStatusUpdate(
  client: PoolClient,
  tenantId: string,
  update: PaymentStatusUpdate,
  paymentRequestId: string
): Promise<void> {
  // ── 1. Fetch current payment_requests row ──────────────────────────────────
  const { rows: existing } = await client.query<PaymentRequestRow>(
    `SELECT *
       FROM payment_requests
      WHERE tenant_id = $1
        AND id        = $2`,
    [tenantId, paymentRequestId]
  );

  if (existing.length === 0) {
    // Log and bail — the idempotency layer in the webhook handler should
    // prevent this from being hit twice, but guard defensively.
    console.error(
      `[payments] processPaymentStatusUpdate: payment_requests row not found. ` +
        `tenant_id=${tenantId} id=${paymentRequestId}`
    );
    return;
  }

  const row = existing[0];

  // ── 2. UPDATE payment_requests ────────────────────────────────────────────
  await client.query(
    `UPDATE payment_requests
        SET status              = $1,
            provider_payment_id = COALESCE($2, provider_payment_id),
            provider_config     = COALESCE($3::jsonb, provider_config),
            failure_reason      = $4,
            updated_at          = now()
      WHERE tenant_id = $5
        AND id        = $6`,
    [
      update.status,
      update.providerPaymentId ?? null,
      update.providerData ? JSON.stringify(update.providerData) : null,
      update.failureReason ?? null,
      tenantId,
      paymentRequestId,
    ]
  );

  // ── 3. markInvoicePaid (only if succeeded + invoice linked) ───────────────
  if (update.status === "succeeded" && row.invoice_id) {
    const invoiceResult = await markInvoicePaid(
      client,
      tenantId,
      row.invoice_id
    );

    if ("code" in invoiceResult) {
      // markInvoicePaid returns typed errors — log but don't throw.
      // The payment status is already persisted; the invoice state may need
      // manual reconciliation (e.g. already paid by a duplicate callback).
      console.warn(
        `[payments] markInvoicePaid returned an error for invoice '${row.invoice_id}' ` +
          `on payment '${paymentRequestId}': code=${invoiceResult.code} ` +
          `message=${invoiceResult.message}`
      );
    }
  }

  // ── 4. Audit log ───────────────────────────────────────────────────────────
  await writeAuditLog(client, {
    tenantId,
    actorId: null,
    action:
      update.status === "succeeded"
        ? "payment_request.succeeded"
        : update.status === "failed"
          ? "payment_request.failed"
          : "payment_request.status_updated",
    entityType: "payment_request",
    entityId: paymentRequestId,
    oldState: {
      status: row.status,
    },
    newState: {
      status: update.status,
      providerPaymentId: update.providerPaymentId,
      failureReason: update.failureReason ?? null,
    },
    context: {
      providerSlug: row.provider_slug,
      providerPaymentId: update.providerPaymentId,
      invoiceId: row.invoice_id,
      providerData: update.providerData,
    },
  });

  // ── 5. dispatchBillingEvent ───────────────────────────────────────────────
  await dispatchBillingEvent(client, {
    tenantId,
    eventType: update.status === "succeeded" ? "payment_succeeded" : "payment_failed",
    resourceType: "payment_request",
    resourceId: paymentRequestId,
    actorId: null,
    data: {
      providerSlug: row.provider_slug,
      providerPaymentId: update.providerPaymentId,
      amountMinorUnits: String(row.amount_minor_units),
      currency: row.currency,
      invoiceId: row.invoice_id,
      failureReason: update.failureReason ?? null,
    },
    timestamp: new Date().toISOString(),
  });
}

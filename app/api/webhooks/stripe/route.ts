/**
 * app/api/webhooks/stripe/route.ts
 *
 * Stripe webhook endpoint — Task 8.8 (Round 8, Billing & Subscriptions).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️  RAW BODY REQUIREMENT (CRITICAL — DO NOT CHANGE THE BODY READ ORDER):
 *
 * Stripe computes `stripe-signature` via HMAC-SHA256 over the EXACT raw bytes
 * of the request body. If any code path calls request.json() or reads the body
 * as anything other than raw text BEFORE verifyWebhook(), the bytes differ and
 * constructEvent() WILL throw — even if the JSON content is semantically
 * identical after parsing.
 *
 * This route reads the body via `await request.text()` and passes the raw
 * string to stripeProvider.verifyWebhook() FIRST, before any DB access.
 * Do NOT add request.json() calls, body-parser middleware, or Next.js body
 * parsing helpers above the verifyWebhook() call.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️  PUBLIC ROUTE PREREQUISITE (Task 8.11):
 *
 * This route is under /api/webhooks/ which MUST be listed in PUBLIC_ROUTE_PREFIXES
 * in middleware.ts to bypass JWT auth gating. As of the time this file was
 * written, that entry is ABSENT. Stripe webhooks will receive 302 redirects to
 * /login until Task 8.11 adds "/api/webhooks/" to PUBLIC_ROUTE_PREFIXES.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * EVENT PROCESSING SEQUENCE (load-bearing — do not reorder):
 *
 *   1. Read raw body (request.text()) + stripe-signature header.
 *   2. verifyWebhook() — cryptographic HMAC check. Return 400 on failure.
 *   3. extractPaymentRequestRef() — get internal payment_requests.id from
 *      event metadata.
 *   4. System admin pool lookup (no RLS): SELECT tenant_id FROM payment_requests
 *      WHERE id = $1.  Resolves which tenant owns this payment without a session.
 *   5. withTenantContext(tenantId):
 *        a. INSERT INTO payment_webhook_events (idempotency). If duplicate key
 *           → return 200 immediately, no reprocessing.
 *        b. mapToPaymentUpdate() — map Stripe event to internal status shape.
 *        c. processPaymentStatusUpdate() — update payment_requests + invoice
 *           (all inside the same transaction as the idempotency insert).
 *   6. Return 200 to Stripe (Stripe retries 5xx, not 4xx or 2xx).
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { StripePaymentProvider } from "@/lib/billing/providers/stripe";
import { getProviderCredentials } from "@/lib/billing/providerConfig";
import { getSystemAdminPool } from "@/lib/db/pool";
import { withTenantContext } from "@/lib/db/withTenant";
import { processPaymentStatusUpdate } from "@/lib/billing/payments";
import { ProviderVerificationError } from "@/lib/billing/errors";

const stripeProvider = new StripePaymentProvider();

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── STEP 1: Read raw body and signature header ────────────────────────────
  //
  // request.text() is mandatory — do NOT replace with request.json().
  // See the file-level warning at the top of this module.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (err) {
    console.error("[stripe-webhook] Failed to read request body:", err);
    return NextResponse.json(
      { error: "Failed to read request body." },
      { status: 400 }
    );
  }

  const sigHeader = request.headers.get("stripe-signature");
  if (!sigHeader) {
    console.warn("[stripe-webhook] Missing stripe-signature header.");
    return NextResponse.json(
      { error: "Missing stripe-signature header." },
      { status: 400 }
    );
  }

  // ── STEP 2: Verify webhook signature FIRST — before any DB access ─────────
  //
  // We need provider credentials for the signing secret. At this point we
  // don't yet know the tenant, so we must use the system admin pool to look
  // up the payment request first — but the blueprint specifies verification
  // BEFORE DB access. To satisfy both, we extract the payment request ID from
  // the event after successful verification.
  //
  // Implementation note: Stripe's constructEvent() only needs the webhookSecret
  // (wh_xxx signing secret), not the full tenant credentials. The signing
  // secret is a deployment-level secret (one per Stripe webhook endpoint
  // registration), NOT per-tenant. We read it from STRIPE_WEBHOOK_SECRET env.
  //
  // After extracting the payment request ID and resolving the tenant, we load
  // the per-tenant credentials (secretKey) for subsequent SDK calls if needed.
  // However, verifyWebhook() in the Stripe adapter needs the providerConfig
  // shape with webhookSecret — we satisfy this from the env variable.
  const envWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!envWebhookSecret) {
    console.error(
      "[stripe-webhook] STRIPE_WEBHOOK_SECRET environment variable is not set. " +
        "Configure it with the Stripe webhook endpoint signing secret (wh_xxx)."
    );
    return NextResponse.json(
      { error: "Webhook secret not configured." },
      { status: 500 }
    );
  }

  // Build a minimal ProviderCredentials object for verifyWebhook().
  // secretKey is required by buildStripeClient() — we use the env secret key
  // for signature verification (the SDK needs it even though it's not used in
  // constructEvent itself).
  const envSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!envSecretKey) {
    console.error(
      "[stripe-webhook] STRIPE_SECRET_KEY environment variable is not set."
    );
    return NextResponse.json(
      { error: "Stripe credentials not configured." },
      { status: 500 }
    );
  }

  const verificationCredentials = {
    providerSlug: "stripe" as const,
    credentials: { secretKey: envSecretKey },
    webhookSecret: envWebhookSecret,
  };

  let verifiedEvent: Awaited<ReturnType<typeof stripeProvider.verifyWebhook>>;
  try {
    verifiedEvent = await stripeProvider.verifyWebhook(
      {
        rawBody,
        headers: { "stripe-signature": sigHeader },
      },
      verificationCredentials
    );
  } catch (err) {
    if (err instanceof ProviderVerificationError) {
      console.warn(
        "[stripe-webhook] Webhook verification failed:",
        err.message
      );
      return NextResponse.json(
        { error: "Webhook verification failed." },
        { status: 400 }
      );
    }
    console.error("[stripe-webhook] Unexpected error during verification:", err);
    return NextResponse.json(
      { error: "Internal server error during verification." },
      { status: 500 }
    );
  }

  // ── STEP 3: Extract internal payment_requests.id from the verified event ──
  let paymentRequestId: string;
  try {
    paymentRequestId = stripeProvider.extractPaymentRequestRef(verifiedEvent);
  } catch (err) {
    // The event doesn't carry mis_payment_request_id — not initiated by MIS.
    // Return 400 so the Stripe dashboard flags this event as unprocessed,
    // prompting investigation (e.g. a manually created PaymentIntent).
    console.warn(
      "[stripe-webhook] Could not extract payment request ref from event " +
        `'${verifiedEvent.providerEventId}':`,
      err
    );
    return NextResponse.json(
      { error: "Payment request reference missing from event metadata." },
      { status: 400 }
    );
  }

  // ── STEP 4: Cross-tenant lookup via system admin pool ─────────────────────
  //
  // We have no session here — Stripe posts to this endpoint unauthenticated.
  // The admin pool bypasses RLS and lets us find the tenant that owns this
  // payment_requests row without knowing the tenant_id in advance.
  const adminPool = getSystemAdminPool();
  let tenantId: string;
  try {
    const adminClient = await adminPool.connect();
    let tenantRow: { tenant_id: string } | undefined;
    try {
      const { rows } = await adminClient.query<{ tenant_id: string }>(
        `SELECT tenant_id
           FROM payment_requests
          WHERE id = $1`,
        [paymentRequestId]
      );
      tenantRow = rows[0];
    } finally {
      adminClient.release();
    }

    if (!tenantRow) {
      console.warn(
        `[stripe-webhook] No payment_requests row found for id='${paymentRequestId}'. ` +
          `Event: '${verifiedEvent.providerEventId}'.`
      );
      // Return 200 to Stripe — we can't reprocess what we don't recognise.
      // Returning 400 would cause Stripe to retry indefinitely.
      return NextResponse.json({ received: true }, { status: 200 });
    }
    tenantId = tenantRow.tenant_id;
  } catch (err) {
    console.error(
      "[stripe-webhook] Admin pool lookup for payment request failed:",
      err
    );
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }

  // ── STEP 5: withTenantContext — idempotency + processing ──────────────────
  try {
    await withTenantContext(tenantId, async (client) => {
      // ── 5a. Idempotency INSERT ─────────────────────────────────────────────
      //
      // UNIQUE constraint: (provider_slug, provider_event_id) on
      // payment_webhook_events.  A duplicate key violation means we've already
      // processed this Stripe event — return 200 without reprocessing.
      //
      // The INSERT and processPaymentStatusUpdate share this transaction so
      // that a crash between them cannot leave a dangling idempotency row
      // without the corresponding payment state update.
      try {
        await client.query(
          `INSERT INTO payment_webhook_events (
             tenant_id,
             provider_slug,
             provider_event_id,
             event_type,
             raw_payload
           ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [
            tenantId,
            "stripe",
            verifiedEvent.providerEventId,
            verifiedEvent.eventType,
            JSON.stringify(verifiedEvent.payload),
          ]
        );
      } catch (insertErr: unknown) {
        // PostgreSQL unique violation error code: 23505
        if (
          insertErr !== null &&
          typeof insertErr === "object" &&
          "code" in insertErr &&
          (insertErr as { code: string }).code === "23505"
        ) {
          // Already processed — respond 200 without touching payment_requests.
          console.info(
            `[stripe-webhook] Duplicate event '${verifiedEvent.providerEventId}' — already processed.`
          );
          // Throw a sentinel to break out of withTenantContext cleanly.
          throw Object.assign(new Error("DUPLICATE_EVENT"), {
            isDuplicate: true,
          });
        }
        throw insertErr;
      }

      // ── 5b. Map event to internal payment status update ────────────────────
      const paymentUpdate = stripeProvider.mapToPaymentUpdate(verifiedEvent);

      // ── 5c. Process the status update (updates payment_requests + invoice) ─
      await processPaymentStatusUpdate(
        client,
        tenantId,
        paymentUpdate,
        paymentRequestId
      );
    });
  } catch (err: unknown) {
    if (
      err !== null &&
      typeof err === "object" &&
      "isDuplicate" in err &&
      (err as { isDuplicate: boolean }).isDuplicate
    ) {
      // Duplicate event path — already logged above, return 200.
      return NextResponse.json({ received: true }, { status: 200 });
    }

    console.error(
      "[stripe-webhook] Unexpected error in tenant transaction:",
      err
    );
    // Return 500 so Stripe will retry this event.
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true }, { status: 200 });
}

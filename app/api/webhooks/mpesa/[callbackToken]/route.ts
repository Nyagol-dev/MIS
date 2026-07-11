/**
 * app/api/webhooks/mpesa/[callbackToken]/route.ts
 *
 * M-Pesa (Safaricom Daraja) callback endpoint — Task 8.8 (Round 8).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SECURITY ARCHITECTURE (read before modifying):
 *
 * M-Pesa has NO cryptographic callback authentication equivalent to Stripe's
 * HMAC-SHA256. Safaricom authenticates callbacks by embedding an opaque token
 * in the callback URL path: /api/webhooks/mpesa/<callbackToken>.
 *
 * Defence-in-depth layers (in strict order — do NOT reorder):
 *
 *   Layer 1 — URL token check (FIRST):
 *     params.callbackToken is compared against process.env.MPESA_CALLBACK_TOKEN.
 *     Mismatch → 403 immediately, before reading the request body at all.
 *     This prevents unauthenticated parties from causing any processing.
 *
 *   Layer 2 — IP allowlist check:
 *     The source IP is compared against Safaricom's published callback IP
 *     ranges. A mismatch logs a warning and by default rejects with 403.
 *     The blueprint notes: "confirm with the team whether to still reject or
 *     just log". Default: REJECT (matching the blueprint's sketch). Override
 *     by setting MPESA_IP_ALLOWLIST_ENFORCE=false in the environment.
 *
 *   Layer 3 — Structural parsing:
 *     mpesaProvider.verifyWebhook() validates the JSON shape (not cryptographic
 *     — Daraja provides no HMAC). Malformed bodies → 400.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ACKNOWLEDGMENT SHAPE (Daraja API requirement):
 *
 * Safaricom's Daraja API documentation specifies that the callback URL must
 * respond with HTTP 200 and a JSON body of:
 *   { "ResultCode": 0, "ResultDesc": "Accepted" }
 * on success. Any other response causes Safaricom to mark the callback as
 * failed and potentially retry. We return this shape on ALL 200 responses
 * (including the "already processed" idempotency path).
 *
 * Reference: https://developer.safaricom.co.ke/APIs/MpesaExpressSimulate
 * (Section: "Callback URL Response")
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️  PUBLIC ROUTE PREREQUISITE (Task 8.11):
 *
 * This route is under /api/webhooks/ which MUST be listed in PUBLIC_ROUTE_PREFIXES
 * in middleware.ts to bypass JWT auth gating. As of the time this file was
 * written, that entry is ABSENT. Safaricom callbacks will receive 302 redirects
 * to /login until Task 8.11 adds "/api/webhooks/" to PUBLIC_ROUTE_PREFIXES.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * EVENT PROCESSING SEQUENCE (load-bearing — do not reorder):
 *
 *   1. Check params.callbackToken against MPESA_CALLBACK_TOKEN env. → 403 on
 *      mismatch, before reading the body.
 *   2. IP allowlist check. → 403 on mismatch (configurable — see Layer 2 above).
 *   3. Read raw body. Parse via mpesaProvider.verifyWebhook() (structural only).
 *   4. Extract CheckoutRequestID via extractPaymentRequestRef().
 *   5. System admin pool lookup (no RLS): find tenant_id from payment_requests
 *      WHERE provider_payment_id = $1 (CheckoutRequestID stored at initiation).
 *   6. withTenantContext(tenantId):
 *        a. Idempotency INSERT into payment_webhook_events.
 *           Duplicate key → return Safaricom ack immediately.
 *        b. mapToPaymentUpdate() + processPaymentStatusUpdate(), same transaction.
 *   7. Return Safaricom's expected ack: { ResultCode: 0, ResultDesc: "Accepted" }.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { MpesaPaymentProvider } from "@/lib/billing/providers/mpesa";
import { getSystemAdminPool } from "@/lib/db/pool";
import { withTenantContext } from "@/lib/db/withTenant";
import { processPaymentStatusUpdate } from "@/lib/billing/payments";
import { ProviderVerificationError } from "@/lib/billing/errors";

const mpesaProvider = new MpesaPaymentProvider();

/**
 * Safaricom's published IP ranges for STK callback requests.
 *
 * Source: Safaricom Daraja developer documentation.
 * https://developer.safaricom.co.ke/Documentation
 *
 * These are the production IP ranges as documented. The sandbox may use
 * different IPs — in sandbox/dev environments, set MPESA_IP_ALLOWLIST_ENFORCE=false
 * to skip enforcement while still logging the mismatch.
 *
 * Review and update these when Safaricom publishes IP range changes.
 */
const SAFARICOM_IP_ALLOWLIST: readonly string[] = [
  "196.201.214.200",
  "196.201.214.206",
  "196.201.213.114",
  "196.201.214.207",
  "196.201.214.208",
  "196.201.213.44",
  "196.201.212.127",
  "196.201.212.138",
  "196.201.212.129",
  "196.201.212.136",
  "196.201.212.74",
  "196.201.212.69",
];

/**
 * Safaricom's expected acknowledgment JSON body.
 * Daraja requires ResultCode=0 + ResultDesc="Accepted" on all successful receipts.
 * Reference: https://developer.safaricom.co.ke/APIs/MpesaExpressSimulate
 */
const SAFARICOM_ACK = { ResultCode: 0, ResultDesc: "Accepted" } as const;

/**
 * Extracts the real client IP from the request, respecting the
 * X-Forwarded-For header used by Vercel and other reverse proxies.
 * Returns undefined if no IP can be determined.
 */
function getClientIp(request: NextRequest): string | undefined {
  // Vercel sets x-real-ip; many load balancers set x-forwarded-for.
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    // X-Forwarded-For can be a comma-separated list; first entry is the client.
    return xff.split(",")[0]?.trim();
  }
  return request.headers.get("x-real-ip") ?? undefined;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { callbackToken: string } }
): Promise<NextResponse> {
  // ── STEP 1: URL token check — FIRST, before touching the request body ──────
  //
  // Compare the URL-embedded token against the environment secret.
  // This is Layer 1 of the defence-in-depth; reject immediately on mismatch.
  const expectedToken = process.env.MPESA_CALLBACK_TOKEN;
  if (!expectedToken) {
    // Misconfiguration: the server hasn't been configured with a callback token.
    // Reject to prevent any processing without the secret.
    console.error(
      "[mpesa-webhook] MPESA_CALLBACK_TOKEN environment variable is not set. " +
        "All M-Pesa callbacks will be rejected until this is configured."
    );
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (params.callbackToken !== expectedToken) {
    // Log the mismatch at warn level (not error — likely a probe or spoofed request).
    console.warn(
      `[mpesa-webhook] Callback token mismatch. ` +
        `Received token does not match MPESA_CALLBACK_TOKEN. Rejecting.`
    );
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // ── STEP 2: IP allowlist check (defence-in-depth Layer 2) ─────────────────
  //
  // By default this rejects on mismatch. Set MPESA_IP_ALLOWLIST_ENFORCE=false
  // to log-only (useful for sandbox/dev environments where Safaricom uses
  // different egress IPs or ngrok tunnels are in use).
  const enforce = process.env.MPESA_IP_ALLOWLIST_ENFORCE !== "false";
  const clientIp = getClientIp(request);

  if (clientIp && !SAFARICOM_IP_ALLOWLIST.includes(clientIp)) {
    console.warn(
      `[mpesa-webhook] IP allowlist mismatch. ` +
        `Source IP '${clientIp}' is not in the Safaricom IP allowlist. ` +
        (enforce
          ? "Rejecting (MPESA_IP_ALLOWLIST_ENFORCE=true)."
          : "Logging only (MPESA_IP_ALLOWLIST_ENFORCE=false).")
    );
    if (enforce) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
  } else if (!clientIp) {
    console.warn(
      "[mpesa-webhook] Could not determine client IP — skipping IP allowlist check."
    );
  }

  // ── STEP 3: Read raw body and parse via verifyWebhook (structural) ─────────
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (err) {
    console.error("[mpesa-webhook] Failed to read request body:", err);
    return NextResponse.json(
      { error: "Failed to read request body." },
      { status: 400 }
    );
  }

  // verifyWebhook() for M-Pesa does NOT perform cryptographic verification —
  // it validates the structural shape of the Daraja callback JSON.
  // Authentication was already established in Steps 1 and 2 above.
  let verifiedEvent: Awaited<ReturnType<typeof mpesaProvider.verifyWebhook>>;
  try {
    verifiedEvent = await mpesaProvider.verifyWebhook(
      {
        rawBody,
        headers: Object.fromEntries(request.headers.entries()),
      },
      // providerConfig is accepted by the interface for conformance; M-Pesa
      // structural parsing does not require credentials. Pass a minimal shape.
      {
        providerSlug: "mpesa",
        credentials: {},
      }
    );
  } catch (err) {
    if (err instanceof ProviderVerificationError) {
      console.warn(
        "[mpesa-webhook] Structural verification of callback failed:",
        err.message
      );
      return NextResponse.json(
        { error: "Invalid callback payload." },
        { status: 400 }
      );
    }
    console.error("[mpesa-webhook] Unexpected error during body parsing:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }

  // ── STEP 4: Extract CheckoutRequestID (stored as provider_payment_id) ─────
  //
  // For M-Pesa, extractPaymentRequestRef() returns the CheckoutRequestID.
  // At initiatePayment() time, we store this as payment_requests.provider_payment_id.
  // The admin pool lookup in Step 5 queries by provider_payment_id.
  let checkoutRequestId: string;
  try {
    checkoutRequestId = mpesaProvider.extractPaymentRequestRef(verifiedEvent);
  } catch (err) {
    console.warn(
      "[mpesa-webhook] Could not extract CheckoutRequestID from callback:",
      err
    );
    // Return Safaricom's ack anyway — we can't reprocess what we don't understand,
    // and returning a non-200 will cause Safaricom to retry indefinitely.
    return NextResponse.json(SAFARICOM_ACK, { status: 200 });
  }

  // ── STEP 5: Cross-tenant lookup via system admin pool ─────────────────────
  //
  // provider_payment_id stores the CheckoutRequestID at initiatePayment() time
  // (see payments.ts).  We query by it cross-tenant to find the owning tenant.
  const adminPool = getSystemAdminPool();
  let tenantId: string;
  let paymentRequestId: string;

  try {
    const adminClient = await adminPool.connect();
    let row: { id: string; tenant_id: string } | undefined;
    try {
      const { rows } = await adminClient.query<{ id: string; tenant_id: string }>(
        `SELECT id, tenant_id
           FROM payment_requests
          WHERE provider_payment_id = $1`,
        [checkoutRequestId]
      );
      row = rows[0];
    } finally {
      adminClient.release();
    }

    if (!row) {
      console.warn(
        `[mpesa-webhook] No payment_requests row found for ` +
          `provider_payment_id (CheckoutRequestID) = '${checkoutRequestId}'.`
      );
      // Return Safaricom's ack — returning a non-200 would cause retries for
      // a payment we don't recognise.
      return NextResponse.json(SAFARICOM_ACK, { status: 200 });
    }
    tenantId = row.tenant_id;
    paymentRequestId = row.id;
  } catch (err) {
    console.error(
      "[mpesa-webhook] Admin pool lookup for payment request failed:",
      err
    );
    // Return 200 + ack to Safaricom to prevent retries; the payment status
    // will be resolved by the polling cron (Task 8.4).
    return NextResponse.json(SAFARICOM_ACK, { status: 200 });
  }

  // ── STEP 6: withTenantContext — idempotency + processing ──────────────────
  try {
    await withTenantContext(tenantId, async (client) => {
      // ── 6a. Idempotency INSERT ─────────────────────────────────────────────
      //
      // CheckoutRequestID is used as the idempotency key (provider_event_id).
      // This is unique per STK Push request on the Safaricom side, so it
      // reliably deduplicates duplicate callbacks.
      //
      // UNIQUE constraint: (provider_slug, provider_event_id) on
      // payment_webhook_events. Duplicate key violation → already processed.
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
            "mpesa",
            checkoutRequestId,   // CheckoutRequestID = provider_event_id
            verifiedEvent.eventType,
            JSON.parse(rawBody), // Store parsed JSON; rawBody is valid JSON at this point
          ]
        );
      } catch (insertErr: unknown) {
        // PostgreSQL unique violation: 23505
        if (
          insertErr !== null &&
          typeof insertErr === "object" &&
          "code" in insertErr &&
          (insertErr as { code: string }).code === "23505"
        ) {
          console.info(
            `[mpesa-webhook] Duplicate callback for CheckoutRequestID '${checkoutRequestId}' — already processed.`
          );
          throw Object.assign(new Error("DUPLICATE_EVENT"), {
            isDuplicate: true,
          });
        }
        throw insertErr;
      }

      // ── 6b. Map callback to internal status update ─────────────────────────
      const paymentUpdate = mpesaProvider.mapToPaymentUpdate(verifiedEvent);

      // ── 6c. Process the status update (same transaction as idempotency row) ─
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
      // Duplicate event — already processed; return Safaricom's ack.
      return NextResponse.json(SAFARICOM_ACK, { status: 200 });
    }

    console.error(
      "[mpesa-webhook] Unexpected error in tenant transaction:",
      err
    );
    // Return Safaricom's ack on unexpected errors to prevent infinite retries.
    // The polling cron (Task 8.4) will reconcile if the payment state is inconsistent.
    return NextResponse.json(SAFARICOM_ACK, { status: 200 });
  }

  // ── STEP 7: Return Safaricom's expected acknowledgment ────────────────────
  //
  // Daraja requires: HTTP 200 + { ResultCode: 0, ResultDesc: "Accepted" }
  // Reference: https://developer.safaricom.co.ke/APIs/MpesaExpressSimulate
  return NextResponse.json(SAFARICOM_ACK, { status: 200 });
}

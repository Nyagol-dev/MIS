/**
 * Stripe implementation of the PaymentProvider interface.
 *
 * @see lib/billing/providers/types.ts — interface contract
 * @see Documentation/round8_billing_blueprint.md §Q2, §Q3
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️  RAW BODY REQUIREMENT FOR verifyWebhook (MUST READ — Task 8.8 caller):
 *
 * Stripe computes its `stripe-signature` header using HMAC-SHA256 over the
 * exact raw bytes of the request body.  If Next.js (or any middleware) has
 * already consumed or re-serialized the body via request.json() / request.body,
 * the bytes will differ and constructEvent() WILL throw — even if the JSON
 * content is semantically identical.
 *
 * The route handler at /api/webhooks/stripe (Task 8.8) MUST:
 *   1. NOT call request.json() anywhere before verifyWebhook().
 *   2. Read the raw body with:   const rawBody = await request.text();
 *   3. Pass it as:               { rawBody, headers: { ... } }
 *
 * Next.js App Router route handlers do NOT automatically parse the body, so
 * a plain `export async function POST(request: Request)` is safe, BUT you
 * must ensure no middleware (e.g., a global body-parser) runs before this
 * route.  Document this in the route handler file.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Stripe from "stripe";
import { ProviderVerificationError } from "@/lib/billing/errors";
import type {
  PaymentProvider,
  InitiatePaymentParams,
  InitiatePaymentResult,
  WebhookVerificationInput,
  VerifiedProviderEvent,
  PaymentStatusUpdate,
} from "@/lib/billing/providers/types";
import type { ProviderCredentials } from "@/lib/billing/providerConfig";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds a Stripe SDK client from the decrypted tenant provider credentials.
 *
 * The tenant's secret key lives in credentials.secretKey (the key name is
 * a convention — see setProviderCredentials() call sites).
 */
function buildStripeClient(providerConfig: ProviderCredentials): Stripe {
  const secretKey = providerConfig.credentials["secretKey"];
  if (!secretKey) {
    throw new Error(
      "[stripe] ProviderCredentials.credentials must contain a 'secretKey' field."
    );
  }
  return new Stripe(secretKey, {
    // Pin to the API version used during development so upgrades are explicit.
    apiVersion: "2026-06-24.dahlia",
    typescript: true,
  });
}

// ---------------------------------------------------------------------------
// Stripe-specific event payload narrowing helpers
// ---------------------------------------------------------------------------

/**
 * Asserts that the event payload is a Stripe.Event.
 * Used internally after constructEvent() to keep the rest of the code typed.
 */
function asStripeEvent(event: VerifiedProviderEvent): Stripe.Event {
  // constructEvent() guarantees the shape; this cast is safe.
  return event.payload as Stripe.Event;
}

/**
 * Extracts the PaymentIntent from supported Stripe event types.
 * Throws for event types that don't carry a PaymentIntent as data.object.
 */
function extractPaymentIntent(stripeEvent: Stripe.Event): Stripe.PaymentIntent {
  const obj = stripeEvent.data.object;
  if (
    stripeEvent.type === "payment_intent.succeeded" ||
    stripeEvent.type === "payment_intent.payment_failed" ||
    stripeEvent.type === "payment_intent.canceled"
  ) {
    return obj as Stripe.PaymentIntent;
  }
  throw new Error(
    `[stripe] mapToPaymentUpdate received unsupported event type '${stripeEvent.type}'. ` +
      `Only payment_intent.succeeded and payment_intent.payment_failed are mapped in Round 8.`
  );
}

// ---------------------------------------------------------------------------
// StripePaymentProvider
// ---------------------------------------------------------------------------

/**
 * Stripe implementation of PaymentProvider.
 *
 * Instantiate via getPaymentProvider('stripe') — do NOT construct directly
 * outside of the registry or tests.
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly slug = "stripe" as const;

  // ── initiatePayment ────────────────────────────────────────────────────────

  /**
   * Creates a Stripe PaymentIntent for the given amount and currency.
   *
   * metadata.mis_payment_request_id is set to params.paymentRequestId so that
   * the webhook handler (Task 8.8) can resolve the internal payment_requests row
   * from the Stripe event without any additional cross-reference store.
   *
   * The returned clientSecret is forwarded to the frontend so Stripe.js can
   * confirm the payment (stripe.confirmPayment()).  The card details never
   * touch the MIS server.
   */
  async initiatePayment(
    params: InitiatePaymentParams,
    providerConfig: ProviderCredentials
  ): Promise<InitiatePaymentResult> {
    const stripe = buildStripeClient(providerConfig);

    const intent = await stripe.paymentIntents.create({
      amount: params.amountMinorUnits,
      currency: params.currency.toLowerCase(), // Stripe expects lowercase ISO 4217
      description: params.description,
      customer: params.customerRef || undefined, // Stripe Customer ID (cus_xxx) or omit
      metadata: {
        // Caller-supplied metadata merged with the critical MIS reference.
        ...params.metadata,
        // This field is how the webhook (Task 8.8) maps the Stripe event back
        // to the internal payment_requests row and its tenant_id.
        mis_payment_request_id: params.paymentRequestId,
      },
      // automatic_payment_methods lets Stripe present the appropriate payment
      // UI without hardcoding card as the only method.
      automatic_payment_methods: { enabled: true },
    });

    if (!intent.client_secret) {
      // In practice this only happens for immediate captures — should not occur
      // with automatic_payment_methods enabled, but guard defensively.
      throw new Error(
        `[stripe] PaymentIntent ${intent.id} was created without a client_secret. ` +
          `This is unexpected for a standard card payment flow.`
      );
    }

    return {
      kind: "stripe",
      clientSecret: intent.client_secret,
      stripePaymentIntentId: intent.id,
    };
  }

  // ── verifyWebhook ──────────────────────────────────────────────────────────

  /**
   * Verifies the Stripe webhook signature and returns the parsed event.
   *
   * ⚠️  input.rawBody MUST be the exact raw request body string — NOT parsed
   * JSON.  See the file-level warning at the top of this module.
   *
   * The webhook signing secret used here is the per-deployment secret from
   * Stripe's webhook endpoint configuration (Dashboard → Webhooks → Signing
   * secret).  It is NOT the tenant's Stripe secret key — it is stored in
   * providerConfig.webhookSecret (populated from tenant_provider_configs.
   * webhook_secret, which holds the wh_xxx signing secret).
   *
   * @throws {ProviderVerificationError} if constructEvent() rejects the signature.
   */
  async verifyWebhook(
    input: WebhookVerificationInput,
    providerConfig: ProviderCredentials
  ): Promise<VerifiedProviderEvent> {
    const stripe = buildStripeClient(providerConfig);

    const sigHeader = input.headers["stripe-signature"];
    const sigString = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;

    if (!sigString) {
      throw new ProviderVerificationError(
        "stripe",
        new Error("Missing 'stripe-signature' header.")
      );
    }

    if (!providerConfig.webhookSecret) {
      throw new ProviderVerificationError(
        "stripe",
        new Error(
          "No webhookSecret configured for this Stripe provider. " +
            "Set tenant_provider_configs.webhook_secret to the Stripe endpoint signing secret."
        )
      );
    }

    let stripeEvent: Stripe.Event;
    try {
      // constructEvent() performs HMAC-SHA256 verification and timestamp replay
      // attack prevention.  It MUST receive the raw body string — see warning.
      stripeEvent = stripe.webhooks.constructEvent(
        input.rawBody,
        sigString,
        providerConfig.webhookSecret
      );
    } catch (err) {
      throw new ProviderVerificationError("stripe", err);
    }

    return {
      providerSlug: "stripe",
      providerEventId: stripeEvent.id,
      eventType: stripeEvent.type,
      payload: stripeEvent,
    };
  }

  // ── extractPaymentRequestRef ───────────────────────────────────────────────

  /**
   * Reads metadata.mis_payment_request_id from the PaymentIntent embedded in
   * the Stripe event.
   *
   * This field is written by initiatePayment() at PaymentIntent creation time.
   * The webhook handler (Task 8.8) uses this value to look up payment_requests
   * via the system admin pool, resolving the tenant_id without a session.
   *
   * @returns The internal payment_requests.id UUID string.
   * @throws if the event type is unsupported or the metadata field is absent.
   */
  extractPaymentRequestRef(event: VerifiedProviderEvent): string {
    const stripeEvent = asStripeEvent(event);
    const intent = extractPaymentIntent(stripeEvent);

    const ref = intent.metadata?.["mis_payment_request_id"];
    if (!ref) {
      throw new Error(
        `[stripe] PaymentIntent ${intent.id} is missing metadata.mis_payment_request_id. ` +
          `This field must be set at PaymentIntent creation via initiatePayment().`
      );
    }
    return ref;
  }

  // ── mapToPaymentUpdate ─────────────────────────────────────────────────────

  /**
   * Maps a verified Stripe event to the internal PaymentStatusUpdate shape.
   *
   * Supported event types in Round 8:
   *   payment_intent.succeeded       → status: 'succeeded'
   *   payment_intent.payment_failed  → status: 'failed' (with failureReason)
   *
   * Other event types are unsupported: they surface an explicit error rather
   * than silently returning a fallback status, so the webhook handler can
   * return HTTP 400 and the event subscription in Stripe can be investigated.
   */
  mapToPaymentUpdate(event: VerifiedProviderEvent): PaymentStatusUpdate {
    const stripeEvent = asStripeEvent(event);
    const intent = extractPaymentIntent(stripeEvent);

    const providerData: Record<string, unknown> = {
      stripeEventId: stripeEvent.id,
      stripeEventType: stripeEvent.type,
      paymentIntentId: intent.id,
      amount: intent.amount,
      currency: intent.currency,
      status: intent.status,
    };

    switch (stripeEvent.type) {
      case "payment_intent.succeeded":
        return {
          providerPaymentId: intent.id,
          status: "succeeded",
          providerData,
        };

      case "payment_intent.payment_failed": {
        const lastError = intent.last_payment_error;
        return {
          providerPaymentId: intent.id,
          status: "failed",
          providerData: {
            ...providerData,
            lastPaymentError: lastError
              ? {
                  code: lastError.code,
                  message: lastError.message,
                  declineCode: lastError.decline_code ?? null,
                }
              : null,
          },
          failureReason:
            lastError?.message ??
            "Payment failed — no additional details from Stripe.",
        };
      }

      default:
        // extractPaymentIntent() already validated the type — this is unreachable
        // in practice, but TypeScript exhaustiveness requires a default.
        throw new Error(
          `[stripe] mapToPaymentUpdate: unhandled event type '${stripeEvent.type}'.`
        );
    }
  }

  // ── queryPaymentStatus ─────────────────────────────────────────────────────

  /**
   * Retrieves a PaymentIntent directly from Stripe by ID.
   *
   * Primary use: reconciliation — compare the live Stripe status against the
   * MIS database state.  For Stripe, this is NOT the primary resolution path
   * (webhooks are), but it is useful for:
   *   - Admin reconciliation jobs.
   *   - Detecting stuck PaymentIntents that never triggered a webhook.
   *
   * @param providerPaymentId - The Stripe PaymentIntent ID (pi_xxx).
   */
  async queryPaymentStatus(
    providerPaymentId: string,
    providerConfig: ProviderCredentials
  ): Promise<PaymentStatusUpdate> {
    const stripe = buildStripeClient(providerConfig);

    const intent = await stripe.paymentIntents.retrieve(providerPaymentId);

    const providerData: Record<string, unknown> = {
      paymentIntentId: intent.id,
      amount: intent.amount,
      currency: intent.currency,
      status: intent.status,
      createdAt: intent.created,
    };

    // Map Stripe's fine-grained status to the internal four-state model.
    let internalStatus: PaymentStatusUpdate["status"];
    switch (intent.status) {
      case "succeeded":
        internalStatus = "succeeded";
        break;
      case "canceled":
        internalStatus = "failed"; // canceled by Stripe is treated as failed internally
        break;
      case "requires_payment_method":
      case "requires_action":
      case "processing":
      case "requires_capture":
      case "requires_confirmation":
        internalStatus = "pending";
        break;
      default:
        internalStatus = "pending";
    }

    const lastError = intent.last_payment_error;
    return {
      providerPaymentId: intent.id,
      status: internalStatus,
      providerData,
      ...(internalStatus === "failed" && lastError?.message
        ? { failureReason: lastError.message }
        : {}),
    };
  }
}

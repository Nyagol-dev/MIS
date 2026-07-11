/**
 * Payment provider abstraction — type contracts.
 *
 * All shapes are taken verbatim from the Round 8 billing blueprint §Q2.
 * Do NOT modify these shapes without a corresponding blueprint update.
 *
 * @see Documentation/round8_billing_blueprint.md §Q2
 */

// Re-export the canonical ProviderCredentials from providerConfig so every
// consumer of the billing provider layer imports from one place.
export type { ProviderCredentials } from "@/lib/billing/providerConfig";

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

/**
 * Parameters passed to PaymentProvider.initiatePayment().
 * Provider-agnostic: both Stripe and M-Pesa share this input contract.
 */
export interface InitiatePaymentParams {
  /** Internal payment_requests.id — set on Stripe metadata and M-Pesa AccountReference. */
  paymentRequestId: string;
  /** Amount in the smallest currency unit (cents, pesewas, etc.). */
  amountMinorUnits: number;
  /** ISO 4217 currency code ('KES', 'USD', …). */
  currency: string;
  /** Human-readable description shown on statements / STK prompt. */
  description: string;
  /**
   * Provider customer reference.
   * Stripe: the Stripe Customer ID (cus_xxx) or a tokenized payment method.
   * M-Pesa: the payer's phone number in international format (254712345678).
   */
  customerRef: string;
  /** Arbitrary string → string metadata forwarded to the provider for round-tripping. */
  metadata: Record<string, string>;
}

/**
 * Discriminated union returned by PaymentProvider.initiatePayment().
 *
 * MUST NOT be collapsed into a single shape — the two providers have
 * fundamentally different post-initiation steps (see blueprint §Q2
 * "Where the flows CANNOT be unified").
 *
 * - 'stripe': caller must return clientSecret to the frontend so Stripe.js
 *   can confirm the card payment.
 * - 'mpesa': no frontend step; Safaricom sends an STK push to the user's phone.
 */
export type InitiatePaymentResult =
  | {
      kind: "stripe";
      /** Client secret for Stripe.js stripe.confirmPayment() on the frontend. */
      clientSecret: string;
      /** The PaymentIntent ID (pi_xxx) stored in payment_requests.provider_payment_id. */
      stripePaymentIntentId: string;
    }
  | {
      kind: "mpesa";
      /** Returned by Safaricom; stored in payment_requests.provider_payment_id. */
      checkoutRequestId: string;
      /** Safaricom MerchantRequestID for cross-referencing in the STK Query API. */
      merchantRequestId: string;
    };

/**
 * Raw request data handed to PaymentProvider.verifyWebhook().
 *
 * ⚠️  RAW BODY REQUIREMENT (Stripe):
 * Stripe's HMAC-SHA256 signature is computed against the exact raw request body
 * bytes. If the body is parsed by the framework (e.g., Next.js JSON route
 * handlers call request.json() internally), the whitespace/key ordering may
 * change and signature verification WILL fail.
 *
 * The caller (Task 8.8 — /api/webhooks/stripe route) MUST read the raw body
 * via `await request.text()` (or `Buffer.from(await request.arrayBuffer())`)
 * BEFORE handing it here. Do NOT pass a re-serialized JSON string.
 */
export interface WebhookVerificationInput {
  /**
   * The exact raw request body as a string.
   * For Stripe: obtained via `await request.text()` on the Next.js Request.
   * For M-Pesa: also `await request.text()` (Safaricom sends JSON).
   */
  rawBody: string;
  /** All HTTP request headers, keyed by lowercase header name. */
  headers: Record<string, string | string[] | undefined>;
}

/**
 * The verified, provider-agnostic event wrapper returned by verifyWebhook().
 *
 * The concrete payload shape is provider-specific and intentionally typed as
 * unknown — callers must narrow via event.providerSlug before reading
 * event.payload.
 */
export interface VerifiedProviderEvent {
  /** Identifies the concrete payload shape. */
  providerSlug: "stripe" | "mpesa";
  /** Provider's own event/notification identifier (used for idempotency). */
  providerEventId: string;
  /** Provider-native event type string ('payment_intent.succeeded', etc.). */
  eventType: string;
  /** The verified, parsed provider payload. Type-narrow before use. */
  payload: unknown;
}

/**
 * Internal payment status update derived from a provider event or status query.
 * Written into payment_requests.status after webhook processing.
 */
export interface PaymentStatusUpdate {
  /** Provider-specific payment identifier (pi_xxx for Stripe, CheckoutRequestID for M-Pesa). */
  providerPaymentId: string;
  status: "succeeded" | "failed" | "expired" | "pending";
  /** Full raw provider response stored verbatim for audit/debugging. */
  providerData: Record<string, unknown>;
  /** Human-readable failure reason, present when status is 'failed'. */
  failureReason?: string;
}

// ---------------------------------------------------------------------------
// Core interface
// ---------------------------------------------------------------------------

/**
 * PaymentProvider — the abstraction boundary between the MIS billing layer and
 * any external payment network.
 *
 * Blueprint contract (§Q2): implement ONLY the methods listed here.
 * Provider-specific concerns (refunds, polling fallback) are NOT part of this
 * interface in Round 8.
 *
 * @see lib/billing/providers/stripe.ts — Stripe implementation
 * @see lib/billing/providers/registry.ts — factory
 */
export interface PaymentProvider {
  readonly slug: "stripe" | "mpesa";

  /**
   * Initiate a payment with the provider.
   *
   * @param params        - Provider-agnostic payment parameters.
   * @param providerConfig - Decrypted credentials for the provider (from providerConfig.ts).
   * @returns A discriminated union — the shape depends on the provider (see
   *   InitiatePaymentResult).
   */
  initiatePayment(
    params: InitiatePaymentParams,
    providerConfig: import("@/lib/billing/providerConfig").ProviderCredentials
  ): Promise<InitiatePaymentResult>;

  /**
   * Verify an incoming webhook/callback request.
   *
   * ⚠️  For Stripe, `input.rawBody` MUST be the exact raw body string read via
   * `request.text()` in the route handler — NOT parsed JSON. See
   * WebhookVerificationInput for the full requirement note.
   *
   * @param input          - Raw body + headers from the incoming request.
   * @param providerConfig - Decrypted provider credentials (webhookSecret, etc.).
   * @returns The verified event payload.
   * @throws {ProviderVerificationError} if signature/token verification fails.
   */
  verifyWebhook(
    input: WebhookVerificationInput,
    providerConfig: import("@/lib/billing/providerConfig").ProviderCredentials
  ): Promise<VerifiedProviderEvent>;

  /**
   * Extract the internal payment_requests.id reference from a verified event.
   *
   * Stripe: reads event.data.object.metadata.mis_payment_request_id.
   * M-Pesa: reads AccountReference or CheckoutRequestID.
   *
   * @param event - A VerifiedProviderEvent returned by verifyWebhook().
   * @returns The internal payment request UUID string.
   */
  extractPaymentRequestRef(event: VerifiedProviderEvent): string;

  /**
   * Map a verified provider event to the internal PaymentStatusUpdate shape.
   *
   * @param event - A VerifiedProviderEvent returned by verifyWebhook().
   * @returns The mapped status update to persist.
   */
  mapToPaymentUpdate(event: VerifiedProviderEvent): PaymentStatusUpdate;

  /**
   * Query the current payment status directly from the provider by ID.
   *
   * Primary use for M-Pesa: polling fallback when the callback does not arrive.
   * Also useful for Stripe reconciliation (retrieve PaymentIntent).
   *
   * @param providerPaymentId - The provider's own payment identifier.
   * @param providerConfig    - Decrypted credentials.
   * @returns The current status of the payment.
   */
  queryPaymentStatus(
    providerPaymentId: string,
    providerConfig: import("@/lib/billing/providerConfig").ProviderCredentials
  ): Promise<PaymentStatusUpdate>;
}

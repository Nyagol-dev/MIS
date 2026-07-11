/**
 * Thrown by a PaymentProvider's verifyWebhook() method when the incoming
 * request cannot be cryptographically verified as authentic.
 *
 * Callers (webhook route handlers) MUST catch this error and return HTTP 400
 * to the provider rather than letting it propagate.
 *
 * @see lib/billing/providers/stripe.ts — verifyWebhook() throws this when
 *   stripe.webhooks.constructEvent() rejects the signature.
 *
 * SCOPE NOTE: Only ProviderVerificationError lives here for now.
 * Other billing-domain errors (InvalidStateTransitionError,
 * BillingLimitExceeded, NoActiveSubscriptionError) are defined in their
 * respective task files (Tasks 8.5, 8.6, etc.) and must NOT be added here
 * prematurely.
 */
export class ProviderVerificationError extends Error {
  public readonly code = "PROVIDER_VERIFICATION_FAILED" as const;

  /**
   * @param provider  - Slug of the provider whose verification failed ('stripe' | 'mpesa').
   * @param cause     - The underlying error thrown by the provider SDK or check, if available.
   */
  constructor(
    public readonly provider: "stripe" | "mpesa",
    cause?: unknown
  ) {
    super(
      `Webhook verification failed for provider '${provider}'.` +
        (cause instanceof Error ? ` Cause: ${cause.message}` : "")
    );
    this.name = "ProviderVerificationError";
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

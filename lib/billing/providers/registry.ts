/**
 * Payment provider registry — factory for PaymentProvider instances.
 *
 * Call getPaymentProvider(slug) to obtain the concrete implementation for a
 * given provider slug.  The factory is intentionally simple: provider
 * implementations are stateless classes and are instantiated fresh on each
 * call (they hold no request-level state).
 *
 * @see lib/billing/providers/types.ts — PaymentProvider interface
 * @see Documentation/round8_billing_blueprint.md §Q2
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Round 8 implementation status:
 *
 *   'stripe' — ✅ implemented (lib/billing/providers/stripe.ts, Task 8.2)
 *   'mpesa'  — ✅ implemented (lib/billing/providers/mpesa.ts, Task 8.4)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { PaymentProvider } from "@/lib/billing/providers/types";
import { StripePaymentProvider } from "@/lib/billing/providers/stripe";
import { MpesaPaymentProvider } from "@/lib/billing/providers/mpesa";

/**
 * Returns the PaymentProvider implementation for the given slug.
 *
 * @param slug - The provider identifier ('stripe' | 'mpesa').
 * @returns The concrete PaymentProvider.
 * @throws If slug is an unrecognised value (programming error).
 */
export function getPaymentProvider(slug: "stripe" | "mpesa"): PaymentProvider {
  switch (slug) {
    case "stripe":
      return new StripePaymentProvider();

    case "mpesa":
      return new MpesaPaymentProvider();

    default: {
      // TypeScript exhaustiveness guard — if a new slug is added to the union
      // without updating this switch, the compiler will surface it here.
      const _exhaustive: never = slug;
      throw new Error(
        `getPaymentProvider: unknown provider slug '${String(_exhaustive)}'. ` +
          `Add a case to this switch and implement the corresponding provider class.`
      );
    }
  }
}

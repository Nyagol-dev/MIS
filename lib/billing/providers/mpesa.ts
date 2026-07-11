/**
 * M-Pesa (Safaricom Daraja) implementation of the PaymentProvider interface.
 *
 * @see lib/billing/providers/types.ts — interface contract
 * @see Documentation/round8_billing_blueprint.md §Q2, §Q3
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRUST BOUNDARY & verifyWebhook SCOPE (MUST READ — Task 8.8 caller):
 *
 * M-Pesa has NO cryptographic webhook signature mechanism equivalent to
 * Stripe's HMAC-SHA256.  Safaricom's Daraja platform authenticates callbacks
 * by embedding a per-tenant opaque token in the callback URL path itself
 * (e.g. /api/webhooks/mpesa/<callbackToken>).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  THE ACTUAL TRUST BOUNDARY IS THE ROUTE-LEVEL TOKEN CHECK.             │
 * │                                                                         │
 * │  The route handler at /api/webhooks/mpesa/[callbackToken] (Task 8.8)  │
 * │  MUST verify the URL-embedded callbackToken against the value stored   │
 * │  in tenant_provider_configs.callback_token BEFORE calling any method  │
 * │  on this adapter.  If the token is absent or mismatched the route     │
 * │  MUST return HTTP 401 immediately.                                     │
 * │                                                                         │
 * │  verifyWebhook() in THIS FILE does NOT and cannot perform              │
 * │  cryptographic verification — it only validates the structural        │
 * │  shape of the Safaricom callback JSON.                                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CREDENTIAL CONVENTION (from setProviderCredentials() call sites):
 *
 *   credentials.consumerKey     — Daraja API consumer key
 *   credentials.consumerSecret  — Daraja API consumer secret
 *   credentials.businessShortCode — Paybill / Till number (e.g. "174379")
 *   credentials.passkey         — Lipa Na M-Pesa Online passkey from Daraja portal
 *   credentials.environment     — "sandbox" | "production"
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

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
// Daraja API shape types (internal — not exported)
// ---------------------------------------------------------------------------

/** Raw Daraja STK Push response (processrequest). */
interface DarajaStkPushResponse {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
  CustomerMessage: string;
}

/** Raw Daraja STK Query response (stkpushquery). */
interface DarajaStkQueryResponse {
  ResponseCode: string;
  ResponseDescription: string;
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResultCode: string;
  ResultDesc: string;
}

/**
 * Safaricom callback payload — the full JSON body posted by Daraja.
 * Shape reference: https://developer.safaricom.co.ke/APIs/MpesaExpressSimulate
 */
interface SafaricomCallbackPayload {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: {
        Item: Array<{ Name: string; Value?: unknown }>;
      };
    };
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the correct Daraja API base URL for the configured environment.
 */
function getDarajaBaseUrl(credentials: ProviderCredentials): string {
  const env = credentials.credentials["environment"];
  return env === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

/**
 * Validates that all required credential fields are present and returns them.
 * Throws a descriptive error so misconfiguration is caught at call time.
 */
function requireCredentialFields(
  credentials: ProviderCredentials
): {
  consumerKey: string;
  consumerSecret: string;
  businessShortCode: string;
  passkey: string;
} {
  const { consumerKey, consumerSecret, businessShortCode, passkey } =
    credentials.credentials;

  const missing: string[] = [];
  if (!consumerKey) missing.push("consumerKey");
  if (!consumerSecret) missing.push("consumerSecret");
  if (!businessShortCode) missing.push("businessShortCode");
  if (!passkey) missing.push("passkey");

  if (missing.length > 0) {
    throw new Error(
      `[mpesa] ProviderCredentials.credentials is missing required field(s): ` +
        `${missing.join(", ")}. ` +
        `Ensure setProviderCredentials() was called with all M-Pesa fields.`
    );
  }

  return { consumerKey, consumerSecret, businessShortCode, passkey };
}

/**
 * Fetches a short-lived OAuth2 access token from the Daraja /oauth/v1/generate
 * endpoint using Basic auth (consumerKey:consumerSecret).
 *
 * Tokens are valid for 3600 seconds per Safaricom docs.  Caching is
 * deliberately omitted here — the cron route is the right place to add a
 * simple in-memory or Redis cache if token rate limits become a concern.
 */
async function fetchDarajaAccessToken(
  baseUrl: string,
  consumerKey: string,
  consumerSecret: string
): Promise<string> {
  const basicAuth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString(
    "base64"
  );

  const response = await fetch(
    `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${basicAuth}`,
      },
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `[mpesa] Failed to obtain Daraja access token. ` +
        `HTTP ${response.status}: ${body}`
    );
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error(
      "[mpesa] Daraja OAuth response is missing access_token field."
    );
  }

  return data.access_token;
}

/**
 * Generates the Base64-encoded STK Push password and the timestamp used in
 * the password construction.
 *
 * Daraja password = Base64(BusinessShortCode + Passkey + Timestamp)
 * where Timestamp = YYYYMMDDHHmmss (UTC).
 */
function buildStkPassword(
  businessShortCode: string,
  passkey: string
): { password: string; timestamp: string } {
  // Daraja expects timestamp in YYYYMMDDHHmmss format (UTC).
  const now = new Date();
  const timestamp = [
    now.getUTCFullYear().toString(),
    (now.getUTCMonth() + 1).toString().padStart(2, "0"),
    now.getUTCDate().toString().padStart(2, "0"),
    now.getUTCHours().toString().padStart(2, "0"),
    now.getUTCMinutes().toString().padStart(2, "0"),
    now.getUTCSeconds().toString().padStart(2, "0"),
  ].join("");

  const password = Buffer.from(
    `${businessShortCode}${passkey}${timestamp}`
  ).toString("base64");

  return { password, timestamp };
}

/**
 * Narrows and asserts that an unknown payload is a SafaricomCallbackPayload.
 * Used inside verifyWebhook() after JSON-parsing the raw body.
 */
function parseSafaricomPayload(rawBody: string): SafaricomCallbackPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error(
      "[mpesa] verifyWebhook: request body is not valid JSON. " +
        "Safaricom callbacks must be JSON-encoded."
    );
  }

  // Structural validation — verify the nested path exists before returning.
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("Body" in parsed) ||
    typeof (parsed as Record<string, unknown>)["Body"] !== "object" ||
    (parsed as Record<string, unknown>)["Body"] === null
  ) {
    throw new Error(
      "[mpesa] verifyWebhook: payload is missing top-level 'Body' object."
    );
  }

  const body = (parsed as { Body: Record<string, unknown> }).Body;

  if (
    !("stkCallback" in body) ||
    typeof body["stkCallback"] !== "object" ||
    body["stkCallback"] === null
  ) {
    throw new Error(
      "[mpesa] verifyWebhook: payload.Body is missing 'stkCallback' object."
    );
  }

  const stkCallback = body["stkCallback"] as Record<string, unknown>;

  if (typeof stkCallback["CheckoutRequestID"] !== "string") {
    throw new Error(
      "[mpesa] verifyWebhook: stkCallback.CheckoutRequestID is absent or not a string."
    );
  }
  if (typeof stkCallback["MerchantRequestID"] !== "string") {
    throw new Error(
      "[mpesa] verifyWebhook: stkCallback.MerchantRequestID is absent or not a string."
    );
  }
  if (typeof stkCallback["ResultCode"] !== "number") {
    throw new Error(
      "[mpesa] verifyWebhook: stkCallback.ResultCode is absent or not a number."
    );
  }
  if (typeof stkCallback["ResultDesc"] !== "string") {
    throw new Error(
      "[mpesa] verifyWebhook: stkCallback.ResultDesc is absent or not a string."
    );
  }

  return parsed as SafaricomCallbackPayload;
}

// ---------------------------------------------------------------------------
// MpesaPaymentProvider
// ---------------------------------------------------------------------------

/**
 * M-Pesa (Safaricom Daraja) implementation of PaymentProvider.
 *
 * Instantiate via getPaymentProvider('mpesa') — do NOT construct directly
 * outside of the registry or tests.
 *
 * @see lib/billing/providers/registry.ts — factory entry point
 */
export class MpesaPaymentProvider implements PaymentProvider {
  readonly slug = "mpesa" as const;

  // ── initiatePayment ────────────────────────────────────────────────────────

  /**
   * Initiates an M-Pesa STK Push (Lipa Na M-Pesa Online) request.
   *
   * The flow after a successful call:
   *   1. Safaricom sends an STK PIN prompt to the customer's phone.
   *   2. On completion (or failure), Safaricom POSTs to the CallbackURL
   *      configured at STK Push registration time (the Task 8.8 webhook route).
   *   3. If the callback does not arrive within ~5 minutes, the polling cron
   *      (app/api/cron/poll-mpesa-pending/route.ts) resolves via queryPaymentStatus.
   *
   * AccountReference is set to params.paymentRequestId — this is how the
   * webhook callback and the STK Query response are later mapped back to the
   * internal payment_requests row (mirrors Stripe's metadata approach, but
   * M-Pesa has no metadata concept, so AccountReference carries the ref).
   *
   * @param params.customerRef - Phone number in international format, e.g. "254712345678".
   *   Do NOT include the leading "+"; Daraja expects the numeric-only form.
   * @param params.amountMinorUnits - Amount in the currency's minor unit (cents).
   *   M-Pesa transacts in KES whole units; this divides by 100 automatically.
   */
  async initiatePayment(
    params: InitiatePaymentParams,
    providerConfig: ProviderCredentials
  ): Promise<InitiatePaymentResult> {
    const { consumerKey, consumerSecret, businessShortCode, passkey } =
      requireCredentialFields(providerConfig);

    const baseUrl = getDarajaBaseUrl(providerConfig);
    const accessToken = await fetchDarajaAccessToken(
      baseUrl,
      consumerKey,
      consumerSecret
    );

    const { password, timestamp } = buildStkPassword(
      businessShortCode,
      passkey
    );

    // M-Pesa expects whole KES units; amountMinorUnits is in cents.
    const amountKes = Math.ceil(params.amountMinorUnits / 100);

    // The CallbackURL is configured per-tenant when the STK Push endpoint is
    // registered in the Daraja portal.  It embeds the callbackToken in the
    // path so the webhook route can authenticate without a DB round-trip
    // (see file-level trust boundary note above).
    const callbackToken = providerConfig.callbackToken;
    if (!callbackToken) {
      throw new Error(
        "[mpesa] ProviderCredentials.callbackToken is not set. " +
          "Store the per-tenant callbackToken in tenant_provider_configs.callback_token " +
          "via setProviderCredentials() before initiating payments."
      );
    }

    const callbackUrl =
      `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/mpesa/${callbackToken}`;

    const requestBody = {
      BusinessShortCode: businessShortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amountKes,
      PartyA: params.customerRef,   // Payer phone number (254xxxxxxxxx)
      PartyB: businessShortCode,    // Business shortcode
      PhoneNumber: params.customerRef,
      CallBackURL: callbackUrl,
      // AccountReference carries the internal payment_requests.id so the
      // webhook callback and STK Query can map back to the DB row — this is
      // the M-Pesa analogue of Stripe's metadata.mis_payment_request_id.
      AccountReference: params.paymentRequestId,
      TransactionDesc: params.description.slice(0, 100), // Daraja max 100 chars
    };

    const response = await fetch(
      `${baseUrl}/mpesa/stkpush/v1/processrequest`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }
    );

    const data = (await response.json()) as DarajaStkPushResponse;

    if (!response.ok || data.ResponseCode !== "0") {
      throw new Error(
        `[mpesa] STK Push request failed. ` +
          `HTTP ${response.status}, ResponseCode: ${data.ResponseCode ?? "unknown"}, ` +
          `ResponseDescription: ${data.ResponseDescription ?? "unknown"}`
      );
    }

    return {
      kind: "mpesa",
      checkoutRequestId: data.CheckoutRequestID,
      merchantRequestId: data.MerchantRequestID,
    };
  }

  // ── verifyWebhook ──────────────────────────────────────────────────────────

  /**
   * Parses and validates the STRUCTURE of a Safaricom STK callback payload.
   *
   * ⚠️  TRUST BOUNDARY — this function does NOT perform cryptographic
   * verification because Safaricom's Daraja platform provides none.
   *
   * Authenticity of the callback is established at the ROUTE level
   * (app/api/webhooks/mpesa/[callbackToken]/route.ts — Task 8.8) by checking
   * the URL-embedded callbackToken against tenant_provider_configs.callback_token
   * BEFORE this function is ever called.  If the token check fails, the route
   * returns HTTP 401 without invoking this adapter.
   *
   * This function's sole responsibility is:
   *   1. JSON-parse input.rawBody.
   *   2. Assert the required structural fields are present and correctly typed
   *      (Body.stkCallback.CheckoutRequestID, MerchantRequestID, ResultCode,
   *      ResultDesc).
   *   3. Return a VerifiedProviderEvent wrapping the parsed payload.
   *
   * @throws {ProviderVerificationError} if the body is not valid JSON or is
   *   structurally invalid (missing required Safaricom fields).
   */
  async verifyWebhook(
    input: WebhookVerificationInput,
    // providerConfig is accepted for interface conformance; M-Pesa callback
    // structural parsing does not require credentials.
    _providerConfig: ProviderCredentials
  ): Promise<VerifiedProviderEvent> {
    let payload: SafaricomCallbackPayload;
    try {
      payload = parseSafaricomPayload(input.rawBody);
    } catch (err) {
      throw new ProviderVerificationError("mpesa", err);
    }

    const { CheckoutRequestID, MerchantRequestID } =
      payload.Body.stkCallback;

    // Use CheckoutRequestID as the canonical event identifier for idempotency
    // (it uniquely identifies this STK Push request on the Safaricom side).
    return {
      providerSlug: "mpesa",
      providerEventId: CheckoutRequestID,
      // Safaricom does not have named event types like Stripe does; we derive
      // a synthetic type from the ResultCode for logging/routing purposes.
      eventType:
        payload.Body.stkCallback.ResultCode === 0
          ? "stk_push.succeeded"
          : "stk_push.failed",
      payload,
    };
  }

  // ── extractPaymentRequestRef ───────────────────────────────────────────────

  /**
   * Extracts the internal payment_requests.id from a verified Safaricom callback.
   *
   * The reference is the CheckoutRequestID stored in payment_requests.provider_payment_id
   * at initiatePayment() time.  The actual DB lookup
   * (SELECT tenant_id FROM payment_requests WHERE provider_payment_id = $1) is
   * performed by the route handler (Task 8.8) — this function only extracts
   * the string key from the parsed payload.
   *
   * Note on AccountReference: Daraja includes AccountReference in
   * CallbackMetadata.Item but only when ResultCode = 0 (success).  CheckoutRequestID
   * is always present regardless of outcome and is the reliable lookup key.
   *
   * @returns The CheckoutRequestID string, which is stored as provider_payment_id
   *   in payment_requests at initiation time.
   */
  extractPaymentRequestRef(event: VerifiedProviderEvent): string {
    const payload = event.payload as SafaricomCallbackPayload;
    const checkoutRequestId = payload?.Body?.stkCallback?.CheckoutRequestID;

    if (!checkoutRequestId) {
      throw new Error(
        "[mpesa] extractPaymentRequestRef: CheckoutRequestID is absent from the " +
          "verified callback payload. This should not happen if verifyWebhook() " +
          "ran successfully — investigate upstream parsing."
      );
    }

    return checkoutRequestId;
  }

  // ── mapToPaymentUpdate ─────────────────────────────────────────────────────

  /**
   * Maps a verified Safaricom STK callback to the internal PaymentStatusUpdate.
   *
   * Result code semantics (from Daraja docs):
   *   0                → Transaction completed successfully → status: 'succeeded'
   *   1032             → Request cancelled by user → status: 'failed'
   *   1037             → DS timeout — user failed to respond → status: 'failed'
   *   any other non-0 → Failed for other reason → status: 'failed'
   *
   * The full ResultDesc from Safaricom is forwarded as failureReason so
   * operators can understand what happened without referring to Daraja docs.
   */
  mapToPaymentUpdate(event: VerifiedProviderEvent): PaymentStatusUpdate {
    const payload = event.payload as SafaricomCallbackPayload;
    const { CheckoutRequestID, MerchantRequestID, ResultCode, ResultDesc, CallbackMetadata } =
      payload.Body.stkCallback;

    const providerData: Record<string, unknown> = {
      checkoutRequestId: CheckoutRequestID,
      merchantRequestId: MerchantRequestID,
      resultCode: ResultCode,
      resultDesc: ResultDesc,
      // Include the raw CallbackMetadata items (amount, mpesa receipt, etc.)
      // for audit purposes.  Non-zero ResultCode means CallbackMetadata is absent.
      callbackMetadata: CallbackMetadata ?? null,
    };

    if (ResultCode === 0) {
      return {
        providerPaymentId: CheckoutRequestID,
        status: "succeeded",
        providerData,
      };
    }

    return {
      providerPaymentId: CheckoutRequestID,
      status: "failed",
      providerData,
      failureReason: ResultDesc,
    };
  }

  // ── queryPaymentStatus ─────────────────────────────────────────────────────

  /**
   * Queries the current status of an STK Push request via the Daraja
   * STK Push Query API (POST /mpesa/stkpushquery/v1/query).
   *
   * Primary use: the polling cron (app/api/cron/poll-mpesa-pending/route.ts)
   * calls this for payment_requests that are still 'pending' and have not
   * received a callback within the expected window.
   *
   * @param providerPaymentId - The CheckoutRequestID stored in
   *   payment_requests.provider_payment_id at initiatePayment() time.
   */
  async queryPaymentStatus(
    providerPaymentId: string,
    providerConfig: ProviderCredentials
  ): Promise<PaymentStatusUpdate> {
    const { consumerKey, consumerSecret, businessShortCode, passkey } =
      requireCredentialFields(providerConfig);

    const baseUrl = getDarajaBaseUrl(providerConfig);
    const accessToken = await fetchDarajaAccessToken(
      baseUrl,
      consumerKey,
      consumerSecret
    );

    const { password, timestamp } = buildStkPassword(
      businessShortCode,
      passkey
    );

    const requestBody = {
      BusinessShortCode: businessShortCode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: providerPaymentId,
    };

    const response = await fetch(
      `${baseUrl}/mpesa/stkpushquery/v1/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }
    );

    const data = (await response.json()) as DarajaStkQueryResponse;

    if (!response.ok) {
      throw new Error(
        `[mpesa] STK Query API returned HTTP ${response.status}. ` +
          `ResponseDescription: ${data.ResponseDescription ?? "unknown"}`
      );
    }

    const providerData: Record<string, unknown> = {
      checkoutRequestId: data.CheckoutRequestID,
      merchantRequestId: data.MerchantRequestID,
      responseCode: data.ResponseCode,
      responseDescription: data.ResponseDescription,
      resultCode: data.ResultCode,
      resultDesc: data.ResultDesc,
    };

    // ResponseCode "0" means the query itself succeeded and ResultCode carries
    // the transaction outcome.  A non-"0" ResponseCode means the query failed
    // (e.g. the request is still being processed — treat as still pending).
    if (data.ResponseCode !== "0") {
      return {
        providerPaymentId,
        status: "pending",
        providerData,
      };
    }

    // ResultCode "0" = transaction succeeded.
    if (data.ResultCode === "0") {
      return {
        providerPaymentId,
        status: "succeeded",
        providerData,
      };
    }

    // Any non-"0" ResultCode is a failure.
    return {
      providerPaymentId,
      status: "failed",
      providerData,
      failureReason: data.ResultDesc,
    };
  }
}

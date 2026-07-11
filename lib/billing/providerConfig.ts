import type { PoolClient } from "pg";
import { encryptCredentials, decryptCredentials } from "@/lib/billing/encryption";
import { writeAuditLog } from "@/lib/db/audit";

export interface ProviderCredentials {
  providerSlug: "stripe" | "mpesa";
  credentials: Record<string, string>;
  webhookSecret?: string;
  callbackToken?: string;
}

/**
 * Fetches the payment provider configurations row from `tenant_provider_configs`,
 * decrypts the credentials block, and returns a ProviderCredentials object.
 *
 * This is a data-access layer function that does NOT perform permission checks.
 *
 * @param client - PostgreSQL PoolClient to execute queries inside.
 * @param tenantId - The UUID of the tenant scope.
 * @param providerSlug - The slug of the payment provider ('stripe' or 'mpesa').
 * @returns ProviderCredentials or null if config is not found.
 */
export async function getProviderCredentials(
  client: PoolClient,
  tenantId: string,
  providerSlug: "stripe" | "mpesa"
): Promise<ProviderCredentials | null> {
  const { rows } = await client.query<{
    provider_slug: "stripe" | "mpesa";
    credentials_encrypted: Buffer;
    webhook_secret: string | null;
    callback_token: string | null;
  }>(
    `SELECT provider_slug, credentials_encrypted, webhook_secret, callback_token
     FROM tenant_provider_configs
     WHERE tenant_id = $1 AND provider_slug = $2`,
    [tenantId, providerSlug]
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  const credentials = decryptCredentials(row.credentials_encrypted);

  const providerCredentials: ProviderCredentials = {
    providerSlug: row.provider_slug,
    credentials,
  };

  if (row.webhook_secret !== null) {
    providerCredentials.webhookSecret = row.webhook_secret;
  }
  if (row.callback_token !== null) {
    providerCredentials.callbackToken = row.callback_token;
  }

  return providerCredentials;
}

/**
 * Encrypts and upserts payment provider credentials into `tenant_provider_configs`.
 *
 * All operations are completed on the caller's active client transaction.
 * Safe audit logs are written afterwards without storing any decrypted secrets.
 *
 * @param client - PostgreSQL PoolClient to execute queries inside.
 * @param tenantId - The UUID of the tenant scope.
 * @param providerSlug - The slug of the payment provider ('stripe' or 'mpesa').
 * @param credentials - Plaintext credentials record to encrypt and store.
 * @param options - Optional configuration fields (webhookSecret, callbackToken, displayName, isActive, config, actorId).
 */
export async function setProviderCredentials(
  client: PoolClient,
  tenantId: string,
  providerSlug: "stripe" | "mpesa",
  credentials: Record<string, string>,
  options?: {
    webhookSecret?: string | null;
    callbackToken?: string | null;
    displayName?: string;
    isActive?: boolean;
    config?: Record<string, unknown>;
    actorId?: string | null;
  }
): Promise<void> {
  const credentialsEncrypted = encryptCredentials(credentials);

  // Retrieve current state of the provider config to build a correct audit log old state
  const existingResult = await client.query<{
    id: string;
    provider_slug: string;
    display_name: string;
    is_active: boolean;
    webhook_secret: string | null;
    callback_token: string | null;
    config: Record<string, unknown>;
  }>(
    `SELECT id, provider_slug, display_name, is_active, webhook_secret, callback_token, config
     FROM tenant_provider_configs
     WHERE tenant_id = $1 AND provider_slug = $2`,
    [tenantId, providerSlug]
  );

  const existingRow = existingResult.rows[0];

  const displayName = options?.displayName ?? (existingRow?.display_name || "");
  const isActive = options?.isActive ?? (existingRow?.is_active ?? true);
  const webhookSecret = options?.webhookSecret !== undefined ? options.webhookSecret : (existingRow?.webhook_secret ?? null);
  const callbackToken = options?.callbackToken !== undefined ? options.callbackToken : (existingRow?.callback_token ?? null);
  const config = options?.config ?? (existingRow?.config || {});

  const upsertResult = await client.query<{ id: string }>(
    `INSERT INTO tenant_provider_configs (
      tenant_id,
      provider_slug,
      display_name,
      is_active,
      credentials_encrypted,
      webhook_secret,
      callback_token,
      config,
      updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (tenant_id, provider_slug)
     DO UPDATE SET
      display_name = EXCLUDED.display_name,
      is_active = EXCLUDED.is_active,
      credentials_encrypted = EXCLUDED.credentials_encrypted,
      webhook_secret = EXCLUDED.webhook_secret,
      callback_token = EXCLUDED.callback_token,
      config = EXCLUDED.config,
      updated_at = now()
     RETURNING id`,
    [
      tenantId,
      providerSlug,
      displayName,
      isActive,
      credentialsEncrypted,
      webhookSecret,
      callbackToken,
      JSON.stringify(config),
    ]
  );

  const configId = upsertResult.rows[0].id;

  // Build clean and safe states for the audit log. Decrypted credential values are never included.
  const oldState = existingRow
    ? {
        id: existingRow.id,
        provider_slug: existingRow.provider_slug,
        display_name: existingRow.display_name,
        is_active: existingRow.is_active,
        webhook_secret_configured: existingRow.webhook_secret !== null,
        callback_token_configured: existingRow.callback_token !== null,
        config: existingRow.config,
      }
    : null;

  const newState = {
    id: configId,
    provider_slug: providerSlug,
    display_name: displayName,
    is_active: isActive,
    webhook_secret_configured: webhookSecret !== null,
    callback_token_configured: callbackToken !== null,
    config,
  };

  await writeAuditLog(client, {
    tenantId,
    actorId: options?.actorId ?? null,
    action: existingRow ? "billing.provider_config.updated" : "billing.provider_config.created",
    entityType: "tenant_provider_config",
    entityId: configId,
    oldState,
    newState,
    context: {
      providerSlug,
      success: true,
    },
  });
}

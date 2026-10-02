/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * lib/crypto/field-encryption.ts
 *
 * VERSIONED FIELD-LEVEL ENCRYPTION SERVICE (§5, finding 9)
 * ─────────────────────────────────────────────────────────────────────────────
 * Generalises the billing-specific AES-256-GCM helper into a versioned,
 * key-rotatable service for encrypting any sensitive field (PHI, national IDs,
 * phone numbers, addresses, insurance numbers).
 *
 * KEY MANAGEMENT:
 * - Keys are identified by version number (1, 2, 3, ...)
 * - Each version maps to a base64-encoded 32-byte AES key in env vars:
 *     FIELD_ENCRYPTION_KEY_1=<base64>
 *     FIELD_ENCRYPTION_KEY_2=<base64>
 *     ...
 * - FIELD_ENCRYPTION_CURRENT_VERSION specifies which version to use for new encryptions
 * - Old keys are kept for decryption only (rotation support)
 * - BILLING_ENCRYPTION_KEY is mapped to version 0 for backward compatibility
 *
 * CIPHERTEXT FORMAT:
 *   [version (1 byte)][IV (12 bytes)][authTag (16 bytes)][ciphertext (N bytes)]
 *   Total overhead: 29 bytes
 *
 * BLIND INDEX:
 *   HMAC-SHA256 of the plaintext using a separate HMAC key, producing a
 *   deterministic index for equality searches on encrypted fields.
 */

import crypto from 'crypto';

// ─── Key registry ─────────────────────────────────────────────────────────────

interface KeyEntry {
  version: number;
  key: Buffer;
}

const keyRegistry: Map<number, Buffer> = new Map();
let currentVersion: number;
let hmacKey: Buffer;

function ensureKeysLoaded(): void {
  if (keyRegistry.size > 0) return;

  // Load versioned keys from environment
  const currentVersionStr = process.env.FIELD_ENCRYPTION_CURRENT_VERSION;
  if (!currentVersionStr) {
    // Fallback: use BILLING_ENCRYPTION_KEY as version 0 for backward compat
    const billingKey = process.env.BILLING_ENCRYPTION_KEY;
    if (!billingKey) {
      throw new Error(
        'Field encryption not configured. Set FIELD_ENCRYPTION_KEY_1 and ' +
          'FIELD_ENCRYPTION_CURRENT_VERSION, or BILLING_ENCRYPTION_KEY for legacy mode.'
      );
    }
    const keyBuffer = Buffer.from(billingKey, 'base64');
    if (keyBuffer.length !== 32) {
      throw new Error(
        `BILLING_ENCRYPTION_KEY must decode to 32 bytes. Got ${keyBuffer.length}.`
      );
    }
    keyRegistry.set(0, keyBuffer);
    currentVersion = 0;
  } else {
    currentVersion = parseInt(currentVersionStr, 10);
    if (isNaN(currentVersion) || currentVersion < 1) {
      throw new Error('FIELD_ENCRYPTION_CURRENT_VERSION must be a positive integer.');
    }

    // Load all versioned keys
    for (let v = 1; v <= currentVersion; v++) {
      const envKey = process.env[`FIELD_ENCRYPTION_KEY_${v}`];
      if (!envKey) {
        throw new Error(`FIELD_ENCRYPTION_KEY_${v} is required (versions 1..${currentVersion}).`);
      }
      const keyBuffer = Buffer.from(envKey, 'base64');
      if (keyBuffer.length !== 32) {
        throw new Error(
          `FIELD_ENCRYPTION_KEY_${v} must decode to 32 bytes. Got ${keyBuffer.length}.`
        );
      }
      keyRegistry.set(v, keyBuffer);
    }

    // Also load billing key as version 0 if present (backward compat)
    const billingKey = process.env.BILLING_ENCRYPTION_KEY;
    if (billingKey) {
      const keyBuffer = Buffer.from(billingKey, 'base64');
      if (keyBuffer.length === 32) {
        keyRegistry.set(0, keyBuffer);
      }
    }
  }

  // HMAC key for blind indexes (separate from encryption keys)
  const hmacKeyStr = process.env.FIELD_HMAC_KEY;
  if (hmacKeyStr) {
    hmacKey = Buffer.from(hmacKeyStr, 'base64');
    if (hmacKey.length < 32) {
      throw new Error('FIELD_HMAC_KEY must decode to at least 32 bytes.');
    }
  } else {
    // Fall back to deriving from the current encryption key
    const currentKey = keyRegistry.get(currentVersion);
    if (!currentKey) throw new Error('No encryption key available for HMAC derivation.');
    hmacKey = crypto
      .createHmac('sha256', currentKey)
      .update('blind-index-key-derivation')
      .digest();
  }
}

function getKey(version: number): Buffer {
  ensureKeysLoaded();
  const key = keyRegistry.get(version);
  if (!key) {
    throw new Error(`Encryption key version ${version} not found.`);
  }
  return key;
}

function getCurrentVersion(): number {
  ensureKeysLoaded();
  return currentVersion;
}

// ─── Custom errors ──────────────────────────────────────────────────────────

export class FieldDecryptionError extends Error {
  public readonly code = 'FIELD_DECRYPTION_FAILED' as const;
  constructor(message?: string) {
    super(message ?? 'Field decryption failed (authentication tag mismatch or corrupted ciphertext).');
    this.name = 'FieldDecryptionError';
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Encrypts a string value using AES-256-GCM with the current key version.
 *
 * @param plaintext - The string value to encrypt
 * @returns Buffer containing [version][IV][authTag][ciphertext]
 */
export function encryptField(plaintext: string): Buffer {
  const version = getCurrentVersion();
  const key = getKey(version);

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let ciphertext = cipher.update(plaintext, 'utf8');
  ciphertext = Buffer.concat([ciphertext, cipher.final()]);
  const authTag = cipher.getAuthTag();

  // [version (1 byte)][IV (12)][authTag (16)][ciphertext]
  const versionByte = Buffer.alloc(1);
  versionByte.writeUInt8(version);

  return Buffer.concat([versionByte, iv, authTag, ciphertext]);
}

/**
 * Decrypts a buffer produced by encryptField.
 * Automatically uses the key version stored in the ciphertext.
 *
 * @param encrypted - Buffer containing [version][IV][authTag][ciphertext]
 * @returns The decrypted string
 * @throws {FieldDecryptionError} on any decryption failure
 */
export function decryptField(encrypted: Buffer): string {
  if (encrypted.length < 30) {
    throw new FieldDecryptionError('Ciphertext too short to contain version, IV, and authTag.');
  }

  const version = encrypted.readUInt8(0);
  const iv = encrypted.subarray(1, 13);
  const authTag = encrypted.subarray(13, 29);
  const ciphertext = encrypted.subarray(29);

  try {
    const key = getKey(version);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
  } catch {
    throw new FieldDecryptionError();
  }
}

/**
 * Encrypts a JSON-serializable object (e.g., credentials record).
 * Backward-compatible replacement for lib/billing/encryption.ts.
 *
 * @param data - Object to encrypt
 * @returns Encrypted buffer
 */
export function encryptObject(data: Record<string, string>): Buffer {
  return encryptField(JSON.stringify(data));
}

/**
 * Decrypts a buffer back into a JSON object.
 * Backward-compatible replacement for lib/billing/encryption.ts.
 *
 * @param encrypted - Encrypted buffer
 * @returns The decrypted object
 */
export function decryptObject(encrypted: Buffer): Record<string, string> {
  const json = decryptField(encrypted);
  return JSON.parse(json) as Record<string, string>;
}

/**
 * Computes a blind index (HMAC-SHA256) for a plaintext value.
 * Used for equality searches on encrypted fields without decrypting.
 *
 * @param plaintext - The value to index
 * @param context   - An optional context string to namespace the index
 *                    (e.g., 'national_id', 'phone') to prevent cross-field
 *                    correlation attacks
 * @returns Hex-encoded HMAC digest
 */
export function blindIndex(plaintext: string, context?: string): string {
  ensureKeysLoaded();
  const contextKey = context
    ? crypto.createHmac('sha256', hmacKey).update(context).digest()
    : hmacKey;

  return crypto
    .createHmac('sha256', contextKey)
    .update(plaintext)
    .digest('hex');
}

/**
 * Returns the key version embedded in a ciphertext.
 * Useful for determining if re-encryption is needed.
 */
export function getEncryptedVersion(encrypted: Buffer): number {
  if (encrypted.length < 1) return -1;
  return encrypted.readUInt8(0);
}

/**
 * Checks if a ciphertext was encrypted with the current key version.
 * If not, the value should be re-encrypted on next write.
 */
export function needsReEncryption(encrypted: Buffer): boolean {
  return getEncryptedVersion(encrypted) !== getCurrentVersion();
}

/**
 * Re-encrypts a value with the current key version.
 * Decrypts with the old key, re-encrypts with the current key.
 *
 * @param encrypted - Buffer encrypted with any known key version
 * @returns Buffer encrypted with the current key version
 */
export function reEncrypt(encrypted: Buffer): Buffer {
  const plaintext = decryptField(encrypted);
  return encryptField(plaintext);
}

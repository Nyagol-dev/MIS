import crypto from "crypto";

// Read and validate key base64 format on module load.
// If missing or not a 32-byte key after base64 decoding, throw a clear startup error.
const rawKey = process.env.BILLING_ENCRYPTION_KEY;
if (!rawKey) {
  throw new Error("BILLING_ENCRYPTION_KEY environment variable is not defined");
}

const keyBuffer = Buffer.from(rawKey, "base64");
if (keyBuffer.length !== 32) {
  throw new Error(
    `BILLING_ENCRYPTION_KEY must be a 32-byte base64-encoded key. Decoded size is ${keyBuffer.length} bytes.`
  );
}

/**
 * Custom error thrown when credentials decryption fails (e.g. tag authentication failure or corrupted payload).
 */
export class DecryptionFailedError extends Error {
  public readonly code = "DECRYPTION_FAILED" as const;
  constructor(message?: string) {
    super(message ?? "Decryption failed (authentication tag mismatch or corrupted ciphertext).");
    this.name = "DecryptionFailedError";
  }
}

/**
 * Encrypts a Record of credentials using AES-256-GCM.
 *
 * Serializes the object to JSON, generates a random 12-byte IV per encryption,
 * and concatenates [IV (12 bytes)][authTag (16 bytes)][ciphertext] into a single Buffer.
 *
 * @param plaintext - A key-value record of credentials to encrypt.
 * @returns Concatenated Buffer containing IV, AuthTag, and Ciphertext.
 */
export function encryptCredentials(plaintext: Record<string, string>): Buffer {
  const plaintextStr = JSON.stringify(plaintext);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);

  let ciphertext = cipher.update(plaintextStr, "utf8");
  ciphertext = Buffer.concat([ciphertext, cipher.final()]);

  const authTag = cipher.getAuthTag(); // GCM tag is exactly 16 bytes.

  return Buffer.concat([iv, authTag, ciphertext]);
}

/**
 * Decrypts a Buffer back into a Record of credentials.
 *
 * Parses out the IV, AuthTag, and Ciphertext from the concatenated Buffer format
 * [IV (12 bytes)][authTag (16 bytes)][ciphertext], validates integrity via AES-256-GCM,
 * and deserializes the JSON plaintext.
 *
 * Throws DecryptionFailedError if authentication fails.
 *
 * @param encrypted - The encrypted Buffer format.
 * @returns The decrypted credential Record.
 * @throws {DecryptionFailedError} if decryption fails.
 */
export function decryptCredentials(encrypted: Buffer): Record<string, string> {
  // Safe boundaries check: IV (12 bytes) + authTag (16 bytes) = 28 bytes minimum.
  if (encrypted.length < 28) {
    throw new DecryptionFailedError("Ciphertext buffer is too short to contain valid IV and authTag.");
  }

  const iv = encrypted.subarray(0, 12);
  const authTag = encrypted.subarray(12, 28);
  const ciphertext = encrypted.subarray(28);

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuffer, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return JSON.parse(decrypted.toString("utf8")) as Record<string, string>;
  } catch {
    // Wrap any decryption, verification, or JSON parsing error inside DecryptionFailedError.
    throw new DecryptionFailedError();
  }
}

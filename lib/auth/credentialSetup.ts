import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

/** Create a one-time password setup token. Only its SHA-256 digest is stored. */
export function createCredentialSetupToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashCredentialSetupToken(token) };
}

export function hashCredentialSetupToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isValidCredentialSetupToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { env } from "@/lib/env";

/**
 * AES-256-GCM symmetric encryption for OAuth access/refresh tokens.
 *
 * Tokens for QuickBooks and Xero are never persisted in plaintext. Every value
 * written to the `connections` table passes through `encryptToken()` first, and
 * every value read back is passed through `decryptToken()`. The encryption key
 * is a 32-byte secret supplied as a 64-character hex string in
 * `OAUTH_ENCRYPTION_KEY` and validated at boot by `@/lib/env`.
 *
 * Wire format (all hex, colon-delimited): `iv:authTag:ciphertext`
 *   - `iv`         12-byte random nonce (unique per call — GCM must never reuse
 *                  an IV under the same key)
 *   - `authTag`    16-byte GCM authentication tag (integrity + authenticity)
 *   - `ciphertext` the encrypted token bytes
 */

const ALGORITHM = "aes-256-gcm";
/** 96-bit nonce is the recommended IV length for AES-GCM. */
const IV_LENGTH = 12;

/**
 * The 32-byte key derived from the 64-character hex `OAUTH_ENCRYPTION_KEY`.
 * Resolved once at module load; a malformed key surfaces immediately rather
 * than on first token write.
 */
const KEY = Buffer.from(env.OAUTH_ENCRYPTION_KEY, "hex");

/**
 * Encrypt a plaintext token. Returns `iv:authTag:ciphertext` as colon-joined
 * hex. A fresh random IV is generated on every call, so encrypting the same
 * plaintext twice yields different output.
 */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("hex"), authTag.toString("hex"), ciphertext.toString("hex")].join(":");
}

/**
 * Decrypt a value produced by `encryptToken()`. Throws if the format is
 * invalid or if the authentication tag does not verify (tampered or corrupted
 * ciphertext) — GCM decryption fails closed rather than returning garbage.
 */
export function decryptToken(encrypted: string): string {
  const parts = encrypted.split(":");
  const ivHex = parts[0];
  const authTagHex = parts[1];
  const ciphertextHex = parts[2];

  if (
    parts.length !== 3 ||
    ivHex === undefined ||
    authTagHex === undefined ||
    ciphertextHex === undefined
  ) {
    throw new Error("Invalid encrypted token format: expected iv:authTag:ciphertext");
  }

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return plaintext.toString("utf8");
}

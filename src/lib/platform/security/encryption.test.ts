import { describe, expect, it, vi } from "vitest";

// Provide a deterministic 32-byte (64-hex-char) key so the module under test
// does not depend on the real environment. Hoisted above the import below by
// Vitest, so the mock is in place before `encryption.ts` reads `env`.
vi.mock("@/lib/env", () => ({
  env: {
    OAUTH_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  },
}));

import { decryptToken, encryptToken } from "@/lib/platform/security/encryption";

describe("encryptToken / decryptToken", () => {
  it("round-trips a plaintext token", () => {
    const plaintext = "ya29.a0AfH6SM-example-oauth-access-token";
    expect(decryptToken(encryptToken(plaintext))).toBe(plaintext);
  });

  it("produces different ciphertext on each call (random IV)", () => {
    const plaintext = "refresh-token-value";
    expect(encryptToken(plaintext)).not.toBe(encryptToken(plaintext));
  });

  it("throws when the ciphertext has been tampered with", () => {
    const encrypted = encryptToken("sensitive-token");
    const parts = encrypted.split(":");
    const ivHex = parts[0] ?? "";
    const authTagHex = parts[1] ?? "";
    const ciphertextHex = parts[2] ?? "";

    // Flip the first hex digit of the ciphertext so the GCM auth tag no longer
    // verifies against the payload.
    const flipped = (ciphertextHex.startsWith("a") ? "b" : "a") + ciphertextHex.slice(1);
    const tampered = `${ivHex}:${authTagHex}:${flipped}`;

    expect(() => decryptToken(tampered)).toThrow();
  });

  it("throws on a malformed (wrong-shape) encrypted value", () => {
    expect(() => decryptToken("not-a-valid-token")).toThrow();
  });
});

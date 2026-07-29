import { describe, expect, it, vi } from "vitest";

/**
 * Security tests for OAuth token encryption (Step 15.1).
 *
 * These complement the baseline coverage in
 * `src/lib/platform/security/encryption.test.ts` (round-trip + per-call
 * uniqueness) with the security-critical assertions that guarantee the
 * `connections` table never leaks a usable token:
 *
 *   1. Tamper detection — a corrupted authTag or a modified IV must fail the
 *      AES-256-GCM authentication and throw, never returning garbage plaintext.
 *   2. No plaintext at rest — the ciphertext produced by `encryptToken` never
 *      contains the plaintext token substring.
 *   3. Per-call uniqueness — a fresh random IV per call means the same plaintext
 *      encrypts to different ciphertext each time (GCM must never reuse an IV
 *      under the same key).
 *
 * A deterministic 32-byte key is injected via a mocked `@/lib/env` so the module
 * under test does not depend on the real environment. This mock is hoisted above
 * the `encryption` import below, matching the pattern in the baseline test.
 */
vi.mock("@/lib/env", () => ({
  env: {
    OAUTH_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  },
}));

import { decryptToken, encryptToken } from "@/lib/platform/security/encryption";

/**
 * Flips the first hex digit of a segment so the value is guaranteed to change
 * (any non-'a' digit becomes 'a'; 'a' becomes 'b'). Used to corrupt a single
 * segment of the `iv:authTag:ciphertext` wire format.
 */
function flipFirstHexDigit(hex: string): string {
  const first = hex.startsWith("a") ? "b" : "a";
  return first + hex.slice(1);
}

/** Splits the `iv:authTag:ciphertext` wire format into its three hex segments. */
function segments(encrypted: string): { iv: string; authTag: string; ciphertext: string } {
  const parts = encrypted.split(":");
  return {
    iv: parts[0] ?? "",
    authTag: parts[1] ?? "",
    ciphertext: parts[2] ?? "",
  };
}

describe("token encryption — security invariants", () => {
  describe("round-trip", () => {
    it("decrypts back to the exact plaintext that was encrypted", () => {
      const plaintext = "ya29.a0AfH6SM-example-oauth-access-token";
      expect(decryptToken(encryptToken(plaintext))).toBe(plaintext);
    });

    it("round-trips a long refresh token unchanged", () => {
      const plaintext = "refresh:" + "x".repeat(512);
      expect(decryptToken(encryptToken(plaintext))).toBe(plaintext);
    });
  });

  describe("per-call uniqueness (random IV)", () => {
    // Baseline coverage of this invariant lives in
    // `src/lib/platform/security/encryption.test.ts`; re-asserted here because a
    // regression to a static IV is a critical GCM key-reuse vulnerability.
    it("produces different ciphertext on each call for the same plaintext", () => {
      const plaintext = "refresh-token-value";
      expect(encryptToken(plaintext)).not.toBe(encryptToken(plaintext));
    });

    it("uses a fresh IV segment on each call", () => {
      const plaintext = "same-input";
      expect(segments(encryptToken(plaintext)).iv).not.toBe(segments(encryptToken(plaintext)).iv);
    });
  });

  describe("tamper detection", () => {
    it("throws when the authTag is corrupted", () => {
      const { iv, authTag, ciphertext } = segments(encryptToken("sensitive-token"));
      const tampered = `${iv}:${flipFirstHexDigit(authTag)}:${ciphertext}`;
      expect(() => decryptToken(tampered)).toThrow();
    });

    it("throws when the IV is modified", () => {
      const { iv, authTag, ciphertext } = segments(encryptToken("sensitive-token"));
      const tampered = `${flipFirstHexDigit(iv)}:${authTag}:${ciphertext}`;
      expect(() => decryptToken(tampered)).toThrow();
    });

    it("throws when the ciphertext is corrupted", () => {
      const { iv, authTag, ciphertext } = segments(encryptToken("sensitive-token"));
      const tampered = `${iv}:${authTag}:${flipFirstHexDigit(ciphertext)}`;
      expect(() => decryptToken(tampered)).toThrow();
    });

    it("throws on a malformed (wrong-shape) encrypted value", () => {
      expect(() => decryptToken("not-a-valid-token")).toThrow();
    });
  });

  describe("no plaintext tokens at rest", () => {
    it("does not include the plaintext token substring in the ciphertext", () => {
      const plaintext = "test-token";
      const encrypted = encryptToken(plaintext);
      expect(encrypted).not.toContain(plaintext);
    });

    it("never returns the plaintext unchanged", () => {
      const plaintext = "test-token";
      expect(encryptToken(plaintext)).not.toBe(plaintext);
    });
  });
});

/**
 * Payment access token primitives — focused tests.
 *
 * Exercises the REAL production functions in payment-access-token.server.ts.
 * These are pure crypto helper tests; they do not establish authorization,
 * bind tokens to reservations, or verify any endpoint.
 */
import { describe, it, expect } from "vitest";
import {
  createPaymentAccessToken,
  hashPaymentAccessToken,
  matchesPaymentAccessToken,
} from "@/lib/server/payment-access-token.server";

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

describe("payment access token primitives", () => {
  /* ----------------------------- createPaymentAccessToken ----------------------------- */

  describe("createPaymentAccessToken", () => {
    it("produces a 43-char base64url token and 64-char hex hash", () => {
      const { token, tokenHash } = createPaymentAccessToken();
      expect(token).toHaveLength(43);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(tokenHash).toHaveLength(64);
      expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("hash matches re-hashing the same token", () => {
      const { token, tokenHash } = createPaymentAccessToken();
      expect(hashPaymentAccessToken(token)).toBe(tokenHash);
    });

    it("produces distinct tokens across repeated calls", () => {
      const a = createPaymentAccessToken();
      const b = createPaymentAccessToken();
      expect(a.token).not.toBe(b.token);
      expect(a.tokenHash).not.toBe(b.tokenHash);
    });
  });

  /* ----------------------------- hashPaymentAccessToken ----------------------------- */

  describe("hashPaymentAccessToken", () => {
    it("is deterministic for the same token", () => {
      const { token } = createPaymentAccessToken();
      expect(hashPaymentAccessToken(token)).toBe(hashPaymentAccessToken(token));
    });

    it("returns null for non-string input", () => {
      expect(hashPaymentAccessToken(null)).toBeNull();
      expect(hashPaymentAccessToken(undefined)).toBeNull();
      expect(hashPaymentAccessToken(42)).toBeNull();
      expect(hashPaymentAccessToken(true)).toBeNull();
      expect(hashPaymentAccessToken(false)).toBeNull();
      expect(hashPaymentAccessToken({})).toBeNull();
      expect(hashPaymentAccessToken([])).toBeNull();
    });

    it("returns null for wrong-length strings", () => {
      expect(hashPaymentAccessToken("")).toBeNull();
      expect(hashPaymentAccessToken("abc")).toBeNull();
      expect(hashPaymentAccessToken("A".repeat(42))).toBeNull();
      expect(hashPaymentAccessToken("A".repeat(44))).toBeNull();
    });

    it("returns null for non-base64url characters", () => {
      // 43 chars but contains '+' (standard base64, not base64url)
      expect(hashPaymentAccessToken("A".repeat(42) + "+")).toBeNull();
      // Contains '=' (padding — not in base64url)
      expect(hashPaymentAccessToken("A".repeat(42) + "=")).toBeNull();
    });

    it("returns null for noncanonical encoding (padding bits set)", () => {
      const { token } = createPaymentAccessToken();
      const lastIdx = BASE64URL_ALPHABET.indexOf(token[token.length - 1]);
      // For 32-byte input the last char index is always a multiple of 4
      // (lower 2 padding bits must be zero). Flipping to lastIdx + 1
      // preserves the upper 4 bits but sets a non-zero padding bit,
      // producing a noncanonical encoding that decodes to the same 32
      // bytes but re-encodes to a different (canonical) last character.
      const noncanonicalLast = BASE64URL_ALPHABET[lastIdx + 1];
      const noncanonical = token.slice(0, -1) + noncanonicalLast;
      expect(noncanonical).not.toBe(token);
      expect(hashPaymentAccessToken(noncanonical)).toBeNull();
    });
  });

  /* ----------------------------- matchesPaymentAccessToken ----------------------------- */

  describe("matchesPaymentAccessToken", () => {
    it("returns true for a correct token and its stored hash", () => {
      const { token, tokenHash } = createPaymentAccessToken();
      expect(matchesPaymentAccessToken(token, tokenHash)).toBe(true);
    });

    it("returns false for a different valid token with the same hash", () => {
      const a = createPaymentAccessToken();
      const b = createPaymentAccessToken();
      expect(matchesPaymentAccessToken(b.token, a.tokenHash)).toBe(false);
    });

    it("returns false for a malformed token", () => {
      const { tokenHash } = createPaymentAccessToken();
      expect(matchesPaymentAccessToken("not-a-token", tokenHash)).toBe(false);
      expect(matchesPaymentAccessToken(null, tokenHash)).toBe(false);
      expect(matchesPaymentAccessToken(42, tokenHash)).toBe(false);
      expect(matchesPaymentAccessToken("", tokenHash)).toBe(false);
    });

    it("returns false for a malformed hash", () => {
      const { token } = createPaymentAccessToken();
      expect(matchesPaymentAccessToken(token, null)).toBe(false);
      expect(matchesPaymentAccessToken(token, undefined)).toBe(false);
      expect(matchesPaymentAccessToken(token, 42)).toBe(false);
      expect(matchesPaymentAccessToken(token, "")).toBe(false);
      expect(matchesPaymentAccessToken(token, "abc")).toBe(false);
      // Uppercase hex is rejected (hash must be lowercase)
      expect(matchesPaymentAccessToken(token, "A".repeat(64))).toBe(false);
      // Non-hex character
      expect(matchesPaymentAccessToken(token, "0".repeat(63) + "g")).toBe(false);
      // Wrong length (63 chars)
      expect(matchesPaymentAccessToken(token, "0".repeat(63))).toBe(false);
      // Wrong length (65 chars)
      expect(matchesPaymentAccessToken(token, "0".repeat(65))).toBe(false);
    });

    it("returns false when both token and hash are invalid", () => {
      expect(matchesPaymentAccessToken(null, null)).toBe(false);
      expect(matchesPaymentAccessToken(42, "abc")).toBe(false);
      expect(matchesPaymentAccessToken("", "")).toBe(false);
    });

    it("does not throw for any input type", () => {
      const { token, tokenHash } = createPaymentAccessToken();
      expect(() => matchesPaymentAccessToken(token, tokenHash)).not.toThrow();
      expect(() => matchesPaymentAccessToken(null, tokenHash)).not.toThrow();
      expect(() => matchesPaymentAccessToken(token, null)).not.toThrow();
      expect(() => matchesPaymentAccessToken(undefined, undefined)).not.toThrow();
    });
  });
});

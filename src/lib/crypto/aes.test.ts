import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, last4, maskedKey, parseMasterKey, safeEqual } from "./aes";

const KEY_HEX = "0".repeat(62) + "ab";

describe("aes-256-gcm secrets", () => {
  it("round-trips and never stores plaintext", () => {
    const mk = parseMasterKey(KEY_HEX);
    const blob = encryptSecret("pro_live_secret_9999", mk);
    expect(JSON.stringify(blob)).not.toContain("pro_live_secret");
    expect(decryptSecret(blob, mk)).toBe("pro_live_secret_9999");
    expect(Buffer.from(blob.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(blob.tag, "base64")).toHaveLength(16);
  });

  it("uses a fresh IV every time", () => {
    const mk = parseMasterKey(KEY_HEX);
    const a = encryptSecret("same", mk);
    const b = encryptSecret("same", mk);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("fails on tampering or a wrong key", () => {
    const mk = parseMasterKey(KEY_HEX);
    const other = parseMasterKey("1".repeat(64));
    const blob = encryptSecret("secret", mk);
    expect(() => decryptSecret(blob, other)).toThrow();
    const tampered = { ...blob, tag: Buffer.alloc(16, 1).toString("base64") };
    expect(() => decryptSecret(tampered, mk)).toThrow();
  });

  it("validates MASTER_KEY without echoing it", () => {
    expect(() => parseMasterKey(undefined)).toThrow(/not set/);
    expect(() => parseMasterKey("deadbeef")).toThrow(/64 hex/);
    try {
      parseMasterKey("zz" + "0".repeat(62));
    } catch (e) {
      expect(String(e)).not.toContain("zz00");
    }
  });

  it("masks keys to the last 4 characters", () => {
    expect(last4("abcd1234")).toBe("1234");
    expect(last4("ab")).toBe("");
    expect(maskedKey("1234")).toBe("••••1234");
  });

  it("safeEqual compares in constant time semantics", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

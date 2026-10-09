/**
 * AES-256-GCM for user API keys and seats.aero sign-in tokens at rest (kickoff §0.2 #8, §5).
 * MASTER_KEY: 64 hex chars (32 bytes) from the environment. Never logged.
 *
 * `aad` (optional) is authenticated but not encrypted: a blob sealed for one context (the seats.aero tokens bind the
 * account id) fails to open under any other, so a row copied onto another account cannot be read there.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

export interface EncryptedBlob {
  ciphertext: string; // base64
  iv: string; // base64 (12 bytes)
  tag: string; // base64 (16 bytes)
}

export class MasterKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MasterKeyError";
  }
}

/** Parse and validate a MASTER_KEY value. Throws without echoing the value. */
export function parseMasterKey(hex: string | undefined): Buffer {
  if (!hex) throw new MasterKeyError("MASTER_KEY is not set (64 hex chars required)");
  const clean = hex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new MasterKeyError("MASTER_KEY must be exactly 64 hex characters (32 bytes)");
  }
  return Buffer.from(clean, "hex");
}

export function encryptSecret(plaintext: string, masterKey: Buffer, aad?: string): EncryptedBlob {
  if (masterKey.length !== 32) throw new MasterKeyError("master key must be 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  if (aad !== undefined) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: ct.toString("base64"), iv: iv.toString("base64"), tag: tag.toString("base64") };
}

export function decryptSecret(blob: EncryptedBlob, masterKey: Buffer, aad?: string): string {
  if (masterKey.length !== 32) throw new MasterKeyError("master key must be 32 bytes");
  const decipher = createDecipheriv("aes-256-gcm", masterKey, Buffer.from(blob.iv, "base64"));
  if (aad !== undefined) decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(blob.ciphertext, "base64")), decipher.final()]);
  return pt.toString("utf8");
}

/** Last 4 characters for display ("••••1234"); shorter secrets are fully masked. */
export function last4(secret: string): string {
  return secret.length >= 4 ? secret.slice(-4) : "";
}

export function maskedKey(l4: string): string {
  return `••••${l4}`;
}

/** Constant-time string comparison for tokens. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

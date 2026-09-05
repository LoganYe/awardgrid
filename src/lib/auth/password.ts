/**
 * Password hashing with argon2id via @node-rs/argon2 (prebuilt N-API binaries for
 * darwin-arm64, linux-x64/arm64 glibc and musl — no build step; see DECISIONS.md).
 */
import { hash, verify } from "@node-rs/argon2";

/** Algorithm.Argon2id — a const enum in the package types (value 2); inlined because isolatedModules forbids ambient const enums. */
const ARGON2ID = 2;

const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) throw new Error("password must be at least 8 characters");
  return hash(password, OPTIONS);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password, OPTIONS);
  } catch {
    return false;
  }
}

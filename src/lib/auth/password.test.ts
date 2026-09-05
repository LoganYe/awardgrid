import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("argon2id passwords", () => {
  it("hashes and verifies", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
  it("rejects short passwords and garbage hashes", async () => {
    await expect(hashPassword("short")).rejects.toThrow(/8 characters/);
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });
});

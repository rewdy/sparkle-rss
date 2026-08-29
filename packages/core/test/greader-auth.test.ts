import { describe, expect, it } from "vitest";
import {
  deriveAuthSecret,
  deriveWriteToken,
  sha256Hex,
} from "../src/services/greader-auth";

describe("greader auth derivations", () => {
  it("produces stable userId-prefixed secrets", () => {
    const a = deriveAuthSecret("k", "user-1", "hash-a");
    const b = deriveAuthSecret("k", "user-1", "hash-a");
    expect(a).toBe(b);
    expect(a.startsWith("user-1/")).toBe(true);
    expect(deriveAuthSecret("k2", "user-1", "hash-a")).not.toBe(a);
    expect(deriveAuthSecret("k", "user-1", "hash-b")).not.toBe(a);
  });

  it("derives the 57-char padded write token", () => {
    const token = deriveWriteToken("key", "u");
    expect(token).toHaveLength(57);
    expect(token.endsWith("Z".repeat(17))).toBe(true);
    expect(deriveWriteToken("key", "other")).not.toBe(token);
  });

  it("sha256Hex is hex and stable", () => {
    expect(sha256Hex("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
  });
});

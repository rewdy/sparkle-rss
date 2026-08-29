import { describe, expect, it } from "vitest";
import { normalizeGreaderRequestPath } from "../src/greader/path";

describe("greader path normalization", () => {
  it("strips optional /api and /greader.php prefixes", () => {
    expect(
      normalizeGreaderRequestPath("/api/greader.php/reader/api/0/token"),
    ).toBe("/reader/api/0/token");
    expect(
      normalizeGreaderRequestPath("/greader.php/accounts/ClientLogin"),
    ).toBe("/accounts/ClientLogin");
    expect(normalizeGreaderRequestPath("/api/greader.php")).toBe("");
    expect(normalizeGreaderRequestPath("/reader/api/0/user-info")).toBe(
      "/reader/api/0/user-info",
    );
  });
});

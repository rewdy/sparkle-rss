import { describe, expect, it } from "vitest";
import { parseGoogleLoginHeader } from "../src/greader/auth-header";

describe("GoogleLogin header parsing", () => {
  it("parses the canonical spelling", () => {
    expect(parseGoogleLoginHeader("GoogleLogin auth=alice/abc123")).toEqual({
      user: "alice",
      secret: "abc123",
    });
  });

  it("parses the PHP space-to-underscore mangling", () => {
    expect(parseGoogleLoginHeader("GoogleLogin_auth=bob/sec")).toEqual({
      user: "bob",
      secret: "sec",
    });
  });

  it("keeps slashes inside secrets intact", () => {
    expect(parseGoogleLoginHeader("GoogleLogin auth=a/b/c")).toEqual({
      user: "a",
      secret: "b/c",
    });
  });

  it("returns null for missing or malformed headers", () => {
    expect(parseGoogleLoginHeader(null)).toBeNull();
    expect(parseGoogleLoginHeader(undefined)).toBeNull();
    expect(parseGoogleLoginHeader("Bearer xyz")).toBeNull();
    expect(parseGoogleLoginHeader("GoogleLogin auth=noseparator")).toBeNull();
    expect(parseGoogleLoginHeader("GoogleLogin auth=/leadingslash")).toBeNull();
  });
});

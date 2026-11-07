import { describe, expect, it } from "vitest";
import { ApiError } from "../src/lib/api";
import { SessionExpiredError } from "../src/lib/auth";
import { loginPath, subscriptionReturnTo } from "../src/lib/login-return";
import {
  canOfferRssFinder,
  isHttpUrl,
  rssFinderUrl,
} from "../src/lib/subscription-discovery";

describe("subscription links", () => {
  it("encodes a complete original source as one query value", () => {
    const source = "https://blog.test/post?q=é&next=2#comments";
    const link = new URL(rssFinderUrl(source));
    expect(link.origin + link.pathname).toBe("https://rssfinder.app/");
    expect([...link.searchParams]).toEqual([["q", source]]);
    expect(isHttpUrl(source)).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("bad")).toBe(false);
  });
  it("excludes invalid, authentication, and duplicate errors", () => {
    for (const status of [400, 401, 403, 409])
      expect(canOfferRssFinder(new ApiError(status, "error"))).toBe(false);
    expect(canOfferRssFinder(new SessionExpiredError())).toBe(false);
    expect(canOfferRssFinder(new ApiError(422, "no feed"))).toBe(true);
    expect(canOfferRssFinder(new Error("network"))).toBe(true);
  });
});

describe("subscription authentication return", () => {
  it("round trips the internal destination and nested source parameters", () => {
    const path = `/subscribe?${new URLSearchParams({ url: "https://blog.test/post?q=1&other=2", title: "Blog", popup: "1" })}`;
    const login = new URL(loginPath(path), "https://sparkle.test");
    expect(subscriptionReturnTo(login.searchParams.get("returnTo"))).toBe(path);
  });
  it.each([
    null,
    "",
    "//evil.test/subscribe",
    "https://evil.test/subscribe",
    "/\\evil.test/subscribe",
    "/subscribe%zz",
    "/all",
    "/a/../subscribe",
    "/subscribe?bad=%zz",
    "/subscribe\n",
    "/subscribe#fragment",
  ])("rejects unsafe or unsupported destination %s", (value) => {
    expect(subscriptionReturnTo(value)).toBe("/");
  });
  it("keeps ordinary sign-in unchanged", () =>
    expect(loginPath("/all")).toBe("/login"));
});

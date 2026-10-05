import { describe, expect, it, vi } from "vitest";
import { createAuthApi } from "../src/apps/auth-api";
import type { CognitoAuth } from "../src/auth/cognito";

function mockAuth(overrides: Partial<CognitoAuth> = {}): CognitoAuth {
  return {
    signIn: vi.fn().mockResolvedValue({
      type: "authenticated",
      tokens: { accessToken: "access", refreshToken: "refresh" },
    }),
    completeNewPassword: vi
      .fn()
      .mockResolvedValue({ accessToken: "access", refreshToken: "refresh" }),
    refresh: vi.fn().mockResolvedValue("renewed-access"),
    revoke: vi.fn().mockResolvedValue(undefined),
    forgotPassword: vi.fn().mockResolvedValue(undefined),
    confirmForgotPassword: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("first-party auth API", () => {
  it("sets an HttpOnly seven-day refresh cookie and returns only the access token", async () => {
    const app = createAuthApi(mockAuth());
    const response = await app.request("/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "reader", password: "secret" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ accessToken: "access" });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("sparkle_refresh=refresh");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Max-Age=604800");
    expect(cookie).toContain("Path=/api/auth");
  });

  it("returns the temporary password challenge without issuing a token", async () => {
    const app = createAuthApi(
      mockAuth({
        signIn: vi.fn().mockResolvedValue({
          type: "new-password-required",
          session: "challenge",
        }),
      }),
    );
    const response = await app.request("/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "reader", password: "temporary" }),
    });
    expect(await response.json()).toEqual({
      challenge: "new-password-required",
      session: "challenge",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("maps invalid credentials to a non-sensitive sign-in error", async () => {
    const app = createAuthApi(
      mockAuth({
        signIn: vi.fn().mockRejectedValue({ name: "NotAuthorizedException" }),
      }),
    );
    const response = await app.request("/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "reader", password: "wrong" }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "auth_rejected",
      message: "Check your details and try again.",
    });
  });

  it("renews from the refresh cookie and clears it when Cognito rejects it", async () => {
    const auth = mockAuth({
      refresh: vi.fn().mockRejectedValue(new Error("invalid refresh")),
    });
    const app = createAuthApi(auth);
    const response = await app.request("/refresh", {
      method: "POST",
      headers: { Cookie: "sparkle_refresh=stale" },
    });
    expect(response.status).toBe(401);
    expect(auth.refresh).toHaveBeenCalledWith("stale");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("revokes the refresh token on sign-out", async () => {
    const auth = mockAuth();
    const response = await createAuthApi(auth).request("/sign-out", {
      method: "POST",
      headers: { Cookie: "sparkle_refresh=refresh" },
    });
    expect(response.status).toBe(204);
    expect(auth.revoke).toHaveBeenCalledWith("refresh");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("does not reveal whether a password-reset account exists", async () => {
    const auth = mockAuth({
      forgotPassword: vi
        .fn()
        .mockRejectedValue(new Error("UserNotFoundException")),
    });
    const response = await createAuthApi(auth).request("/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "unknown" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message:
        "If an account matches, password reset instructions will be sent.",
    });
  });
});

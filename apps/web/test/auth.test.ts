import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("first-party session client", () => {
  it("restores a session from the HttpOnly cookie with a same-origin renewal request", async () => {
    vi.stubEnv("VITE_AUTH_DISABLED", "false");
    const { accessToken } = await import("../src/lib/auth");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accessToken: "restored-token" }), {
        status: 200,
      }),
    );
    await expect(accessToken()).resolves.toBe("restored-token");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/refresh",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
  });

  it("treats a rejected refresh cookie as an expired session", async () => {
    vi.stubEnv("VITE_AUTH_DISABLED", "false");
    const { renewToken, SessionExpiredError } = await import("../src/lib/auth");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "sign_in_required" }), {
        status: 401,
      }),
    );
    await expect(renewToken()).rejects.toBeInstanceOf(SessionExpiredError);
  });
});

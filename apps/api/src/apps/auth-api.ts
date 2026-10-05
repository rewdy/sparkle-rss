import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { type CognitoAuth, createCognitoAuth } from "../auth/cognito";
import { env } from "../env";

const REFRESH_COOKIE = "sparkle_refresh";
const REFRESH_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "Strict" as const,
  path: "/api/auth",
};
const credentialSchema = z.object({
  username: z.string().min(1).max(256),
  password: z.string().min(1).max(256),
});

function providerError(error: unknown): {
  status: number;
  code: string;
  message: string;
} {
  const name = (error as { name?: string })?.name ?? "";
  if (
    [
      "NotAuthorizedException",
      "UserNotFoundException",
      "CodeMismatchException",
      "ExpiredCodeException",
      "InvalidPasswordException",
      "LimitExceededException",
      "TooManyRequestsException",
    ].includes(name)
  ) {
    return {
      status: 400,
      code: "auth_rejected",
      message: "Check your details and try again.",
    };
  }
  return {
    status: 502,
    code: "auth_provider_error",
    message: "Authentication is temporarily unavailable. Try again.",
  };
}

export function createAuthApi(
  auth: CognitoAuth = createCognitoAuth(env.cognitoClientId ?? ""),
) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  app.post("/sign-in", async (c) => {
    const parsed = credentialSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    try {
      const result = await auth.signIn(
        parsed.data.username,
        parsed.data.password,
      );
      if (result.type === "new-password-required") {
        return c.json({
          challenge: "new-password-required",
          session: result.session,
        });
      }
      if (result.tokens.refreshToken) {
        setCookie(c, REFRESH_COOKIE, result.tokens.refreshToken, {
          ...cookieOptions,
          maxAge: REFRESH_MAX_AGE_SECONDS,
        });
      }
      return c.json({ accessToken: result.tokens.accessToken });
    } catch (error) {
      const mapped = providerError(error);
      return c.json(
        { error: mapped.code, message: mapped.message },
        mapped.status as 400 | 502,
      );
    }
  });

  app.post("/complete-new-password", async (c) => {
    const schema = z.object({
      username: z.string().min(1).max(256),
      newPassword: z.string().min(12).max(256),
      session: z.string().min(1).max(4096),
    });
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    try {
      const tokens = await auth.completeNewPassword(
        parsed.data.username,
        parsed.data.newPassword,
        parsed.data.session,
      );
      if (tokens.refreshToken)
        setCookie(c, REFRESH_COOKIE, tokens.refreshToken, {
          ...cookieOptions,
          maxAge: REFRESH_MAX_AGE_SECONDS,
        });
      return c.json({ accessToken: tokens.accessToken });
    } catch (error) {
      const mapped = providerError(error);
      return c.json(
        { error: mapped.code, message: mapped.message },
        mapped.status as 400 | 502,
      );
    }
  });

  app.post("/refresh", async (c) => {
    const refreshToken = getCookie(c, REFRESH_COOKIE);
    if (!refreshToken) return c.json({ error: "sign_in_required" }, 401);
    try {
      return c.json({ accessToken: await auth.refresh(refreshToken) });
    } catch {
      deleteCookie(c, REFRESH_COOKIE, cookieOptions);
      return c.json({ error: "sign_in_required" }, 401);
    }
  });

  app.post("/sign-out", async (c) => {
    const refreshToken = getCookie(c, REFRESH_COOKIE);
    if (refreshToken) await auth.revoke(refreshToken).catch(() => {});
    deleteCookie(c, REFRESH_COOKIE, cookieOptions);
    return c.body(null, 204);
  });

  app.post("/forgot-password", async (c) => {
    const parsed = z
      .object({ username: z.string().min(1).max(256) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    await auth.forgotPassword(parsed.data.username).catch(() => {});
    return c.json({
      message:
        "If an account matches, password reset instructions will be sent.",
    });
  });

  app.post("/confirm-reset", async (c) => {
    const parsed = z
      .object({
        username: z.string().min(1).max(256),
        code: z.string().min(1).max(64),
        password: z.string().min(12).max(256),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        {
          error: "invalid_request",
          message: "Check the code and password, then try again.",
        },
        400,
      );
    try {
      await auth.confirmForgotPassword(
        parsed.data.username,
        parsed.data.code,
        parsed.data.password,
      );
      return c.json({ message: "Password updated. You can now sign in." });
    } catch (error) {
      const mapped = providerError(error);
      return c.json(
        {
          error: mapped.code,
          message:
            "The code may be incorrect or expired. Request a new code and try again.",
        },
        mapped.status as 400 | 502,
      );
    }
  });
  return app;
}

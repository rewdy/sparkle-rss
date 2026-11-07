// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Login } from "../src/pages/Login";

function renderLogin(): void {
  render(
    <MantineProvider>
      <Login />
    </MantineProvider>,
  );
}

function inputFor(autoComplete: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    `input[autocomplete="${autoComplete}"]`,
  );
  if (!input)
    throw new Error(`Missing input with autocomplete ${autoComplete}`);
  return input;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("first-party login", () => {
  it("lets an invited user complete the required first-password challenge", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            challenge: "new-password-required",
            session: "challenge",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: "token" }), { status: 200 }),
      );
    const user = userEvent.setup();
    renderLogin();

    await user.type(inputFor("username"), "reader");
    await user.type(inputFor("current-password"), "temporary-password");
    await user.click(screen.getByRole("button", { name: "sign in" }));
    expect(
      await screen.findByText(/temporary password must be replaced/i),
    ).toBeInTheDocument();
    await user.type(inputFor("new-password"), "Stronger-password-42!");
    await user.click(screen.getByRole("button", { name: "set password" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/auth/complete-new-password",
    );
  });

  it("shows a useful sign-in error without leaving the login screen", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "auth_rejected",
          message: "Check your details and try again.",
        }),
        { status: 400 },
      ),
    );
    renderLogin();
    fireEvent.change(inputFor("username"), {
      target: { value: "reader" },
    });
    fireEvent.change(inputFor("current-password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "sign in" }));
    expect(
      await screen.findByText("Check your details and try again."),
    ).toBeInTheDocument();
  });

  it("shows generic acknowledgement after requesting password recovery", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          message:
            "If an account matches, password reset instructions will be sent.",
        }),
        { status: 200 },
      ),
    );
    const user = userEvent.setup();
    renderLogin();
    await user.click(
      screen.getByRole("button", { name: "Forgot your password?" }),
    );
    await user.type(inputFor("username"), "reader@example.com");
    await user.click(screen.getByRole("button", { name: "send reset code" }));
    expect(
      await screen.findByText(/If an account matches/),
    ).toBeInTheDocument();
    expect(inputFor("one-time-code")).toBeInTheDocument();
  });
});

it.each([false, true])(
  "resumes the subscription destination after sign-in (password challenge: %s)",
  async (challenge) => {
    const destination = `/subscribe?${new URLSearchParams({ url: "https://blog.test/post?a=1&b=2", title: "Blog", popup: "1" })}`;
    window.history.replaceState(
      null,
      "",
      `/login?${new URLSearchParams({ returnTo: destination })}`,
    );
    const fetcher = vi.spyOn(globalThis, "fetch");
    if (challenge)
      fetcher.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            challenge: "new-password-required",
            session: "challenge",
          }),
        ),
      );
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ accessToken: "token" })),
    );
    renderLogin();
    fireEvent.change(inputFor("username"), { target: { value: "reader" } });
    fireEvent.change(inputFor("current-password"), {
      target: { value: "temporary-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "sign in" }));
    if (challenge) {
      await screen.findByText(/temporary password must be replaced/);
      fireEvent.change(inputFor("new-password"), {
        target: { value: "Stronger-password-42!" },
      });
      fireEvent.click(screen.getByRole("button", { name: "set password" }));
    }
    await waitFor(() =>
      expect(window.location.pathname + window.location.search).toBe(
        destination,
      ),
    );
    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).includes("/subscriptions"),
      ),
    ).toBe(false);
    window.history.replaceState(null, "", "/");
  },
);

it("keeps ordinary and untrusted-return sign-in on the normal landing page", async () => {
  for (const path of [
    "/login",
    "/login?returnTo=https%3A%2F%2Fevil.test%2Fsubscribe",
  ]) {
    window.history.replaceState(null, "", path);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accessToken: "token" })),
    );
    renderLogin();
    fireEvent.change(inputFor("username"), { target: { value: "reader" } });
    fireEvent.change(inputFor("current-password"), {
      target: { value: "password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "sign in" }));
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    cleanup();
    vi.restoreAllMocks();
  }
});

// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { navigate } from "wouter/use-browser-location";
import { parseRoute } from "../src/lib/keys";
import { readerNavigation } from "../src/lib/reader-navigation";

const key = "sparkle.readerNavigation";
beforeEach(() =>
  window.history.replaceState({ other: "retained" }, "", "/feed/5?sort=asc"),
);
it("retains the full origin and unrelated state through steps and a new helper instance", () => {
  readerNavigation(navigate).open("/feed/5/e/1?sort=asc");
  readerNavigation(navigate).open("/feed/5/e/2?sort=asc");
  expect(window.history.state.other).toBe("retained");
  expect(window.history.state[key].origin).toBe("/feed/5?sort=asc");
  const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
  readerNavigation(navigate).close("/feed/5?sort=asc");
  expect(back).toHaveBeenCalledOnce();
  back.mockRestore();
});
it("recognizes a legacy story origin in existing reader history", () => {
  window.history.replaceState(
    {
      [key]: {
        version: 1,
        kind: "reader",
        surfaceId: "legacy",
        origin: "/feed/5/story/12?sort=asc",
      },
    },
    "",
    "/feed/5/e/2?sort=asc",
  );
  const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
  try {
    readerNavigation(navigate).close("/feed/5?sort=asc");
    expect(back).toHaveBeenCalledOnce();
  } finally {
    back.mockRestore();
  }
});
it.each([
  null,
  {},
  { version: 0 },
  {
    version: 1,
    kind: "reader",
    surfaceId: "x",
    origin: "https://evil.test/all",
  },
  { version: 1, kind: "reader", surfaceId: "x", origin: "//evil.test/all" },
  { version: 1, kind: "reader", surfaceId: "x", origin: "/feed/6" },
  { version: 1, kind: "reader", surfaceId: "x", origin: "/feed/5/e/9" },
])("safely replaces invalid origin metadata: %j", (metadata) => {
  window.history.replaceState(
    { other: "retained", [key]: metadata },
    "",
    "/feed/5/e/2",
  );
  const length = window.history.length;
  readerNavigation(navigate).close("/feed/5");
  expect(window.location.pathname).toBe("/feed/5");
  expect(window.history.length).toBe(length);
  expect(window.history.state).toEqual({ other: "retained" });
});
it("new surface opening replaces stale session metadata", () => {
  readerNavigation(navigate).open("/feed/5/e/1");
  navigate("/read-later");
  readerNavigation(navigate).open("/read-later/e/url-item");
  expect(window.history.state[key].origin).toBe("/read-later");
});
it("Saved images get the same session policy", () => {
  navigate("/starred?sort=asc");
  readerNavigation(navigate).open(
    "/starred/images/11111111-1111-1111-1111-111111111111?sort=asc",
  );
  const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
  readerNavigation(navigate).close("/starred?sort=asc");
  expect(back).toHaveBeenCalledOnce();
  back.mockRestore();
});

it("opens articles without the secure-context-only randomUUID API", () => {
  const descriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    value: undefined,
  });
  try {
    readerNavigation(navigate).open("/feed/5/e/1?sort=asc");
    expect(window.location.pathname).toBe("/feed/5/e/1");
    const first = window.history.state[key].surfaceId;
    expect(first).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{8}){3}$/);
    expect(window.history.state[key].origin).toBe("/feed/5?sort=asc");
    navigate("/all");
    readerNavigation(navigate).open("/all/e/2");
    expect(window.history.state[key].surfaceId).not.toBe(first);
  } finally {
    if (descriptor) Object.defineProperty(crypto, "randomUUID", descriptor);
    else Reflect.deleteProperty(crypto, "randomUUID");
  }
});

it.each(["all", "today", "unread"])(
  "replaces the reader with the %s end and restores it via Forward",
  async (channel) => {
    const surface = `/${channel}?filter=unread&sort=asc`;
    const end = `/${channel}/e/9/end?filter=unread&sort=asc`;
    window.history.replaceState(null, "", surface);
    readerNavigation(navigate).open(`/${channel}/e/9?filter=unread&sort=asc`);
    const length = window.history.length;
    readerNavigation(navigate).open(end);
    expect(window.history.length).toBe(length);
    expect(parseRoute(window.location.pathname)?.endAfterId).toBe("9");
    const back = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    readerNavigation(navigate).close(surface);
    await back;
    expect(window.location.pathname + window.location.search).toBe(surface);
    const forward = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    window.history.forward();
    await forward;
    expect(window.location.pathname + window.location.search).toBe(end);
  },
);

it("direct end links replace to their parent and unsupported streams reject end routes", () => {
  window.history.replaceState(null, "", "/today/e/9/end?sort=asc");
  const length = window.history.length;
  readerNavigation(navigate).close("/today?sort=asc");
  expect(window.location.pathname + window.location.search).toBe(
    "/today?sort=asc",
  );
  expect(window.history.length).toBe(length);
  for (const stream of ["feed/5", "folder/5", "read-later", "starred"]) {
    expect(parseRoute(`/${stream}/e/9/end`)).toBeNull();
  }
});

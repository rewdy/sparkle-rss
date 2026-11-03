// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { navigate } from "wouter/use-browser-location";
import { readerNavigation } from "../src/lib/reader-navigation";

const key = "sparkle.readerNavigation";
beforeEach(() =>
  window.history.replaceState(
    { other: "retained" },
    "",
    "/feed/5/story/12?sort=asc",
  ),
);
it("retains the full origin and unrelated state through steps and a new helper instance", () => {
  readerNavigation(navigate).open("/feed/5/e/1?sort=asc");
  readerNavigation(navigate).open("/feed/5/e/2?sort=asc");
  expect(window.history.state.other).toBe("retained");
  expect(window.history.state[key].origin).toBe("/feed/5/story/12?sort=asc");
  const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
  readerNavigation(navigate).close("/feed/5?sort=asc");
  expect(back).toHaveBeenCalledOnce();
  back.mockRestore();
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

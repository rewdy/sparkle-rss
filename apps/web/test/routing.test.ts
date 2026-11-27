import { describe, expect, it } from "vitest";
import { dayGroup, groupByDay, timeLabel } from "../src/lib/date-grouping";
import {
  filterFromSearch,
  legacyStoryStream,
  localDateKey,
  localMidnightIso,
  parseRoute,
  sortFromSearch,
  streamKey,
  streamPath,
  viewSearch,
} from "../src/lib/keys";

describe("parseRoute", () => {
  it("leaves the root to account home resolution", () => {
    expect(parseRoute("/")).toBeNull();
  });

  it("parses fixed streams", () => {
    expect(parseRoute("/all")).toEqual({
      stream: { kind: "all" },
      entryId: null,
    });
    expect(parseRoute("/starred")).toEqual({
      stream: { kind: "starred" },
      entryId: null,
    });
    expect(parseRoute("/today")).toEqual({
      stream: { kind: "today" },
      entryId: null,
    });
    expect(parseRoute("/unread")).toEqual({
      stream: { kind: "unread" },
      entryId: null,
    });
    expect(parseRoute("/read-later")).toEqual({
      stream: { kind: "readLater" },
      entryId: null,
    });
  });

  it("parses parameterized streams", () => {
    expect(parseRoute("/feed/5")).toEqual({
      stream: { kind: "feed", id: "5" },
      entryId: null,
    });
    expect(parseRoute("/folder/2")).toEqual({
      stream: { kind: "folder", id: "2" },
      entryId: null,
    });
  });

  it("parses entry routes", () => {
    expect(parseRoute("/all/e/123")).toEqual({
      stream: { kind: "all" },
      entryId: "123",
    });
    expect(parseRoute("/feed/5/e/123")).toEqual({
      stream: { kind: "feed", id: "5" },
      entryId: "123",
    });
    expect(parseRoute("/today/e/9")).toEqual({
      stream: { kind: "today" },
      entryId: "9",
    });
  });

  it.each([
    "/all",
    "/today",
    "/unread",
    "/feed/5",
    "/folder/2",
    "/read-later",
    "/starred",
  ])(
    "recognizes retired story links for %s independently of normal routing",
    (path) => {
      expect(parseRoute(`${path}/story/3`)).toBeNull();
      expect(legacyStoryStream(`${path}/story/3`)).toEqual(
        parseRoute(path)?.stream,
      );
    },
  );

  it.each([
    "/all/story/-1",
    "/all/story/nope",
    "/all/story/1/e/2",
    "/all/e/1/story/2",
    "/unknown/story/1",
    "/starred/images/12345678-1234-1234-1234-123456789012/story/0",
  ])("does not rewrite unrelated or malformed path %s", (path) =>
    expect(legacyStoryStream(path)).toBeNull(),
  );

  it("parses read-later item routes but not the save form", () => {
    expect(parseRoute("/read-later/e/item-uuid")).toEqual({
      stream: { kind: "readLater" },
      entryId: "item-uuid",
    });
    expect(parseRoute("/read-later/new")).toBeNull();
  });

  it("rejects unknown and settings paths", () => {
    expect(parseRoute("/settings")).toBeNull();
    expect(parseRoute("/nope")).toBeNull();
  });
});

describe("streamKey / streamPath", () => {
  it("produces distinct, stable cache keys per kind", () => {
    expect(streamKey({ kind: "all" })).toBe("all");
    expect(streamKey({ kind: "starred" })).toBe("starred");
    expect(streamKey({ kind: "unread" })).toBe("unread");
    expect(streamKey({ kind: "feed", id: "5" })).toBe("feed:5");
    expect(streamKey({ kind: "folder", id: "2" })).toBe("folder:2");
    expect(streamKey({ kind: "readLater" })).toBe("read-later");
  });

  it("keys today by calendar date so it rolls over at midnight", () => {
    expect(streamKey({ kind: "today" })).toMatch(/^today:\d{4}-\d{2}-\d{2}$/);
  });

  it("maps descriptors to their canonical paths", () => {
    expect(streamPath({ kind: "all" })).toBe("/all");
    expect(streamPath({ kind: "starred" })).toBe("/starred");
    expect(streamPath({ kind: "feed", id: "5" })).toBe("/feed/5");
    expect(streamPath({ kind: "folder", id: "2" })).toBe("/folder/2");
    expect(streamPath({ kind: "readLater" })).toBe("/read-later");
  });
});

describe("view URL params", () => {
  it("reads filter and sort, defaulting to all/desc", () => {
    expect(filterFromSearch("")).toBe("all");
    expect(filterFromSearch("?filter=unread")).toBe("unread");
    expect(sortFromSearch("?sort=asc")).toBe("asc");
    expect(sortFromSearch("?sort=desc")).toBe("desc");
    expect(sortFromSearch("")).toBe("desc");
  });

  it("serializes, omitting defaults", () => {
    expect(viewSearch("all", "desc")).toBe("");
    expect(viewSearch("unread", "desc")).toBe("?filter=unread");
    expect(viewSearch("unread", "asc")).toBe("?filter=unread&sort=asc");
  });
});

describe("local date helpers", () => {
  it("formats local calendar dates as YYYY-MM-DD", () => {
    expect(localDateKey(new Date(2026, 7, 26))).toBe("2026-08-26");
  });

  it("represents local midnight as an ISO timestamp", () => {
    const d = new Date(2026, 7, 26, 14, 30);
    expect(localMidnightIso(d)).toBe(new Date(2026, 7, 26).toISOString());
  });
});

describe("date-grouping helpers", () => {
  const now = new Date(2026, 7, 26, 12, 0); // Wed Aug 26 2026 12:00 local

  it("buckets within today", () => {
    expect(dayGroup(new Date(2026, 7, 26, 9).getTime(), now)).toBe("today");
    expect(dayGroup(new Date(2026, 7, 25, 9).getTime(), now)).toBe("yesterday");
    expect(dayGroup(new Date(2026, 7, 22, 9).getTime(), now)).toBe("this week");
    expect(dayGroup(new Date(2026, 7, 2, 9).getTime(), now)).toBe("this month");
    expect(dayGroup(new Date(2026, 0, 5, 9).getTime(), now)).toBe(
      "January 2026",
    );
  });

  it("groups contiguous entries, splitting on bucket change", () => {
    const groups = groupByDay(
      [
        { publishedAtMs: new Date(2026, 7, 26, 9).getTime() },
        { publishedAtMs: new Date(2026, 7, 26, 8).getTime() },
        { publishedAtMs: new Date(2026, 7, 25, 9).getTime() },
      ],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(["today", "yesterday"]);
    expect(groups[0]?.items).toHaveLength(2);
  });

  it("labels today with a wall-clock time", () => {
    expect(timeLabel(new Date(2026, 7, 26, 9, 5).getTime(), now)).toMatch(
      /9:05/,
    );
  });
});

it("parses a saved-image deep link without treating it as an article", () => {
  expect(
    parseRoute("/starred/images/12345678-1234-1234-1234-123456789012"),
  ).toEqual({
    stream: { kind: "starred" },
    entryId: null,
    imageId: "12345678-1234-1234-1234-123456789012",
  });
});

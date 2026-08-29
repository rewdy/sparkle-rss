import { describe, expect, it } from "vitest";
import { dayGroup, groupByDay, timeLabel } from "../src/lib/date-grouping";
import {
  filterFromSearch,
  localDateKey,
  localMidnightIso,
  parseRoute,
  sortFromSearch,
  streamKey,
  streamPath,
  viewSearch,
} from "../src/lib/keys";

describe("parseRoute", () => {
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

  it("rejects unknown and settings paths", () => {
    expect(parseRoute("/settings")).toBeNull();
    expect(parseRoute("/nope")).toBeNull();
    expect(parseRoute("/")).toEqual({ stream: { kind: "all" }, entryId: null });
  });
});

describe("streamKey / streamPath", () => {
  it("produces distinct, stable cache keys per kind", () => {
    expect(streamKey({ kind: "all" })).toBe("all");
    expect(streamKey({ kind: "starred" })).toBe("starred");
    expect(streamKey({ kind: "unread" })).toBe("unread");
    expect(streamKey({ kind: "feed", id: "5" })).toBe("feed:5");
    expect(streamKey({ kind: "folder", id: "2" })).toBe("folder:2");
  });

  it("keys today by calendar date so it rolls over at midnight", () => {
    expect(streamKey({ kind: "today" })).toMatch(/^today:\d{4}-\d{2}-\d{2}$/);
  });

  it("maps descriptors to their canonical paths", () => {
    expect(streamPath({ kind: "all" })).toBe("/all");
    expect(streamPath({ kind: "starred" })).toBe("/starred");
    expect(streamPath({ kind: "feed", id: "5" })).toBe("/feed/5");
    expect(streamPath({ kind: "folder", id: "2" })).toBe("/folder/2");
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

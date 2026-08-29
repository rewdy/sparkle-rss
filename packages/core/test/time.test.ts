import { describe, expect, it } from "vitest";
import {
  dateToCrawlTimeMsec,
  dateToTimestampUsec,
  markAllAsReadTsToDate,
  msToCrawlTimeMsec,
  msToTimestampUsec,
  secToDate,
} from "../src/greader/time";

describe("greader time conversions", () => {
  const fixed = new Date("2023-07-22T04:26:40.123Z"); // epoch ms 1690000000123

  it("converts milliseconds to timestampUsec strings", () => {
    expect(msToTimestampUsec(1690000000123)).toBe("1690000000123000");
    expect(dateToTimestampUsec(fixed)).toBe("1690000000123000");
    expect(msToTimestampUsec(0)).toBe("0");
  });

  it("converts milliseconds to crawlTimeMsec strings", () => {
    expect(msToCrawlTimeMsec(1690000000123)).toBe("1690000000123");
    expect(dateToCrawlTimeMsec(fixed)).toBe("1690000000123");
  });

  it("parses mark-all-as-read nanosecond timestamps without losing precision", () => {
    const ns = "1690000000123000000";
    expect(markAllAsReadTsToDate(ns)?.getTime()).toBe(1690000000123);
    expect(markAllAsReadTsToDate("1690000001000000000")?.getTime()).toBe(
      1690000001000,
    );
  });

  it("rejects invalid mark-all-as-read timestamps", () => {
    expect(markAllAsReadTsToDate("abc")).toBeNull();
    expect(markAllAsReadTsToDate("-5")).toBeNull();
    expect(markAllAsReadTsToDate("")).toBeNull();
    expect(markAllAsReadTsToDate("12x4")).toBeNull();
  });

  it("round-trips seconds", () => {
    expect(secToDate(1690000000).toISOString()).toBe(
      "2023-07-22T04:26:40.000Z",
    );
    expect(secToDate(0).toISOString()).toBe("1970-01-01T00:00:00.000Z");
  });
});

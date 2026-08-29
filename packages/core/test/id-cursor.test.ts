import { describe, expect, it } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  parseItemId,
  toLongItemId,
  toShortItemId,
} from "../src/index";

describe("item id forms", () => {
  it("round-trips the long form with 16-char zero-padded hex", () => {
    expect(toLongItemId(76383n)).toBe(
      "tag:google.com,2005:reader/item/0000000000012a5f",
    );
    const parsed = parseItemId(toLongItemId(76383n));
    expect(parsed).toBe(76383n);
    expect(toShortItemId(76383n)).toBe("76383");
  });

  it("accepts both forms in parseItemId", () => {
    expect(parseItemId("76383")).toBe(76383n);
    expect(
      parseItemId(" tag:google.com,2005:reader/item/0000000000012A5F "),
    ).toBe(76383n);
  });

  it("rejects malformed ids", () => {
    expect(parseItemId("feed/17")).toBeNull();
    expect(parseItemId("")).toBeNull();
    expect(parseItemId("tag:google.com,2005:reader/item/zz")).toBeNull();
    expect(parseItemId("-12")).toBeNull();
    expect(parseItemId("9".repeat(20))).toBeNull();
  });
});

describe("stream cursors", () => {
  it("round-trips ascending and descending cursors", () => {
    const token = encodeCursor({
      sortKey: "published",
      direction: "desc",
      primaryAtMs: 1690000000123,
      entryId: "76383",
    });
    expect(decodeCursor(token)).toEqual({
      sortKey: "published",
      direction: "desc",
      primaryAtMs: 1690000000123,
      entryId: "76383",
    });
  });

  it("round-trips starred cursors and enforces expected keys", () => {
    const token = encodeCursor({
      sortKey: "starred",
      direction: "desc",
      primaryAtMs: 5,
      entryId: "6",
    });
    expect(decodeCursor(token)).toMatchObject({
      sortKey: "starred",
      primaryAtMs: 5,
    });
    expect(decodeCursor(token, { sortKey: "published" })).toBeNull();
  });

  it("accepts legacy published cursors without a sort key", () => {
    const legacy = Buffer.from(
      JSON.stringify({ p: 42, i: "7", d: "asc" }),
    ).toString("base64url");
    expect(decodeCursor(legacy)).toEqual({
      sortKey: "published",
      direction: "asc",
      primaryAtMs: 42,
      entryId: "7",
    });
  });

  it("enforces expected direction when provided", () => {
    const token = encodeCursor({
      sortKey: "published",
      direction: "asc",
      primaryAtMs: 1,
      entryId: "2",
    });
    expect(decodeCursor(token, { direction: "desc" })).toBeNull();
    expect(decodeCursor(token, { direction: "asc" })).not.toBeNull();
  });

  it("returns null for garbage tokens", () => {
    expect(decodeCursor("not-a-token")).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(
      decodeCursor(
        Buffer.from(JSON.stringify({ p: "x", i: "1", d: "desc" })).toString(
          "base64url",
        ),
      ),
    ).toBeNull();
  });
});

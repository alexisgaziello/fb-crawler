import { describe, expect, it } from "vitest";
import { looksOlderThanLookback } from "./facebook.js";

describe("looksOlderThanLookback", () => {
  it("keeps recent minute and hour timestamps", () => {
    expect(looksOlderThanLookback("12 minutes ago")).toBe(false);
    expect(looksOlderThanLookback("4 h")).toBe(false);
  });

  it("skips older day, week, month, and year timestamps", () => {
    expect(looksOlderThanLookback("3 days ago")).toBe(true);
    expect(looksOlderThanLookback("1 week ago")).toBe(true);
    expect(looksOlderThanLookback("1 month ago")).toBe(true);
    expect(looksOlderThanLookback("1 year ago")).toBe(true);
  });

  it("keeps unknown timestamp formats for model classification", () => {
    expect(looksOlderThanLookback(undefined)).toBe(false);
    expect(looksOlderThanLookback("Yesterday at 9:41 AM")).toBe(false);
  });
});

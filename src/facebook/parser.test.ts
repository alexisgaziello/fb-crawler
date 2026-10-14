import { describe, expect, it } from "vitest";
import {
  cleanExtractedText,
  derivePostId,
  looksOlderThanLookback,
  normalizeFacebookUrl,
} from "./parser.js";

describe("cleanExtractedText", () => {
  it("removes repeated Facebook image noise", () => {
    expect(cleanExtractedText("Facebook Facebook Facebook Mirage G4.1 DOM: 2014")).toBe(
      "Mirage G4.1 DOM: 2014",
    );
  });

  it("removes long single-letter tracking fragments", () => {
    expect(cleanExtractedText("AGL Services p n o p t S h a u h a a g l 1 8 s Mirage G4.1")).toBe(
      "AGL Services Mirage G4.1",
    );
  });
});

describe("normalizeFacebookUrl", () => {
  it("canonicalizes Facebook commerce listing media urls", () => {
    expect(
      normalizeFacebookUrl(
        "https://www.facebook.com/commerce/listing/1111111111111111/?media_id=0&ref=share_attachment&__tn__=%2A",
      ),
    ).toBe("https://www.facebook.com/commerce/listing/1111111111111111/");
  });

  it("keeps post identity params on photo urls while removing crawler noise", () => {
    expect(
      normalizeFacebookUrl(
        "https://www.facebook.com/photo/?fbid=2222222222222222&set=pcb.3333333333333333&__cft__[0]=abc&__tn__=%2A&media_id=0",
      ),
    ).toBe("https://www.facebook.com/photo/?fbid=2222222222222222&set=pcb.3333333333333333");
  });
});

describe("derivePostId", () => {
  it("uses stable ids for marketplace listings", () => {
    expect(derivePostId("https://www.facebook.com/commerce/listing/1111111111111111/", "rig")).toBe(
      "1111111111111111",
    );
  });

  it("uses the photo post set before the individual photo id", () => {
    expect(
      derivePostId(
        "https://www.facebook.com/photo/?fbid=2222222222222222&set=pcb.3333333333333333",
        "container",
      ),
    ).toBe("3333333333333333");
  });
});

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

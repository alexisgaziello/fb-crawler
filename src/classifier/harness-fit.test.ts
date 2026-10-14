import { describe, expect, it } from "vitest";
import { type Classification, enforceHarnessFit } from "./index.js";

function classification(overrides: {
  category: Classification["category"];
  harnessFitForBuyer: Classification["extracted"]["harnessFitForBuyer"];
}): Classification {
  return {
    confidence: 0.9,
    category: overrides.category,
    reason: "reason",
    actionSummary: "summary",
    extracted: {
      itemType: "full_rig",
      mainCanopySize: 170,
      reserveCanopySize: 160,
      containerSize: "W10",
      containerFit: "height 63-68 in (160-173 cm)",
      harnessFitForBuyer: overrides.harnessFitForBuyer,
      targetMainCompatibility: "compatible",
      sellerLocation: "Wesley Chapel, FL",
      askingPrice: "$4600.00 USD",
    },
  };
}

describe("enforceHarnessFit", () => {
  it("rejects a canopy-perfect rig whose harness is too small", () => {
    const result = enforceHarnessFit(
      classification({ category: "possible_match", harnessFitForBuyer: "too_small" }),
    );

    expect(result.category).toBe("not_relevant");
  });

  it("rejects a strong match whose harness is too small", () => {
    const result = enforceHarnessFit(
      classification({ category: "strong_match", harnessFitForBuyer: "too_small" }),
    );

    expect(result.category).toBe("not_relevant");
  });

  it("caps a marginal harness fit at possible_match", () => {
    const result = enforceHarnessFit(
      classification({ category: "strong_match", harnessFitForBuyer: "marginal" }),
    );

    expect(result.category).toBe("possible_match");
  });

  it("leaves a clean fit untouched", () => {
    const input = classification({ category: "strong_match", harnessFitForBuyer: "fits" });

    expect(enforceHarnessFit(input)).toBe(input);
  });

  it("does not reject on unknown harness fit", () => {
    const input = classification({ category: "possible_match", harnessFitForBuyer: "unknown" });

    expect(enforceHarnessFit(input)).toBe(input);
  });
});

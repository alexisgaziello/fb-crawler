import { describe, expect, it } from "vitest";
import { randomDelayMs, randomIntegerBetween } from "./pacing.js";

describe("randomDelayMs", () => {
  it("returns a value inside the inclusive range", () => {
    expect(randomDelayMs(100, 200, () => 0)).toBe(100);
    expect(randomDelayMs(100, 200, () => 0.999)).toBe(200);
  });

  it("clamps negative and inverted ranges", () => {
    expect(randomDelayMs(-10, -5, () => 0.5)).toBe(0);
    expect(randomDelayMs(500, 100, () => 0.5)).toBe(500);
  });
});

describe("randomIntegerBetween", () => {
  it("includes both boundaries", () => {
    expect(randomIntegerBetween(420, 720, () => 0)).toBe(420);
    expect(randomIntegerBetween(420, 720, () => 0.999)).toBe(720);
  });
});

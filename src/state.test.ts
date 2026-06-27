import { describe, expect, it } from "vitest";
import { config } from "./config.js";
import {
  type CrawlerState,
  localDateKey,
  markPostsReviewed,
  withDailyRunSuccess,
  withReviewedPostIds,
} from "./state.js";

describe("reviewed post state", () => {
  it("keeps a capped newest-first list of reviewed post ids", () => {
    const existing = Array.from(
      { length: config.ANALYZED_POSTS_CACHE_LIMIT + 5 },
      (_, index) => `post-${index}`,
    );

    const reviewed = markPostsReviewed(existing, ["post-new"]);

    expect(reviewed).toHaveLength(config.ANALYZED_POSTS_CACHE_LIMIT);
    expect(reviewed[0]).toBe("post-new");
    expect(reviewed).toContain("post-new");
    expect(reviewed).not.toContain(`post-${config.ANALYZED_POSTS_CACHE_LIMIT + 4}`);
  });

  it("updates an existing post id instead of duplicating it", () => {
    const reviewed = markPostsReviewed(["post-1"], ["post-1"]);

    expect(reviewed).toHaveLength(1);
    expect(reviewed[0]).toBe("post-1");
  });
});

describe("localDateKey", () => {
  it("uses the local calendar date", () => {
    expect(localDateKey(new Date(2026, 5, 27, 23, 59))).toBe("2026-06-27");
  });
});

describe("combined crawler state", () => {
  const state: CrawlerState = {
    reviewedPostIds: ["post-1"],
    dailyRun: {
      lastSuccessfulRunAt: "2026-06-26T12:00:00.000Z",
    },
  };

  it("updates reviewed posts without replacing daily-run state", () => {
    const updated = withReviewedPostIds(state, ["post-2"]);

    expect(updated.reviewedPostIds).toEqual(["post-2"]);
    expect(updated.dailyRun).toEqual(state.dailyRun);
  });

  it("updates daily-run state without replacing reviewed posts", () => {
    const completedAt = new Date(2026, 5, 27, 9, 30);
    const updated = withDailyRunSuccess(state, completedAt);

    expect(updated.reviewedPostIds).toEqual(state.reviewedPostIds);
    expect(updated.dailyRun).toEqual({
      lastSuccessfulRunAt: completedAt.toISOString(),
    });
  });
});

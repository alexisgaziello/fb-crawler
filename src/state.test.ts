import { describe, expect, it } from "vitest";
import { markPostsReviewed, type ReviewedPost, reviewedPostIds } from "./state.js";

describe("reviewed post state", () => {
  it("keeps a capped newest-first list of reviewed post ids", () => {
    const existing: ReviewedPost[] = Array.from({ length: 1_005 }, (_, index) => ({
      id: `post-${index}`,
      reviewedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    }));

    const reviewed = markPostsReviewed(existing, ["post-new"]);
    const ids = reviewedPostIds(reviewed);

    expect(reviewed).toHaveLength(1_000);
    expect(reviewed[0]?.id).toBe("post-new");
    expect(ids.has("post-new")).toBe(true);
    expect(ids.has("post-0")).toBe(false);
  });

  it("updates an existing post id instead of duplicating it", () => {
    const reviewed = markPostsReviewed(
      [{ id: "post-1", reviewedAt: "2026-01-01T00:00:00.000Z" }],
      ["post-1"],
    );

    expect(reviewed).toHaveLength(1);
    expect(reviewed[0]?.id).toBe("post-1");
    expect(reviewed[0]?.reviewedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });
});

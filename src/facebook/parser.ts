import { config } from "../config.js";
import type { RawPost } from "./page.js";

export type ScrapedPost = {
  id: string;
  url: string;
  text: string;
  timestampText?: string;
  author?: string;
};

export type ExtractionSummary = {
  rawArticleCardCount: number;
  rawFeedTextBlockCount: number;
  kept: number;
  skippedEmpty: number;
  skippedNoPostLink: number;
  skippedCommentPermalink: number;
  skippedOld: number;
  skippedDuplicate: number;
  skippedTruncated: number;
  scannedViewports?: number;
  encounteredPostCount?: number;
  encounteredReviewedPostCount?: number;
  stopReason?: "manual" | "max_posts" | "max_reviewed" | "scroll_limit";
};

export function parseRawPosts(rawPosts: RawPost[]) {
  const summary: ExtractionSummary = {
    rawArticleCardCount: rawPosts.filter((post) => post.source === "article").length,
    rawFeedTextBlockCount: rawPosts.filter((post) => post.source === "feed_text_block").length,
    kept: 0,
    skippedEmpty: 0,
    skippedNoPostLink: 0,
    skippedCommentPermalink: 0,
    skippedOld: 0,
    skippedDuplicate: 0,
    skippedTruncated: 0,
  };
  const bestById = new Map<string, { post: ScrapedPost; raw: RawPost; score: number }>();

  for (const raw of rawPosts) {
    if (raw.hasTruncatedTextControl) {
      summary.skippedTruncated += 1;
      continue;
    }
    const text = cleanExtractedText(raw.text);
    if (!text || text.length < 40) {
      summary.skippedEmpty += 1;
      continue;
    }
    if (!raw.href) {
      if (raw.hasCommentPermalink) summary.skippedCommentPermalink += 1;
      else summary.skippedNoPostLink += 1;
      continue;
    }
    if (looksOlderThanLookback(raw.timestampText)) {
      summary.skippedOld += 1;
      continue;
    }

    const url = normalizeFacebookUrl(raw.href);
    const id = derivePostId(url, text);
    const cleanedRaw = { ...raw, text };
    const post: ScrapedPost = {
      id,
      url,
      text,
      timestampText: raw.timestampText || undefined,
      author: raw.author || undefined,
    };
    const score = scoreRawPost(cleanedRaw, url);
    const existing = bestById.get(id);
    if (existing) {
      summary.skippedDuplicate += 1;
      if (score > existing.score) bestById.set(id, { post, raw, score });
      continue;
    }
    bestById.set(id, { post, raw, score });
  }

  const posts = Array.from(bestById.values())
    .sort(
      (left, right) =>
        left.raw.documentTop - right.raw.documentTop || left.raw.index - right.raw.index,
    )
    .map((entry) => entry.post);
  summary.kept = posts.length;
  return { posts, summary };
}

export function cleanExtractedText(text: string) {
  return text
    .replace(/(?:\bFacebook\b\s*){3,}/gi, " ")
    .replace(/\b(?:[a-z0-9]\s+){12,}[a-z0-9]\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreRawPost(raw: RawPost, url: string) {
  const facebookMentions = raw.text.match(/\bFacebook\b/g)?.length ?? 0;
  const hasStableUrl =
    url.includes("/posts/") ||
    url.includes("multi_permalinks=") ||
    url.includes("/commerce/listing/") ||
    url.includes("/photo/");
  const lengthScore = raw.text.length >= 80 && raw.text.length <= 600 ? 250 : 0;
  const authorScore = raw.author ? 40 : 0;
  const stableUrlScore = hasStableUrl ? 500 : 0;
  const noisePenalty = facebookMentions * 40 + Math.max(0, raw.text.length - 700) / 4;
  return stableUrlScore + lengthScore + authorScore - noisePenalty - raw.anchorCount * 3;
}

export function normalizeFacebookUrl(url: string) {
  try {
    const parsed = new URL(url);
    const listingId = parsed.pathname.match(/\/commerce\/listing\/([^/?#]+)/)?.[1];
    if (listingId) {
      parsed.pathname = `/commerce/listing/${listingId}/`;
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    }

    for (const param of Array.from(parsed.searchParams.keys())) {
      if (
        param === "__tn__" ||
        param === "ref" ||
        param === "media_id" ||
        param.startsWith("__cft__")
      ) {
        parsed.searchParams.delete(param);
      }
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return config.FACEBOOK_GROUP_URL;
  }
}

export function derivePostId(url: string, text: string) {
  const postId = stablePostIdFromUrl(url);
  if (postId) return postId;

  let hash = 0;
  for (const char of `${url}\n${text.slice(0, 500)}`) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `hash-${hash.toString(16)}`;
}

function stablePostIdFromUrl(url: string) {
  try {
    const parsed = new URL(url, config.FACEBOOK_GROUP_URL);
    const photoSet = parsed.searchParams.get("set")?.match(/^pcb\.(\d+)$/)?.[1];
    const photoId = parsed.pathname.includes("/photo/")
      ? parsed.searchParams.get("fbid")
      : undefined;
    return (
      parsed.pathname.match(/\/posts\/([^/?#]+)/)?.[1] ??
      parsed.pathname.match(/\/commerce\/listing\/([^/?#]+)/)?.[1] ??
      photoSet ??
      photoId ??
      parsed.searchParams.get("multi_permalinks") ??
      parsed.searchParams.get("story_fbid") ??
      undefined
    );
  } catch {
    return undefined;
  }
}

export function looksOlderThanLookback(timestampText?: string) {
  if (!timestampText) return false;
  const text = timestampText.toLowerCase();

  if (text.includes("today")) return false;
  if (text.includes("yesterday")) return 24 > config.LOOKBACK_HOURS;

  const number = Number(text.match(/\d+/)?.[0] ?? "1");
  if (Number.isNaN(number)) return false;

  if (text.includes("min") || text.includes("hour") || text.includes("hr")) {
    return text.includes("hour") || text.includes("hr") ? number > config.LOOKBACK_HOURS : false;
  }
  if (text.includes("day")) return number * 24 > config.LOOKBACK_HOURS;
  if (text.includes("week") || text.includes("month") || text.includes("year")) return true;
  return false;
}

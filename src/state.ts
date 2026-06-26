import fs from "node:fs/promises";
import path from "node:path";
import type { ClassifiedPost } from "./classifier.js";
import { config, dataDir } from "./config.js";
import type { DebugPostExtraction } from "./facebook.js";
import { logger } from "./logger.js";

type SeenState = {
  seen: Record<string, string>;
};

export type ReviewedPost = {
  id: string;
  reviewedAt: string;
};

type ReviewedPostsState = {
  reviewed: ReviewedPost[];
};

async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

export async function readReviewedPosts(): Promise<ReviewedPost[]> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(config.reviewedPostsPath, "utf8");
    const parsed = JSON.parse(raw) as ReviewedPostsState;
    return normalizeReviewedPosts(parsed.reviewed ?? []);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return readLegacySeenPosts();
    }
    throw error;
  }
}

export function reviewedPostIds(reviewedPosts: ReviewedPost[]) {
  return new Set(reviewedPosts.map((post) => post.id));
}

export function markPostsReviewed(reviewedPosts: ReviewedPost[], ids: string[]) {
  if (ids.length === 0) return capReviewedPosts(reviewedPosts);

  const reviewedAt = new Date().toISOString();
  const byId = new Map(reviewedPosts.map((post) => [post.id, post]));
  for (const id of ids) {
    byId.set(id, { id, reviewedAt });
  }

  return capReviewedPosts([...byId.values()]);
}

export async function writeReviewedPosts(reviewedPosts: ReviewedPost[]) {
  await ensureDataDir();
  const reviewed = capReviewedPosts(reviewedPosts);
  await fs.writeFile(config.reviewedPostsPath, JSON.stringify({ reviewed }, null, 2));
}

export async function appendMatches(matches: ClassifiedPost[]) {
  if (matches.length === 0) return;
  await ensureDataDir();
  const lines = `${matches.map((match) => JSON.stringify(match)).join("\n")}\n`;
  await fs.appendFile(config.matchesPath, lines);
}

export async function writeDebugPosts(extraction: DebugPostExtraction) {
  await ensureDataDir();
  await fs.mkdir(config.debugPostsDir, { recursive: true });

  const savedAt = new Date().toISOString();
  const payload = JSON.stringify(
    {
      savedAt,
      count: extraction.posts.length,
      ...extraction,
    },
    null,
    2,
  );
  const timestamp = savedAt.replaceAll(":", "-").replaceAll(".", "-");
  const snapshotPath = path.join(config.debugPostsDir, `${timestamp}.json`);

  await fs.writeFile(snapshotPath, payload);
  logger.info(
    {
      postCount: extraction.posts.length,
      rawArticleCardCount: extraction.rawArticleCards.length,
      snapshotPath,
    },
    "Saved debug extracted posts and raw article HTML.",
  );
}

export async function hasStorageState() {
  try {
    const stat = await fs.stat(config.storageStatePath);
    return stat.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function ensureParentDir(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readLegacySeenPosts() {
  try {
    const legacyPath = path.join(dataDir, "seen-posts.json");
    const raw = await fs.readFile(legacyPath, "utf8");
    const parsed = JSON.parse(raw) as SeenState;
    return normalizeReviewedPosts(
      Object.entries(parsed.seen ?? {}).map(([id, reviewedAt]) => ({ id, reviewedAt })),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function normalizeReviewedPosts(reviewedPosts: ReviewedPost[]) {
  const byId = new Map<string, ReviewedPost>();
  for (const post of reviewedPosts) {
    if (!post.id) continue;
    byId.set(post.id, {
      id: post.id,
      reviewedAt: validIsoDate(post.reviewedAt) ? post.reviewedAt : new Date().toISOString(),
    });
  }
  return capReviewedPosts([...byId.values()]);
}

function capReviewedPosts(reviewedPosts: ReviewedPost[]) {
  return [...reviewedPosts]
    .sort((left, right) => right.reviewedAt.localeCompare(left.reviewedAt))
    .slice(0, config.REVIEWED_POST_LIMIT);
}

function validIsoDate(value: string) {
  return !Number.isNaN(Date.parse(value));
}

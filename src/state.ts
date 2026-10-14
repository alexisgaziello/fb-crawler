import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import type { MatchedPost } from "./classifier/index.js";
import { config, dataDir } from "./config.js";
import type { DebugPostExtraction } from "./facebook/index.js";
import {
  captureFullPageDataInPage,
  type FullPageCaptureData,
  readBodyTextInPage,
} from "./facebook/page.js";
import { logger } from "./logger.js";

export type CrawlerState = {
  reviewedPostIds: string[];
  lastSuccessfulRunAt?: string;
};

export type DebugRun = {
  dir: string;
  pageDir: string;
  classificationsDir: string;
  postsPath: string;
  extractionPath: string;
};

function timestampId(date = new Date()) {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

export async function createDebugRun(): Promise<DebugRun> {
  await fs.mkdir(config.debugDir, { recursive: true });

  const dir = path.join(config.debugDir, timestampId());
  const debugRun = {
    dir,
    pageDir: path.join(dir, "page"),
    classificationsDir: path.join(dir, "classifications"),
    postsPath: path.join(dir, "posts.json"),
    extractionPath: path.join(dir, "extraction.json"),
  };

  await fs.mkdir(debugRun.pageDir, { recursive: true });
  await fs.mkdir(debugRun.classificationsDir, { recursive: true });
  logger.info({ debugRunDir: debugRun.dir }, "Created debug run directory.");
  return debugRun;
}

export function markPostsReviewed(reviewedIds: string[], newIds: string[]) {
  return normalizeReviewedIds([...newIds, ...reviewedIds]);
}

export async function writeReviewedPostIds(reviewedIds: string[]) {
  const state = await readCrawlerState();
  await writeCrawlerState({ ...state, reviewedPostIds: normalizeReviewedIds(reviewedIds) });
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function writeDailyRunSuccess(completedAt = new Date()) {
  const state = await readCrawlerState();
  const updated = { ...state, lastSuccessfulRunAt: completedAt.toISOString() };
  await writeCrawlerState(updated);
  return { lastSuccessfulRunAt: updated.lastSuccessfulRunAt };
}

export async function readCrawlerState(): Promise<CrawlerState> {
  await ensureDataDir();
  try {
    const parsed = JSON.parse(await fs.readFile(config.statePath, "utf8")) as Partial<CrawlerState>;
    return normalizeCrawlerState(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { reviewedPostIds: [] };
    throw error;
  }
}

async function writeCrawlerState(state: CrawlerState) {
  await ensureDataDir();
  await fs.writeFile(config.statePath, JSON.stringify(normalizeCrawlerState(state), null, 2));
}

function normalizeCrawlerState(state: Partial<CrawlerState>): CrawlerState {
  return {
    reviewedPostIds: normalizeReviewedIds(state.reviewedPostIds ?? []),
    lastSuccessfulRunAt: state.lastSuccessfulRunAt,
  };
}

export async function appendMatches(matches: MatchedPost[]) {
  if (matches.length === 0) return;
  await ensureDataDir();
  const lines = `${matches.map((match) => JSON.stringify(match)).join("\n")}\n`;
  await fs.appendFile(config.matchesPath, lines);
}

export async function writeDebugPosts(extraction: DebugPostExtraction, debugRun: DebugRun) {
  await ensureDataDir();

  const savedAt = new Date().toISOString();
  const postsPayload = JSON.stringify(
    {
      savedAt,
      count: extraction.posts.length,
      posts: extraction.posts,
    },
    null,
    2,
  );
  const extractionPayload = JSON.stringify(
    {
      savedAt,
      summary: extraction.summary,
      rawCandidateCount: extraction.rawCandidates.length,
      rawCandidates: extraction.rawCandidates,
    },
    null,
    2,
  );
  const postsPath = debugRun.postsPath;
  const extractionPath = debugRun.extractionPath;

  await Promise.all([
    fs.writeFile(postsPath, postsPayload),
    fs.writeFile(extractionPath, extractionPayload),
  ]);
  logger.info(
    {
      postCount: extraction.posts.length,
      rawCandidateCount: extraction.rawCandidates.length,
      rawFeedTextBlockCount: extraction.summary.rawFeedTextBlockCount,
      postsPath,
      extractionPath,
    },
    "Saved clean debug posts and separate extraction diagnostics.",
  );
}

export async function writeDebugPageCapture(page: Page, debugRun: DebugRun) {
  await ensureDataDir();

  const savedAt = new Date().toISOString();
  const snapshotDir = debugRun.pageDir;
  await fs.mkdir(snapshotDir, { recursive: true });

  const [html, bodyText, pageData] = await Promise.all([
    page.content(),
    page.evaluate(readBodyTextInPage),
    page.evaluate(captureFullPageDataInPage) as Promise<FullPageCaptureData>,
  ]);

  const meta = {
    savedAt,
    url: pageData.url,
    title: pageData.title,
    viewport: pageData.viewport,
    counts: pageData.counts,
    files: {
      html: "page.html",
      text: "body.txt",
      links: "links.json",
      visibleTextBlocks: "visible-text-blocks.json",
      screenshot: "screenshot.png",
    },
  };

  await Promise.all([
    fs.writeFile(path.join(snapshotDir, "page.html"), html),
    fs.writeFile(path.join(snapshotDir, "body.txt"), bodyText),
    fs.writeFile(path.join(snapshotDir, "links.json"), JSON.stringify(pageData.anchors, null, 2)),
    fs.writeFile(
      path.join(snapshotDir, "visible-text-blocks.json"),
      JSON.stringify(pageData.visibleTextBlocks, null, 2),
    ),
    fs.writeFile(path.join(snapshotDir, "meta.json"), JSON.stringify(meta, null, 2)),
  ]);

  await page.screenshot({ path: path.join(snapshotDir, "screenshot.png"), fullPage: true });
  logger.info({ snapshotDir, ...pageData.counts }, "Saved full debug page capture.");
  return snapshotDir;
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

function normalizeReviewedIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean))).slice(0, config.ANALYZED_POSTS_CACHE_LIMIT);
}

import { chromium, type ElementHandle, type Page } from "playwright";
import { config, requireFacebookGroupUrl } from "../config.js";
import { logger } from "../logger.js";
import { pauseWithJitter, randomIntegerBetween } from "../pacing.js";
import {
  type DebugRun,
  ensureParentDir,
  hasStorageState,
  writeDebugPageCapture,
  writeDebugPosts,
} from "../state.js";
import {
  extractRawPostsInPage,
  findButtonByLabelsInPage,
  findVisibleTruncatedButtonInPage,
  type RawPost,
  readFacebookAccessStateInPage,
  readPageMetricsInPage,
  readVisibleButtonCandidatesInPage,
} from "./page.js";
import { type ExtractionSummary, parseRawPosts, type ScrapedPost } from "./parser.js";

const GROUP_ID_PATTERN = /groups\/([^/?#]+)/;

export class FacebookAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FacebookAccessError";
  }
}

type ScrapeOptions = {
  headed?: boolean;
  steps?: boolean;
  debugRun?: DebugRun;
  reviewedIds?: ReadonlySet<string>;
};

export type DebugPostExtraction = {
  rawCandidates: RawPost[];
  posts: ScrapedPost[];
  summary: ExtractionSummary;
};

function browserViewport(headed: boolean) {
  return headed
    ? null
    : {
        width: config.HEADLESS_VIEWPORT_WIDTH,
        height: config.HEADLESS_VIEWPORT_HEIGHT,
      };
}

function nextScrollDistance(viewportHeight: number) {
  const maxDistance = Math.min(config.SCROLL_DISTANCE_PX, Math.round(viewportHeight * 0.75));
  return randomIntegerBetween(Math.min(config.SCROLL_DISTANCE_MIN_PX, maxDistance), maxDistance);
}

export async function saveFacebookSession() {
  requireFacebookGroupUrl();
  await ensureParentDir(config.storageStatePath);
  const existingSession = await hasStorageState();
  const browser = await chromium.launch({ headless: false, slowMo: config.SLOW_MO_MS });
  const context = await browser.newContext(
    existingSession
      ? { storageState: config.storageStatePath, viewport: null }
      : { viewport: null },
  );

  try {
    const page = await context.newPage();
    await page.goto(config.FACEBOOK_GROUP_URL, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });

    logger.info(
      existingSession
        ? "Loaded existing Facebook session. Re-authenticate only if Facebook asks."
        : "Log in to Facebook and open the group if needed.",
    );
    console.log("After the group is visible, press Enter here to save the session.");
    await waitForEnter();

    await context.storageState({ path: config.storageStatePath });
    logger.info({ storageStatePath: config.storageStatePath }, "Saved Facebook session.");
  } finally {
    await browser.close();
  }
}

export async function scrapeRecentPosts(options: ScrapeOptions = {}): Promise<ScrapedPost[]> {
  requireFacebookGroupUrl();
  if (!(await hasStorageState())) {
    throw new Error("No saved Facebook session. Run `pnpm run auth` first.");
  }

  const debugRun = options.debugRun;
  const headed = options.headed === true || debugRun !== undefined;
  const browser = await chromium.launch({
    headless: headed ? false : config.HEADLESS,
    slowMo: config.SLOW_MO_MS,
  });
  const context = await browser.newContext({
    storageState: config.storageStatePath,
    viewport: browserViewport(headed),
  });
  const page = await context.newPage();
  let manuallyStopped = false;

  try {
    logger.info({ url: config.FACEBOOK_GROUP_URL }, "Opening Facebook group.");
    await page.goto(config.FACEBOOK_GROUP_URL, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    logger.info({ url: page.url() }, "Facebook group loaded.");
    await pauseWithJitter();
    await assertFacebookAccessible(page);
    const dismissedDialogs = await dismissCommonDialogs(page);
    logger.info({ dismissedDialogs }, "Dismissed dialog buttons.");
    await assertFacebookAccessible(page);
    await selectNewPostsSort(page);
    await assertFacebookAccessible(page);
    logger.info("Walking Facebook feed post by post.");
    if (options.steps) {
      await waitForEnter(
        "Step mode: Facebook is ready. Press Enter to scan the current feed position.",
      );
    }
    const extraction = await walkFeedPosts(
      page,
      options.reviewedIds,
      options.steps === true,
      debugRun !== undefined,
    );
    manuallyStopped = extraction.summary.stopReason === "manual";
    await assertFacebookAccessible(page);
    if (debugRun) {
      logger.info("Saving full debug page capture.");
      await writeDebugPageCapture(page, debugRun);
    }
    logger.info(
      { discoveredPostCount: extraction.posts.length },
      "Finished walking Facebook posts.",
    );

    if (debugRun) {
      await writeDebugPosts(
        {
          ...extraction,
          rawCandidates: extraction.rawCandidates.slice(0, config.MAX_POSTS * 2),
        },
        debugRun,
      );
    }

    return extraction.posts;
  } catch (error) {
    if (debugRun) {
      logger.info("Saving debug page capture after scrape failure.");
      await writeDebugPageCapture(page, debugRun).catch((captureError) => {
        logger.error(
          { err: captureError },
          "Failed to save debug page capture after scrape failure.",
        );
      });
    }
    throw error;
  } finally {
    if (debugRun && !manuallyStopped) {
      logger.info("Debug mode: browser is still open. Press Enter to close it.");
      await waitForEnter();
    } else if (manuallyStopped) {
      logger.info("Step mode stopped; closing browser and continuing to classification.");
    }
    await browser.close();
  }
}

export async function saveFacebookPageSnapshot(debugRun: DebugRun) {
  requireFacebookGroupUrl();
  if (!(await hasStorageState())) {
    throw new Error("No saved Facebook session. Run `pnpm run auth` first.");
  }

  const browser = await chromium.launch({
    headless: false,
    slowMo: config.SLOW_MO_MS,
  });
  const context = await browser.newContext({
    storageState: config.storageStatePath,
    viewport: null,
  });
  const page = await context.newPage();

  try {
    logger.info({ url: config.FACEBOOK_GROUP_URL }, "Opening Facebook group for full capture.");
    await page.goto(config.FACEBOOK_GROUP_URL, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    logger.info({ url: page.url() }, "Facebook group loaded.");
    await pauseWithJitter();
    await assertFacebookAccessible(page);
    const dismissedDialogs = await dismissCommonDialogs(page);
    logger.info({ dismissedDialogs }, "Dismissed dialog buttons.");
    await assertFacebookAccessible(page);
    logger.info("Loading feed by scrolling.");
    await scrollFeedForSnapshot(page);
    await assertFacebookAccessible(page);
    logger.info("Saving full debug page capture.");
    return await writeDebugPageCapture(page, debugRun);
  } finally {
    logger.info("Debug mode: browser is still open. Press Enter to close it.");
    await waitForEnter();
    await browser.close();
  }
}

async function waitForEnter(prompt?: string) {
  if (prompt) console.log(prompt);
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
}

async function waitForStepAction(prompt: string): Promise<"continue" | "stop"> {
  console.log(prompt);

  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    return new Promise((resolve) => {
      process.stdin.resume();
      process.stdin.once("data", (data) => {
        process.stdin.pause();
        resolve(data.toString().includes("\u001b") ? "stop" : "continue");
      });
    });
  }

  return new Promise((resolve) => {
    const wasRaw = process.stdin.isRaw;
    const finish = (action: "continue" | "stop") => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      resolve(action);
    };
    const onData = (data: Buffer) => {
      const input = data.toString();
      if (input.includes("\u0003")) {
        process.stdin.off("data", onData);
        process.stdin.setRawMode(wasRaw);
        process.kill(process.pid, "SIGINT");
        return;
      }
      if (input.includes("\u001b")) finish("stop");
      else if (input.includes("\r") || input.includes("\n")) finish("continue");
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

async function dismissCommonDialogs(page: Page) {
  let dismissed = 0;
  const buttonNames = ["Allow all cookies", "Accept all", "Not now", "Close"];
  for (const name of buttonNames) {
    const button = page.getByRole("button", { name, exact: false }).first();
    try {
      if (await button.isVisible({ timeout: 2_000 })) {
        await pauseWithJitter();
        await button.click({ timeout: 2_000 });
        dismissed += 1;
        await pauseWithJitter();
      }
    } catch {
      // Dialogs are opportunistic and vary by account/session.
    }
  }
  return dismissed;
}

async function waitForFeed(page: Page) {
  const feedVisible = await page
    .locator('[role="feed"]')
    .first()
    .waitFor({ state: "attached", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!feedVisible) {
    logger.warn("Facebook feed container was not detected before scrolling.");
  }
}

async function selectNewPostsSort(page: Page) {
  await waitForFeed(page);
  const triggerLabels = config.FACEBOOK_SORT_TRIGGER_LABELS.split("|")
    .map((label) => label.trim())
    .filter(Boolean);
  const newPostsLabels = new Set(
    config.FACEBOOK_NEW_POSTS_LABELS.split("|")
      .map((label) => label.trim())
      .filter(Boolean),
  );
  const candidateHandle = await page
    .waitForFunction(findButtonByLabelsInPage, triggerLabels, { timeout: 15_000 })
    .catch(() => undefined);
  const candidate = candidateHandle?.asElement() as ElementHandle<HTMLElement> | null | undefined;
  if (!candidate) {
    await candidateHandle?.dispose();
    const visibleButtonCandidates = await page.evaluate(readVisibleButtonCandidatesInPage);
    logger.warn(
      { triggerLabels, visibleButtonCandidates },
      "Could not match the configured Facebook feed sort trigger labels.",
    );
    throw new Error(
      "Could not find Facebook's feed sort control using FACEBOOK_SORT_TRIGGER_LABELS. Aborting without clicking unrelated controls.",
    );
  }

  try {
    const candidateText = (await candidate.innerText()).replace(/\s+/g, " ").trim();
    logger.debug({ candidateText }, "Opening Facebook feed sort control.");
    await pauseWithJitter();
    await candidate.click({ timeout: 5_000 });
  } finally {
    await candidateHandle?.dispose();
  }

  const sortMenu = page.locator('[role="menu"]:has([role="menuitemradio"])').last();
  const menuVisible = await sortMenu
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!menuVisible) {
    throw new Error(
      "The selected Facebook feed control did not open a sort radio menu. Aborting rather than probing other controls.",
    );
  }

  const items = sortMenu.locator('[role="menuitemradio"]');
  const itemCount = await items.count();

  const menuItemLabels: string[][] = [];
  const matchingIndexes: number[] = [];
  for (let index = 0; index < itemCount; index += 1) {
    const labels = (await items.nth(index).locator("span").allInnerTexts())
      .map((label) => label.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    menuItemLabels.push(labels);
    if (labels.some((label) => newPostsLabels.has(label))) matchingIndexes.push(index);
  }
  if (matchingIndexes.length !== 1) {
    throw new Error(
      `Expected exactly one New posts sort option but found ${matchingIndexes.length}. ` +
        `Configured labels: ${JSON.stringify(Array.from(newPostsLabels))}. ` +
        `Menu labels: ${JSON.stringify(menuItemLabels)}.`,
    );
  }

  const selectedIndex = matchingIndexes[0] as number;
  const newPostsItem = items.nth(selectedIndex);
  const selectedText = (await newPostsItem.innerText()).replace(/\s+/g, " ").trim();
  const alreadySelected = (await newPostsItem.getAttribute("aria-checked")) === "true";
  if (alreadySelected) {
    await page.keyboard.press("Escape");
  } else {
    await pauseWithJitter();
    await newPostsItem.click({ timeout: 3_000 });
    await pauseWithJitter();
  }

  logger.info(
    { alreadySelected, itemCount, selectedIndex, selectedText },
    "Facebook feed is sorted by new posts.",
  );
}

async function walkFeedPosts(
  page: Page,
  reviewedIds: ReadonlySet<string> = new Set(),
  steps = false,
  collectDiagnostics = false,
): Promise<DebugPostExtraction> {
  await waitForFeed(page);

  const posts = new Map<string, ScrapedPost>();
  const encounteredIds = new Set<string>();
  const encounteredReviewedIds = new Set<string>();
  const rawPosts = new Map<string, RawPost>();
  const summary: ExtractionSummary = {
    rawArticleCardCount: 0,
    rawFeedTextBlockCount: 0,
    kept: 0,
    skippedEmpty: 0,
    skippedNoPostLink: 0,
    skippedCommentPermalink: 0,
    skippedOld: 0,
    skippedDuplicate: 0,
    skippedTruncated: 0,
    scannedViewports: 0,
    encounteredPostCount: 0,
    encounteredReviewedPostCount: 0,
  };
  const maxReviewed = Math.max(0, config.MAX_ALREADY_REVIEWED_POSTS);
  let stopReason: "manual" | "max_posts" | "max_reviewed" | "scroll_limit" = "scroll_limit";

  for (let viewport = 0; viewport <= config.SCROLL_STEPS; viewport += 1) {
    await assertFacebookAccessible(page);
    const expandedTextCount = await expandVisibleTruncatedPostText(page);
    const visibleExtraction = await extractPosts(page, collectDiagnostics);
    summary.scannedViewports = viewport + 1;
    mergeExtractionSummary(summary, visibleExtraction.summary);

    if (collectDiagnostics) {
      for (const raw of visibleExtraction.rawCandidates) {
        const key = `${raw.source}:${raw.href || raw.text.slice(0, 500)}`;
        if (!rawPosts.has(key)) rawPosts.set(key, raw);
      }
    }

    for (const post of visibleExtraction.posts) {
      if (encounteredIds.has(post.id)) {
        const existing = posts.get(post.id);
        if (existing && post.text.length > existing.text.length) {
          posts.set(post.id, post);
          logger.info(
            {
              postId: post.id,
              previousTextLength: existing.text.length,
              textLength: post.text.length,
            },
            "Refreshed an extracted post with more complete text.",
          );
        }
        continue;
      }
      encounteredIds.add(post.id);

      if (reviewedIds.has(post.id)) {
        encounteredReviewedIds.add(post.id);
        logger.info(
          {
            postId: post.id,
            reviewedEncountered: encounteredReviewedIds.size,
            maxAlreadyReviewedPosts: maxReviewed,
          },
          "Encountered an already reviewed post.",
        );
      } else {
        posts.set(post.id, post);
        logger.info(
          {
            current: posts.size,
            maxPosts: config.MAX_POSTS,
            postId: post.id,
            url: post.url,
            textLength: post.text.length,
            textPreview: post.text.slice(0, 180),
          },
          "Extracted a new post from the current feed position.",
        );
      }

      if (posts.size >= config.MAX_POSTS) {
        stopReason = "max_posts";
        break;
      }
      if (maxReviewed > 0 && encounteredReviewedIds.size >= maxReviewed) {
        stopReason = "max_reviewed";
        break;
      }
    }

    const metrics = await pageMetrics(page);
    logger.info(
      {
        currentViewport: viewport + 1,
        maxViewports: config.SCROLL_STEPS + 1,
        ...metrics,
        expandedTextCount,
        visibleExtractedPostCount: visibleExtraction.posts.length,
        encounteredPostCount: encounteredIds.size,
        extractedNewPostCount: posts.size,
        encounteredReviewedPostCount: encounteredReviewedIds.size,
      },
      "Processed current feed position.",
    );

    if (stopReason !== "scroll_limit" || viewport === config.SCROLL_STEPS) break;

    await pauseWithJitter();
    const scrollDistance = nextScrollDistance(metrics.viewportHeight);
    if (steps) {
      const action = await waitForStepAction(
        `Step mode: processed feed position ${viewport + 1}. Press Enter to scroll ${scrollDistance}px, or Escape to stop and classify.`,
      );
      if (action === "stop") {
        stopReason = "manual";
        logger.info(
          { extractedNewPostCount: posts.size, currentViewport: viewport + 1 },
          "Stopped feed walk from step mode.",
        );
        break;
      }
    }
    logger.debug({ scrollDistance }, "Advancing to the next feed position.");
    await page.mouse.wheel(0, scrollDistance);
    await pauseWithJitter();
  }

  summary.kept = posts.size;
  summary.encounteredPostCount = encounteredIds.size;
  summary.encounteredReviewedPostCount = encounteredReviewedIds.size;
  summary.stopReason = stopReason;
  logger.info(
    {
      stopReason,
      extractedNewPostCount: posts.size,
      encounteredPostCount: encounteredIds.size,
      encounteredReviewedPostCount: encounteredReviewedIds.size,
      scannedViewports: summary.scannedViewports,
    },
    "Stopped walking Facebook feed.",
  );

  return {
    rawCandidates: Array.from(rawPosts.values()),
    posts: Array.from(posts.values()),
    summary,
  };
}

function mergeExtractionSummary(target: ExtractionSummary, source: ExtractionSummary) {
  target.rawArticleCardCount += source.rawArticleCardCount;
  target.rawFeedTextBlockCount += source.rawFeedTextBlockCount;
  target.skippedEmpty += source.skippedEmpty;
  target.skippedNoPostLink += source.skippedNoPostLink;
  target.skippedCommentPermalink += source.skippedCommentPermalink;
  target.skippedOld += source.skippedOld;
  target.skippedDuplicate += source.skippedDuplicate;
  target.skippedTruncated += source.skippedTruncated;
}

async function scrollFeedForSnapshot(page: Page) {
  await waitForFeed(page);

  let expandedTextCount = await expandVisibleTruncatedPostText(page);
  for (let i = 0; i < config.SCROLL_STEPS; i += 1) {
    await pauseWithJitter();
    const before = await pageMetrics(page);
    logger.info({ current: i + 1, total: config.SCROLL_STEPS, ...before }, "Scrolling feed.");
    await page.mouse.wheel(0, nextScrollDistance(before.viewportHeight));
    await pauseWithJitter();
    const expandedAfterScroll = await expandVisibleTruncatedPostText(page);
    expandedTextCount += expandedAfterScroll;
    const after = await pageMetrics(page);
    logger.info(
      {
        current: i + 1,
        total: config.SCROLL_STEPS,
        ...after,
        expandedAfterScroll,
        expandedTextCount,
      },
      "Scroll completed.",
    );
  }
}

async function expandVisibleTruncatedPostText(page: Page) {
  let expanded = 0;
  for (let index = 0; index < 25; index += 1) {
    const candidateHandle = await page.evaluateHandle(findVisibleTruncatedButtonInPage);
    const button = candidateHandle.asElement() as ElementHandle<HTMLElement> | null;
    if (!button) {
      await candidateHandle.dispose();
      break;
    }

    try {
      await pauseWithJitter();
      await button.click({ timeout: 3_000 });
      expanded += 1;
    } catch (error) {
      logger.debug({ err: error }, "Could not expand a truncated Facebook post body.");
      break;
    } finally {
      await candidateHandle.dispose();
    }
  }

  if (expanded > 0) {
    logger.info({ expandedTextCount: expanded }, "Expanded truncated Facebook post text.");
  }
  return expanded;
}

async function pageMetrics(page: Page) {
  return page.evaluate(readPageMetricsInPage);
}

async function assertFacebookAccessible(page: Page) {
  const state = await page.evaluate(readFacebookAccessStateInPage);
  if (state.hasCaptcha) {
    throw new FacebookAccessError(
      `Facebook appears to be showing a CAPTCHA, checkpoint, or security challenge at ${state.href}.`,
    );
  }
  if (state.hasLogin) {
    throw new FacebookAccessError(
      `Facebook appears to require login at ${state.href}. Run pnpm run auth to refresh the session.`,
    );
  }
}

async function extractPosts(page: Page, includeHtml: boolean): Promise<DebugPostExtraction> {
  const groupId = config.FACEBOOK_GROUP_URL.match(GROUP_ID_PATTERN)?.[1];
  const rawPosts = await page.evaluate(extractRawPostsInPage, {
    groupId,
    includeHtml,
    maxPosts: config.MAX_POSTS,
  });

  const { posts, summary } = parseRawPosts(rawPosts);
  return { rawCandidates: rawPosts, posts, summary };
}

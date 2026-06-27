import type { ClassifiedPost } from "./classifier/index.js";
import { classifyPost } from "./classifier/index.js";
import { config } from "./config.js";
import {
  FacebookAccessError,
  saveFacebookPageSnapshot,
  saveFacebookSession,
  scrapeRecentPosts,
} from "./facebook/index.js";
import { enableDebugLogging, logger } from "./logger.js";
import { notify, notifyAlert } from "./notify.js";
import {
  appendMatches,
  createDebugRun,
  localDateKey,
  markPostsReviewed,
  readDailyRunState,
  readReviewedPostIds,
  writeDailyRunSuccess,
  writeReviewedPostIds,
} from "./state.js";

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === "auth") {
    await saveFacebookSession();
    return;
  }

  if (command === "scrape" || command == null) {
    const debug = args.includes("--debug");
    const steps = args.includes("--steps");
    const daily = args.includes("--daily");
    if (steps && !debug) {
      throw new Error("--steps requires --debug so the browser remains visible.");
    }
    if (debug) {
      enableDebugLogging();
    }
    const options = {
      debug,
      headed: args.includes("--headed"),
      steps,
    };
    if (daily && (await dailyScrapeAlreadyCompleted())) {
      return;
    }

    await runScrape(options);

    if (daily) {
      const completed = await writeDailyRunSuccess();
      logger.info(completed, "Recorded successful daily scrape.");
    }
    return;
  }

  if (command === "snapshot") {
    enableDebugLogging();
    const debugRun = await createDebugRun();
    const snapshotDir = await saveFacebookPageSnapshot({
      debugRun,
      headed: args.includes("--headed"),
    });
    logger.info({ debugRunDir: debugRun.dir, snapshotDir }, "Saved Facebook page snapshot.");
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

type RunScrapeOptions = {
  headed: boolean;
  debug: boolean;
  steps: boolean;
};

async function dailyScrapeAlreadyCompleted() {
  const today = localDateKey();
  const state = await readDailyRunState();
  if (state.lastSuccessfulRunAt && localDateKey(new Date(state.lastSuccessfulRunAt)) === today) {
    logger.info(
      { lastSuccessfulRunAt: state.lastSuccessfulRunAt, today },
      "Daily scrape already completed; skipping.",
    );
    return true;
  }

  logger.info({ today }, "No successful scrape recorded today; starting daily run.");
  return false;
}

async function runScrape(options: RunScrapeOptions) {
  const debugRun = options.debug ? await createDebugRun() : undefined;
  logger.info(
    {
      debug: options.debug,
      debugRunDir: debugRun?.dir,
      headed: options.headed,
      steps: options.steps,
      maxPosts: config.MAX_POSTS,
      maxAlreadyReviewedPosts: config.MAX_ALREADY_REVIEWED_POSTS,
      maxFeedAdvances: config.SCROLL_STEPS,
      headlessViewport:
        options.headed || options.debug
          ? undefined
          : `${config.HEADLESS_VIEWPORT_WIDTH}x${config.HEADLESS_VIEWPORT_HEIGHT}`,
    },
    "Starting scrape.",
  );
  const reviewedPostIds = await readReviewedPostIds();
  const reviewedIds = new Set(reviewedPostIds);
  logger.info({ reviewedPostCount: reviewedIds.size }, "Loaded reviewed post ids from cache.");
  const scrapedPosts = await scrapeRecentPosts({
    debugRun,
    headed: options.headed,
    reviewedIds,
    steps: options.steps,
  });
  const newPosts = scrapedPosts.filter((post) => !reviewedIds.has(post.id));

  logger.info(
    { extractedPostCount: scrapedPosts.length, newPostCount: newPosts.length },
    "Finished scrape extraction.",
  );

  const matches: ClassifiedPost[] = [];
  const newlyReviewedIds: string[] = [];
  for (const [index, post] of newPosts.entries()) {
    logger.info(
      { current: index + 1, total: newPosts.length, postId: post.id, url: post.url },
      "Classifying post.",
    );
    const classification = await classifyPost(post, { debugRun });
    newlyReviewedIds.push(post.id);

    logger.info(
      {
        category: classification.category,
        confidence: classification.confidence,
        url: post.url,
      },
      "Classified post.",
    );

    if (classification.category !== "not_relevant") {
      matches.push({ ...post, classification });
    }
  }

  await writeReviewedPostIds(markPostsReviewed(reviewedPostIds, newlyReviewedIds));
  await appendMatches(matches);
  await notify(matches);

  if (matches.length === 0) {
    logger.info("No relevant posts found.");
  }
}

main().catch(async (error) => {
  logger.error({ err: error }, "Run failed.");
  await notifyAlert({
    title:
      error instanceof FacebookAccessError ? "Facebook scraper blocked" : "Facebook scraper failed",
    message: error instanceof Error ? error.message : String(error),
    details: error instanceof Error ? error.stack : undefined,
  }).catch((notificationError) => {
    logger.error({ err: notificationError }, "Failed to send scraper failure notification.");
  });
  process.exitCode = 1;
});

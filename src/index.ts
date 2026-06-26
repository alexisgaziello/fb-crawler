import type { ClassifiedPost } from "./classifier.js";
import { classifyPost } from "./classifier.js";
import { config } from "./config.js";
import { FacebookAccessError, saveFacebookSession, scrapeRecentPosts } from "./facebook.js";
import { enableDebugLogging, logger } from "./logger.js";
import { notify, notifyAlert } from "./notify.js";
import {
  appendMatches,
  markPostsReviewed,
  readReviewedPosts,
  reviewedPostIds,
  writeReviewedPosts,
} from "./state.js";

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === "auth") {
    await saveFacebookSession();
    return;
  }

  if (command === "scrape" || command == null) {
    if (args.includes("--debug")) {
      enableDebugLogging();
    }
    await runScrape({
      debug: args.includes("--debug"),
      headed: args.includes("--headed"),
    });
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

type RunScrapeOptions = {
  headed: boolean;
  debug: boolean;
};

async function runScrape(options: RunScrapeOptions) {
  logger.info(
    { debug: options.debug, headed: options.headed, maxPosts: config.MAX_POSTS },
    "Starting scrape.",
  );
  const reviewedPosts = await readReviewedPosts();
  const reviewedIds = reviewedPostIds(reviewedPosts);
  logger.info({ reviewedPostCount: reviewedIds.size }, "Loaded reviewed post ids from cache.");
  const scrapedPosts = await scrapeRecentPosts(options);
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
    const classification = await classifyPost(post, { debug: options.debug });
    newlyReviewedIds.push(post.id);

    logger.info(
      {
        category: classification.category,
        confidence: classification.confidence,
        url: post.url,
      },
      "Classified post.",
    );

    if (classification.relevant && classification.category !== "not_relevant") {
      matches.push({ ...post, classification });
    }
  }

  await writeReviewedPosts(markPostsReviewed(reviewedPosts, newlyReviewedIds));
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

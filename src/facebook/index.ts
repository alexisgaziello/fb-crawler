export type { ScrapedPost } from "./parser.js";
export {
  cleanExtractedText,
  derivePostId,
  looksOlderThanLookback,
  normalizeFacebookUrl,
} from "./parser.js";
export type { DebugPostExtraction, ScrapeOptions } from "./scraper.js";
export {
  FacebookAccessError,
  saveFacebookPageSnapshot,
  saveFacebookSession,
  scrapeRecentPosts,
} from "./scraper.js";

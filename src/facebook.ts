import { chromium, type Page } from "playwright";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { pauseWithJitter } from "./pacing.js";
import { ensureParentDir, hasStorageState, writeDebugPosts } from "./state.js";

const GROUP_ID_PATTERN = /groups\/([^/?#]+)/;

export class FacebookAccessError extends Error {
  constructor(
    message: string,
    readonly reason: "login_required" | "captcha_or_checkpoint",
    readonly pageUrl: string,
  ) {
    super(message);
    this.name = "FacebookAccessError";
  }
}

export type ScrapedPost = {
  id: string;
  url: string;
  text: string;
  timestampText?: string;
  author?: string;
};

export type ScrapeOptions = {
  headed?: boolean;
  debug?: boolean;
};

type RawPost = {
  index: number;
  ariaLabel: string;
  html: string;
  text: string;
  href: string;
  anchors: AnchorSummary[];
  candidatePostLinks: AnchorSummary[];
  hasCommentPermalink: boolean;
  timestampText: string;
  author: string;
};

type AnchorSummary = {
  href: string;
  text: string;
  ariaLabel: string;
  isPostPermalink: boolean;
  isCommentPermalink: boolean;
};

type ExtractionSummary = {
  rawArticleCardCount: number;
  kept: number;
  skippedEmpty: number;
  skippedNoPostLink: number;
  skippedCommentPermalink: number;
  skippedOld: number;
  skippedDuplicate: number;
};

export type DebugPageSnapshot = {
  url: string;
  title: string;
  bodyTextPreview: string;
  selectorCounts: Record<string, number>;
  articleSummaries: Array<{
    index: number;
    ariaLabel: string;
    textLength: number;
    textPreview: string;
    anchors: AnchorSummary[];
  }>;
  postLinks: AnchorSummary[];
  groupLinks: AnchorSummary[];
  containerSummaries: Array<{
    selector: string;
    index: number;
    textLength: number;
    textPreview: string;
    htmlPreview: string;
    anchorCount: number;
    postLinkCount: number;
    commentPermalinkCount: number;
    roleArticleCount: number;
    ariaLabels: string[];
  }>;
  candidateTextBlocks: Array<{
    index: number;
    tagName: string;
    textLength: number;
    textPreview: string;
    nearestRole: string;
    nearestAriaLabel: string;
    anchorCount: number;
    postLinkCount: number;
  }>;
};

export type DebugPostExtraction = {
  page: DebugPageSnapshot;
  rawArticleCards: RawPost[];
  posts: ScrapedPost[];
  summary: ExtractionSummary;
};

function groupUrl(sortRecent = true) {
  const url = new URL(config.FACEBOOK_GROUP_URL);
  if (sortRecent) {
    url.searchParams.set("sorting_setting", "CHRONOLOGICAL");
  }
  return url.toString();
}

export async function saveFacebookSession() {
  await ensureParentDir(config.storageStatePath);
  const existingSession = await hasStorageState();
  const browser = await chromium.launch({ headless: false, slowMo: config.SLOW_MO_MS });
  const context = await browser.newContext(
    existingSession ? { storageState: config.storageStatePath } : undefined,
  );

  try {
    const page = await context.newPage();
    await page.goto(groupUrl(false), { waitUntil: "domcontentloaded", timeout: 90_000 });

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
  if (!(await hasStorageState())) {
    throw new Error("No saved Facebook session. Run `pnpm run auth` first.");
  }

  const headed = options.headed === true || options.debug === true;
  const browser = await chromium.launch({
    headless: headed ? false : config.HEADLESS,
    slowMo: config.SLOW_MO_MS,
  });
  const context = await browser.newContext({ storageState: config.storageStatePath });
  const page = await context.newPage();

  try {
    logger.info({ url: config.FACEBOOK_GROUP_URL }, "Opening Facebook group.");
    await page.goto(groupUrl(true), { waitUntil: "domcontentloaded", timeout: 90_000 });
    logger.info({ url: page.url() }, "Facebook group loaded.");
    await pauseWithJitter();
    await assertFacebookAccessible(page);
    const dismissedDialogs = await dismissCommonDialogs(page);
    logger.info({ dismissedDialogs }, "Dismissed dialog buttons.");
    await assertFacebookAccessible(page);
    logger.info("Loading feed by scrolling.");
    await loadFeed(page);
    await assertFacebookAccessible(page);
    logger.info("Extracting post cards.");
    const extraction = await extractPosts(page);
    const posts = extraction.posts;
    logger.info({ discoveredPostCount: posts.length }, "Discovered posts after filtering cards.");

    const slicedPosts = posts.slice(0, config.MAX_POSTS);
    if (slicedPosts.length !== posts.length) {
      logger.info(
        { usedPostCount: slicedPosts.length, maxPosts: config.MAX_POSTS },
        "Capped discovered posts by MAX_POSTS.",
      );
    }

    if (options.debug) {
      await writeDebugPosts({
        ...extraction,
        posts: slicedPosts,
        rawArticleCards: extraction.rawArticleCards.slice(0, config.MAX_POSTS * 2),
      });
    }

    return slicedPosts;
  } finally {
    if (options.debug) {
      logger.info("Debug mode: browser is still open. Press Enter to close it.");
      await waitForEnter();
    }
    await browser.close();
  }
}

async function waitForEnter() {
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
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

async function loadFeed(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  for (let i = 0; i < 5; i += 1) {
    await pauseWithJitter();
    await page.mouse.wheel(0, 1800);
    logger.debug({ current: i + 1, total: 5 }, "Scroll completed.");
    await pauseWithJitter();
  }
}

async function assertFacebookAccessible(page: Page) {
  const state = (await page.evaluate(`(() => {
    const text = document.body?.innerText?.toLowerCase() ?? "";
    const href = location.href.toLowerCase();
    const loginSelectors = [
      'input[name="email"]',
      'input[name="pass"]',
      'form[action*="login"]',
      'a[href*="/login"]',
    ];
    const hasLoginSelector = loginSelectors.some((selector) => document.querySelector(selector));
    const hasCaptcha =
      text.includes("captcha") ||
      text.includes("security check") ||
      text.includes("confirm you are human") ||
      text.includes("checkpoint") ||
      href.includes("/checkpoint/");
    const hasLogin =
      hasLoginSelector ||
      href.includes("/login") ||
      text.includes("log in to facebook") ||
      text.includes("you must log in");

    return { hasCaptcha, hasLogin, href };
  })()`)) as { hasCaptcha: boolean; hasLogin: boolean; href: string };

  if (state.hasCaptcha) {
    throw new FacebookAccessError(
      `Facebook appears to be showing a CAPTCHA, checkpoint, or security challenge at ${state.href}.`,
      "captcha_or_checkpoint",
      state.href,
    );
  }

  if (state.hasLogin) {
    throw new FacebookAccessError(
      `Facebook appears to require login at ${state.href}. Run pnpm run auth to refresh the session.`,
      "login_required",
      state.href,
    );
  }
}

async function extractPosts(page: Page): Promise<DebugPostExtraction> {
  const groupId = config.FACEBOOK_GROUP_URL.match(GROUP_ID_PATTERN)?.[1];
  const extractionScript = `(() => {
    const gid = ${JSON.stringify(groupId)};
    const maxPosts = ${JSON.stringify(config.MAX_POSTS)};
    const normalize = (value) => (value ?? "").replace(/\\s+/g, " ").trim();
    const articles = Array.from(document.querySelectorAll('[role="article"]'));
    const summarizeAnchor = (anchor) => {
      const href = anchor.href;
      const parsed = new URL(href, location.href);
      const isPostPermalink = href.includes("/posts/") || href.includes("multi_permalinks=");
      return {
        href,
        text: normalize(anchor.textContent).slice(0, 300),
        ariaLabel: normalize(anchor.getAttribute("aria-label")).slice(0, 300),
        isPostPermalink,
        isCommentPermalink: parsed.searchParams.has("comment_id"),
      };
    };
    const eligiblePostHref = (href) => {
      const parsed = new URL(href, location.href);
      if (parsed.searchParams.has("comment_id")) return false;
      return href.includes("/posts/") || href.includes("multi_permalinks=");
    };

    return articles.slice(0, maxPosts * 2).map((article, index) => {
      const text = normalize(article.textContent);
      const ariaLabel = normalize(article.getAttribute("aria-label"));
      const anchors = Array.from(article.querySelectorAll("a[href]"));
      const hrefs = anchors.map((anchor) => anchor.href).filter(Boolean);
      const anchorSummaries = anchors.slice(0, 20).map(summarizeAnchor);
      const candidatePostLinks = anchorSummaries.filter((anchor) => anchor.isPostPermalink);
      const hasCommentPermalink = hrefs.some((href) => {
        const parsed = new URL(href, location.href);
        return parsed.searchParams.has("comment_id");
      });
      const postHref =
        hrefs.find(eligiblePostHref) ??
        hrefs.find((href) => gid && href.includes("/groups/" + gid) && eligiblePostHref(href)) ??
        "";

      const timeElement = article.querySelector(
        "abbr, a[aria-label*='ago'], span[aria-label*='ago']",
      );
      const timestampText = normalize(
        timeElement?.getAttribute("aria-label") ?? timeElement?.textContent,
      );
      const author = normalize(article.querySelector("strong a, h2 a, h3 a")?.textContent);

      return {
        index,
        ariaLabel,
        html: article.outerHTML,
        text,
        href: postHref,
        anchors: anchorSummaries,
        candidatePostLinks,
        hasCommentPermalink,
        timestampText,
        author,
      };
    });
  })()`;

  const rawPostsResult = await page.evaluate(extractionScript);
  if (!Array.isArray(rawPostsResult)) {
    throw new Error("Facebook post extraction returned an unexpected non-array result.");
  }
  const rawPosts = rawPostsResult as RawPost[];
  const pageSnapshot = await captureDebugPageSnapshot(page);
  logger.debug(
    {
      selectorCounts: pageSnapshot.selectorCounts,
      postLinkCount: pageSnapshot.postLinks.length,
      articleSummaries: pageSnapshot.articleSummaries.slice(0, 12),
    },
    "Captured page snapshot for selector analysis.",
  );

  const summary: ExtractionSummary = {
    rawArticleCardCount: rawPosts.length,
    kept: 0,
    skippedEmpty: 0,
    skippedNoPostLink: 0,
    skippedCommentPermalink: 0,
    skippedOld: 0,
    skippedDuplicate: 0,
  };

  logger.info({ rawArticleCardCount: summary.rawArticleCardCount }, "Found raw article cards.");

  const seen = new Set<string>();
  const posts: ScrapedPost[] = [];

  for (const raw of rawPosts) {
    if (!raw.text || raw.text.length < 40) {
      summary.skippedEmpty += 1;
      continue;
    }
    if (!raw.href) {
      if (raw.hasCommentPermalink) {
        summary.skippedCommentPermalink += 1;
      } else {
        summary.skippedNoPostLink += 1;
      }
      continue;
    }
    if (looksOlderThanLookback(raw.timestampText)) {
      summary.skippedOld += 1;
      continue;
    }

    const url = normalizeFacebookUrl(raw.href);
    const id = derivePostId(url, raw.text);
    if (seen.has(id)) {
      summary.skippedDuplicate += 1;
      continue;
    }
    seen.add(id);

    posts.push({
      id,
      url,
      text: raw.text,
      timestampText: raw.timestampText || undefined,
      author: raw.author || undefined,
    });
  }

  summary.kept = posts.length;

  if (posts.length === 0) {
    await captureDebugArtifacts(page, "no-posts");
  }

  logger.info(
    {
      kept: summary.kept,
      skippedEmpty: summary.skippedEmpty,
      skippedNoPostLink: summary.skippedNoPostLink,
      skippedCommentPermalink: summary.skippedCommentPermalink,
      skippedOld: summary.skippedOld,
      skippedDuplicate: summary.skippedDuplicate,
    },
    "Post extraction summary.",
  );

  return {
    page: pageSnapshot,
    rawArticleCards: rawPosts,
    posts,
    summary,
  };
}

async function captureDebugPageSnapshot(page: Page): Promise<DebugPageSnapshot> {
  return (await page.evaluate(`(() => {
    const normalize = (value) => (value ?? "").replace(/\\s+/g, " ").trim();
    const articles = Array.from(document.querySelectorAll('[role="article"]'));
    const postAnchors = Array.from(document.querySelectorAll('a[href*="/posts/"], a[href*="multi_permalinks="]'));
    const groupAnchors = Array.from(document.querySelectorAll('a[href*="/groups/"]'));
    const anchorSummary = (anchor) => {
      const href = anchor.href;
      const parsed = new URL(href, location.href);
      const isPostPermalink = href.includes("/posts/") || href.includes("multi_permalinks=");
      return {
        href,
        text: normalize(anchor.textContent).slice(0, 300),
        ariaLabel: normalize(anchor.getAttribute("aria-label")).slice(0, 300),
        isPostPermalink,
        isCommentPermalink: parsed.searchParams.has("comment_id"),
      };
    };
    const summarizeContainer = (element, selector, index) => {
      const text = normalize(element.textContent);
      const anchors = Array.from(element.querySelectorAll("a[href]"));
      const anchorSummaries = anchors.map(anchorSummary);
      return {
        selector,
        index,
        textLength: text.length,
        textPreview: text.slice(0, 2500),
        htmlPreview: element.outerHTML.slice(0, 20000),
        anchorCount: anchors.length,
        postLinkCount: anchorSummaries.filter((anchor) => anchor.isPostPermalink).length,
        commentPermalinkCount: anchorSummaries.filter((anchor) => anchor.isCommentPermalink).length,
        roleArticleCount: element.querySelectorAll('[role="article"]').length,
        ariaLabels: Array.from(element.querySelectorAll("[aria-label]"))
          .map((node) => normalize(node.getAttribute("aria-label")))
          .filter(Boolean)
          .slice(0, 80),
      };
    };
    const containerSummaries = [
      ...Array.from(document.querySelectorAll('[role="main"]')).slice(0, 3).map((element, index) => summarizeContainer(element, '[role="main"]', index)),
      ...Array.from(document.querySelectorAll('[role="feed"]')).slice(0, 3).map((element, index) => summarizeContainer(element, '[role="feed"]', index)),
      ...Array.from(document.querySelectorAll('[role="list"]')).slice(0, 3).map((element, index) => summarizeContainer(element, '[role="list"]', index)),
      ...Array.from(document.querySelectorAll('[data-pagelet]')).slice(0, 20).map((element, index) => summarizeContainer(element, '[data-pagelet]', index)),
    ];
    const candidateTextBlocks = Array.from(document.querySelectorAll('[role="main"] div, [role="main"] span'))
      .map((element, index) => {
        const text = normalize(element.textContent);
        const nearestRoleElement = element.closest("[role]");
        const anchors = Array.from(element.querySelectorAll("a[href]"));
        const postLinkCount = anchors.filter((anchor) => {
          const href = anchor.href;
          return href.includes("/posts/") || href.includes("multi_permalinks=");
        }).length;
        return {
          index,
          tagName: element.tagName.toLowerCase(),
          textLength: text.length,
          textPreview: text.slice(0, 1200),
          nearestRole: normalize(nearestRoleElement?.getAttribute("role")),
          nearestAriaLabel: normalize(nearestRoleElement?.getAttribute("aria-label")),
          anchorCount: anchors.length,
          postLinkCount,
        };
      })
      .filter((block) => block.textLength >= 80)
      .sort((left, right) => right.textLength - left.textLength)
      .slice(0, 80);

    return {
      url: location.href,
      title: document.title,
      bodyTextPreview: normalize(document.body?.innerText).slice(0, 12000),
      selectorCounts: {
        roleArticle: articles.length,
        postLinks: postAnchors.length,
        groupLinks: groupAnchors.length,
        commentPermalinks: postAnchors.filter((anchor) => anchorSummary(anchor).isCommentPermalink).length,
        feedUnitPagelets: document.querySelectorAll('[data-pagelet*="FeedUnit"]').length,
        groupPagelets: document.querySelectorAll('[data-pagelet*="Group"]').length,
        mainRole: document.querySelectorAll('[role="main"]').length,
        feedRole: document.querySelectorAll('[role="feed"]').length,
        listRole: document.querySelectorAll('[role="list"]').length,
      },
      articleSummaries: articles.slice(0, 60).map((article, index) => {
        const text = normalize(article.textContent);
        return {
          index,
          ariaLabel: normalize(article.getAttribute("aria-label")),
          textLength: text.length,
          textPreview: text.slice(0, 500),
          anchors: Array.from(article.querySelectorAll("a[href]")).slice(0, 20).map(anchorSummary),
        };
      }),
      postLinks: postAnchors.slice(0, 150).map(anchorSummary),
      groupLinks: groupAnchors.slice(0, 200).map(anchorSummary),
      containerSummaries,
      candidateTextBlocks,
    };
  })()`)) as DebugPageSnapshot;
}

function normalizeFacebookUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("__cft__");
    parsed.searchParams.delete("__tn__");
    parsed.searchParams.delete("ref");
    return parsed.toString();
  } catch {
    return config.FACEBOOK_GROUP_URL;
  }
}

function derivePostId(url: string, text: string) {
  const parsed = new URL(url, config.FACEBOOK_GROUP_URL);
  const postId =
    parsed.pathname.match(/\/posts\/([^/?#]+)/)?.[1] ??
    parsed.searchParams.get("multi_permalinks") ??
    parsed.searchParams.get("story_fbid");

  if (postId) return postId;

  let hash = 0;
  for (const char of `${url}\n${text.slice(0, 500)}`) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `hash-${hash.toString(16)}`;
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

async function captureDebugArtifacts(page: Page, label: string) {
  await ensureParentDir(`${config.matchesPath}.placeholder`);
  const screenshotPath = `${config.matchesPath}.${label}.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  logger.warn({ screenshotPath }, "No posts extracted. Saved screenshot for debugging.");
}

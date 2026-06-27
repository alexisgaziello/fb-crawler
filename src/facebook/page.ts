export type RawPost = {
  source: "article" | "feed_text_block";
  index: number;
  html?: string;
  text: string;
  href: string;
  anchorCount: number;
  hasCommentPermalink: boolean;
  timestampText: string;
  author: string;
  documentTop: number;
  hasTruncatedTextControl: boolean;
};

export type PageMetrics = {
  scrollY: number;
  bodyHeight: number;
  feedTextLength: number;
  viewportHeight: number;
};

export type FacebookAccessState = {
  hasCaptcha: boolean;
  hasLogin: boolean;
  href: string;
};

export type VisibleButtonCandidate = {
  text: string;
  ariaLabel: string;
  visible: boolean;
  top: number;
};

export type FullPageCaptureData = {
  url: string;
  title: string;
  viewport: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
    bodyHeight: number;
  };
  counts: {
    anchors: number;
    roleArticle: number;
    roleFeed: number;
    roleMain: number;
    visibleTextBlocks: number;
  };
  anchors: Array<{
    index: number;
    href: string;
    text: string;
    ariaLabel: string;
    role: string;
  }>;
  visibleTextBlocks: Array<{
    index: number;
    tagName: string;
    role: string;
    ariaLabel: string;
    textLength: number;
    text: string;
    rect: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    anchorCount: number;
  }>;
};

export function findButtonByLabelsInPage(labels: string[]) {
  const helpers = {
    normalize(value: string | null | undefined) {
      return (value ?? "").replace(/\s+/g, " ").trim();
    },
  };

  const expectedLabels = new Set(labels);
  const buttons = Array.from(document.querySelectorAll<HTMLElement>('[role="button"]'));
  for (const button of buttons) {
    const texts = [
      helpers.normalize(button.innerText || button.textContent),
      ...Array.from(button.querySelectorAll<HTMLElement>("span")).map((span) =>
        helpers.normalize(span.innerText || span.textContent),
      ),
    ];
    if (texts.some((text) => expectedLabels.has(text))) return button;
  }
  return false;
}

export function readVisibleButtonCandidatesInPage(): VisibleButtonCandidate[] {
  const helpers = {
    normalize(value: string | null | undefined) {
      return (value ?? "").replace(/\s+/g, " ").trim();
    },
  };

  const root = document.querySelector('[role="main"]') ?? document.body;
  return Array.from(root.querySelectorAll<HTMLElement>('[role="button"]'))
    .filter((button) => !button.closest('[role="article"]'))
    .map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        text: helpers.normalize(button.innerText || button.textContent).slice(0, 120),
        ariaLabel: helpers.normalize(button.getAttribute("aria-label")).slice(0, 120),
        visible:
          rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight,
        top: Math.round(rect.top),
      };
    })
    .filter((candidate) => candidate.visible && candidate.text)
    .slice(0, 30);
}

export function findVisibleTruncatedButtonInPage() {
  const helpers = {
    normalize(value: string | null | undefined) {
      return (value ?? "").replace(/\s+/g, " ").trim();
    },
  };

  const feed = document.querySelector('[role="feed"]');
  if (!feed) return null;

  for (const button of Array.from(feed.querySelectorAll<HTMLElement>('[role="button"]'))) {
    const rect = button.getBoundingClientRect();
    const visible =
      rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight;
    if (!visible) continue;

    const buttonText = helpers.normalize(button.innerText || button.textContent);
    if (!buttonText || buttonText.length > 40) continue;

    let ancestor = button.parentElement;
    let isTruncatedTextControl = false;
    for (let depth = 0; ancestor && ancestor !== feed && depth < 6; depth += 1) {
      const ancestorText = helpers.normalize(ancestor.innerText || ancestor.textContent);
      const buttonIndex = ancestorText.lastIndexOf(buttonText);
      if (buttonIndex > 0 && ancestorText.length <= 2500) {
        const textBeforeButton = ancestorText.slice(0, buttonIndex).trimEnd();
        if (/(?:\.\.\.|…)\s*$/.test(textBeforeButton)) {
          isTruncatedTextControl = true;
          break;
        }
      }
      ancestor = ancestor.parentElement;
    }

    if (isTruncatedTextControl) return button;
  }
  return null;
}

export function readPageMetricsInPage(): PageMetrics {
  return {
    scrollY: Math.round(window.scrollY),
    bodyHeight: Math.round(document.body?.scrollHeight ?? 0),
    feedTextLength: Math.round(
      document.querySelector('[role="feed"]')?.textContent?.replace(/\s+/g, " ").trim().length ?? 0,
    ),
    viewportHeight: window.innerHeight,
  };
}

export function readBodyTextInPage() {
  return document.body?.innerText ?? "";
}

export function captureFullPageDataInPage(): FullPageCaptureData {
  const helpers = {
    normalize(value: string | null | undefined) {
      return (value ?? "").replace(/\s+/g, " ").trim();
    },
  };

  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).map(
    (anchor, index) => ({
      index,
      href: anchor.href,
      text: helpers.normalize(anchor.textContent).slice(0, 1000),
      ariaLabel: helpers.normalize(anchor.getAttribute("aria-label")).slice(0, 1000),
      role: helpers.normalize(anchor.getAttribute("role")),
    }),
  );
  const visibleTextBlocks = Array.from(document.querySelectorAll<HTMLElement>("body *"))
    .map((element, index) => {
      const rect = element.getBoundingClientRect();
      const text = helpers.normalize(element.innerText ?? element.textContent);
      return {
        index,
        tagName: element.tagName.toLowerCase(),
        role: helpers.normalize(element.getAttribute("role")),
        ariaLabel: helpers.normalize(element.getAttribute("aria-label")).slice(0, 1000),
        textLength: text.length,
        text,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        anchorCount: element.querySelectorAll("a[href]").length,
      };
    })
    .filter((block) => block.textLength >= 30 && block.rect.width > 0 && block.rect.height > 0);

  return {
    url: location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      bodyHeight: document.body?.scrollHeight ?? 0,
    },
    counts: {
      anchors: anchors.length,
      roleArticle: document.querySelectorAll('[role="article"]').length,
      roleFeed: document.querySelectorAll('[role="feed"]').length,
      roleMain: document.querySelectorAll('[role="main"]').length,
      visibleTextBlocks: visibleTextBlocks.length,
    },
    anchors,
    visibleTextBlocks,
  };
}

export function readFacebookAccessStateInPage(): FacebookAccessState {
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
}

export function extractRawPostsInPage(options: {
  groupId?: string;
  includeHtml: boolean;
  maxPosts: number;
}): RawPost[] {
  const { groupId, includeHtml, maxPosts } = options;

  const helpers = {
    normalize(value: string | null | undefined) {
      return (value ?? "").replace(/\s+/g, " ").trim();
    },

    isVisibleInViewport(element: Element) {
      const rect = element.getBoundingClientRect();
      return (
        rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight
      );
    },

    eligiblePostHref(href: string) {
      const parsed = new URL(href, location.href);
      return (
        !parsed.searchParams.has("comment_id") &&
        (href.includes("/posts/") || href.includes("multi_permalinks="))
      );
    },

    commerceListingHref(href: string) {
      return href.includes("/commerce/listing/");
    },

    photoPostHref(href: string) {
      try {
        const parsed = new URL(href, location.href);
        return parsed.pathname.includes("/photo/") && parsed.searchParams.has("fbid");
      } catch {
        return false;
      }
    },

    hasMediaId(href: string) {
      try {
        return new URL(href, location.href).searchParams.has("media_id");
      } catch {
        return false;
      }
    },

    authorHref(hrefs: string[]) {
      return hrefs.find((href) => groupId && href.includes(`/groups/${groupId}/user/`)) ?? "";
    },

    anchorsFrom(element: Element) {
      const anchors = Array.from(element.querySelectorAll<HTMLAnchorElement>("a[href]"));
      const closestAnchor = element.closest<HTMLAnchorElement>("a[href]");
      if (closestAnchor) anchors.unshift(closestAnchor);
      return Array.from(new Set(anchors));
    },

    bestFallbackHref(hrefs: string[]) {
      return (
        hrefs.find(helpers.eligiblePostHref) ??
        hrefs.find((href) => helpers.commerceListingHref(href) && !helpers.hasMediaId(href)) ??
        hrefs.find(helpers.commerceListingHref) ??
        hrefs.find(helpers.photoPostHref) ??
        ""
      );
    },

    timestampTextFrom(element: Element) {
      const timeElement = element.querySelector(
        "abbr, a[aria-label*='ago'], span[aria-label*='ago']",
      );
      return helpers.normalize(timeElement?.getAttribute("aria-label") ?? timeElement?.textContent);
    },

    authorFrom(element: Element, hrefs: string[]) {
      const explicitAuthor = helpers.normalize(
        element.querySelector("strong a, h2 a, h3 a")?.textContent,
      );
      if (explicitAuthor) return explicitAuthor;

      const expectedHref = helpers.authorHref(hrefs);
      const authorAnchor = Array.from(element.querySelectorAll<HTMLAnchorElement>("a[href]")).find(
        (anchor) => anchor.href === expectedHref,
      );
      return helpers.normalize(
        authorAnchor?.textContent ?? authorAnchor?.getAttribute("aria-label"),
      );
    },

    hasTruncatedTextControl(element: Element) {
      for (const button of Array.from(element.querySelectorAll<HTMLElement>('[role="button"]'))) {
        const buttonText = helpers.normalize(button.innerText || button.textContent);
        if (!buttonText || buttonText.length > 40) continue;

        let ancestor = button.parentElement;
        for (let depth = 0; ancestor && element.contains(ancestor) && depth < 6; depth += 1) {
          const ancestorText = helpers.normalize(ancestor.innerText || ancestor.textContent);
          const buttonIndex = ancestorText.lastIndexOf(buttonText);
          if (buttonIndex > 0 && ancestorText.length <= 2500) {
            const textBeforeButton = ancestorText.slice(0, buttonIndex).trimEnd();
            if (/(?:\.\.\.|…)\s*$/.test(textBeforeButton)) return true;
          }
          if (ancestor === element) break;
          ancestor = ancestor.parentElement;
        }
      }
      return false;
    },

    rawPostFromElement(element: HTMLElement, index: number, source: RawPost["source"]): RawPost {
      const text = helpers.normalize(element.innerText || element.textContent);
      const anchors = helpers.anchorsFrom(element);
      const hrefs = anchors.map((anchor) => anchor.href).filter(Boolean);
      const hasCommentPermalink = hrefs.some((href) =>
        new URL(href, location.href).searchParams.has("comment_id"),
      );
      const postHref =
        hrefs.find(helpers.eligiblePostHref) ??
        hrefs.find(
          (href) =>
            groupId && href.includes(`/groups/${groupId}`) && helpers.eligiblePostHref(href),
        ) ??
        (source === "feed_text_block" ? helpers.bestFallbackHref(hrefs) : "");

      return {
        source,
        index,
        html: includeHtml ? element.outerHTML : undefined,
        text,
        href: postHref,
        anchorCount: anchors.length,
        hasCommentPermalink,
        timestampText: helpers.timestampTextFrom(element),
        author: helpers.authorFrom(element, hrefs),
        documentTop: Math.round(element.getBoundingClientRect().top + window.scrollY),
        hasTruncatedTextControl: helpers.hasTruncatedTextControl(element),
      };
    },

    looksLikeMarketplaceListing(text: string) {
      if (text.length < 80 || text.length > 2200) return false;
      const hasGearOrMarketplaceSignal =
        /\b(AAD|CYPRES|Vigil|Optima|Viso|Mirage|Javelin|Vector|Icon|Curv|Infinity|Katana|Sabre|Pilot|Spectre|container|canopy|rig|reserve|main|DOM)\b/i.test(
          text,
        );
      const hasPriceSignal = /(?:[$€£]\s?\d|\d[\d,.]*\s?(?:[$€£]|USD|EUR|GBP)\b)/i.test(text);
      return hasGearOrMarketplaceSignal || hasPriceSignal;
    },

    textNoisePenalty(text: string) {
      const facebookMentions = text.match(/\bFacebook\b/g)?.length ?? 0;
      return facebookMentions * 40 + Math.max(0, text.length - 700) / 4;
    },

    candidateScore(candidate: { element: HTMLElement; text: string }) {
      const hrefs = helpers
        .anchorsFrom(candidate.element)
        .map((anchor) => anchor.href)
        .filter(Boolean);
      const bestHref = helpers.bestFallbackHref(hrefs);
      const hasStableHref =
        helpers.eligiblePostHref(bestHref) ||
        helpers.commerceListingHref(bestHref) ||
        helpers.photoPostHref(bestHref);
      const lengthScore = candidate.text.length >= 80 && candidate.text.length <= 600 ? 250 : 0;
      const hrefScore = hasStableHref ? 500 : 0;
      return hrefScore + lengthScore - helpers.textNoisePenalty(candidate.text) - hrefs.length * 3;
    },
  };

  const articles = Array.from(document.querySelectorAll<HTMLElement>('[role="article"]')).filter(
    helpers.isVisibleInViewport,
  );
  const feed = document.querySelector('[role="feed"]');
  const feedTextBlocks: RawPost[] = [];
  if (feed) {
    const seenText = new Set<string>();
    const candidates = Array.from(feed.querySelectorAll<HTMLElement>("div"))
      .map((element, index) => ({
        element,
        index,
        text: helpers.normalize(element.innerText || element.textContent),
      }))
      .filter(({ element, text }) => {
        if (!helpers.looksLikeMarketplaceListing(text) || !helpers.isVisibleInViewport(element)) {
          return false;
        }
        return !Array.from(element.children).some((child) => {
          const childText = helpers.normalize(
            (child as HTMLElement).innerText || child.textContent,
          );
          return childText.length >= text.length * 0.9;
        });
      })
      .filter(({ text }) => {
        if (seenText.has(text)) return false;
        seenText.add(text);
        return true;
      })
      .sort((left, right) => helpers.candidateScore(right) - helpers.candidateScore(left));

    feedTextBlocks.push(
      ...candidates
        .slice(0, maxPosts * 4)
        .map(({ element, index }) => helpers.rawPostFromElement(element, index, "feed_text_block")),
    );
  }

  return [
    ...articles
      .slice(0, maxPosts * 2)
      .map((article, index) => helpers.rawPostFromElement(article, index, "article")),
    ...feedTextBlocks,
  ];
}

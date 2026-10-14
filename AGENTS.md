# AGENTS.md

## Project

Local pnpm/TypeScript ESM CLI that checks a Facebook skydiving gear group, extracts recent posts, classifies them with OpenAI, and notifies the user about likely full-rig or compatible-container matches.

## Maintenance

- Update this file when you learn durable repo-specific context, commands, parser findings, or workflow constraints that would help future agents. Keep additions short and remove stale guidance.

## Commands

- Install: `pnpm install`
- Typecheck/lint/test: `pnpm run check`
- Format: `pnpm run format`
- Save Facebook session: `pnpm run auth`
- Run scraper: `pnpm run scrape`
- Run at most once per local calendar day: `pnpm run scrape:daily`
- Debug scraper: `pnpm run scrape:debug`
- Interactive debug scraper, pausing before scanning and every scroll: `pnpm run scrape:debug:steps`
- In interactive step mode, Enter advances and Escape stops the feed walk and proceeds to classification without the final browser-close prompt.
- Full page debug capture without parsing/OpenAI: `pnpm run snapshot:debug`
- Clean debug captures: `pnpm run clean:debug`

## Runtime Notes

- Manifest is `package.yaml`, not `package.json`.
- Uses ESM: `type: module` and TypeScript `NodeNext`.
- Runtime state is under `.data/` and should not be committed.
- `.data/state.json` combines reviewed post IDs and the last successful daily-run timestamp.
- New records in `.data/matches.jsonl` include an ISO `timestamp` field plus `checked: false` and `interest: false` flags for the user to toggle manually.
- `.env.example` is the single source of configuration defaults and setting-specific documentation; `src/config.ts` overlays `.env` and process values and should not duplicate fallback literals, while the README should only give high-level configuration guidance.
- The classifier matches either complete rigs with an included main in the configured size range or standalone container/harness systems compatible with `TARGET_CANOPY_SIZE`; uncertain canopy or harness fit is a possible match.
- The classifier feature is under `src/classifier/`: public API and OpenAI orchestration in `index.ts`, prompt registration/interpolation in `prompt.ts`, and named message-template pairs under `prompts/`.
- Headless runs use the explicit common landscape viewport configured by `HEADLESS_VIEWPORT_WIDTH` and `HEADLESS_VIEWPORT_HEIGHT`; headed/debug runs use `viewport: null` and follow native window resizing.
- Facebook auth is stored in `.data/facebook-storage-state.json`.
- The user LaunchAgent definition is `launchd/com.alexisgaziello.fb-crawler.plist`; it runs at login and hourly, while `.data/state.json` prevents more than one successful scrape per local day and permits retries after failures.
- Install or reload the user LaunchAgent with `launchd/install`; `RunAtLoad` triggers an execution immediately after bootstrap.
- `launchd/run` classifies combined per-execution logs under `.data/launchd/{no-op,success,error}/` by comparing crawler state before/after and checking the exit status; retention is 5/30/30 respectively.
- Debug runs are written to `.data/debug/<timestamp>/`.
- Each debug run contains clean final posts in `posts.json`, heavy parser diagnostics in `extraction.json`, the full `page/` capture, and `classifications/`.

## Parser Notes

- The Facebook feature is split under `src/facebook/`: public API in `index.ts`, Playwright orchestration in `scraper.ts`, self-contained browser DOM functions in `page.ts`, and Node-side normalization/deduplication in `parser.ts`. Browser functions cannot close over module helpers or contain nested function declarations because Playwright serialization omits the `tsx`-injected `__name` helper; use local object methods and keep `page.test.ts` as the runtime regression test.
- Facebook DOM is unstable. Do not assume `[role="article"]` means a feed post; it can also be comments or loading placeholders.
- A 2026-06-26 debug run showed real listing text in the page body while `[role="article"]` only captured a comment permalink plus loading placeholders; inspect `page/body.txt`, `page/visible-text-blocks.json`, and `extraction.json` before changing extraction.
- A later 2026-06-26 run showed Marketplace-style listings as visible `[role="feed"]` text blocks with zero `/posts/` anchors; `src/facebook/page.ts` has a `feed_text_block` fallback for that shape.
- The same run showed duplicate candidates for one item via `/commerce/listing/<id>` media URLs and `photo/?fbid=...&set=pcb.<id>` URLs. Preserve canonical URL/id handling for those shapes before adding new fallback parsing.
- Extracted posts must have a stable post, commerce-listing, or photo-set URL. Never fall back to an author profile or arbitrary anchor because notifications require an actionable post link.
- Facebook image/React artifacts can inject repeated `Facebook` tokens and long single-character alphanumeric runs into extracted text. Keep cleaning generic; do not add localized UI-copy filters.
- The scraper walks overlapping feed viewports and extracts each newly encountered post immediately; do not restore a batch scroll-then-parse flow because Facebook virtualizes older DOM nodes.
- `MAX_POSTS` limits new extracted posts, while `MAX_ALREADY_REVIEWED_POSTS` independently stops the walk after stable IDs from `.data/state.json` are encountered. `SCROLL_STEPS` is only a hard safety cap.
- At every feed position, visible truncated post bodies are expanded before extraction by detecting an ellipsis immediately before a feed button. Keep this structural and language-independent.
- Before walking the feed, the scraper finds the sort control using `FACEBOOK_SORT_TRIGGER_LABELS`, verifies the radio-menu shape, and uniquely matches New posts using `FACEBOOK_NEW_POSTS_LABELS`. Do not restore positional guessing or probe unrelated buttons.
- `extraction.json` includes raw candidate HTML and aggregate parser counters. Its raw counters are observations across overlapping viewport scans, not unique-post counts. Production runs do not collect raw HTML. Inspect `extraction.json` and the full `page/` capture before changing selectors.
- Do not add localized string skips such as specific `aria-label` prefixes. Prefer DOM evidence from debug captures and fixture tests.
- Do not add undocumented Facebook query params or magic URL knobs unless they are backed by captured evidence or a cited source.

## Safety

- Do not bypass Facebook login, CAPTCHA, checkpoint, or group permissions.
- If login/CAPTCHA/checkpoint is detected, abort and notify/log through the existing alert path.
- Prefer low-frequency, slow, session-reusing behavior.
- Keep interactions bounded and purposeful: do not probe unrelated controls, inject temporary marker attributes, spoof browser fingerprints, hide automation properties, or add stealth/CAPTCHA bypasses.
- Scroll distances are randomized within `SCROLL_DISTANCE_MIN_PX` and `SCROLL_DISTANCE_PX`; retain viewport overlap so posts are not skipped.

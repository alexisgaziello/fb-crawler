# Facebook Skydiving Gear Watcher

Daily local watcher for the Buy/Sell Skydiving Gear Facebook group. It opens the group with Playwright using your saved Facebook session, extracts recent post text, asks OpenAI to classify likely full-rig or compatible container/harness matches for a 6'3" buyer targeting a 170 main canopy, and sends notifications with post links.

This tool is intended for posts you are allowed to view with your own Facebook account. It does not bypass login, paywalls, CAPTCHAs, group permissions, or platform protections.

## Setup

```bash
pnpm install
pnpm exec playwright install chromium
cp .env.example .env
```

Edit `.env` and set at least `OPENAI_API_KEY`. Every setting and its behavior is documented inline in [`.env.example`](.env.example).

## Save Your Facebook Session

```bash
pnpm run auth
```

This opens a headed browser. Log in to Facebook and make sure you can view the group. Press Enter in the terminal after the group loads. The session is stored in `.data/facebook-storage-state.json`, which is git-ignored.

## Run Once

```bash
pnpm run scrape
```

For debugging browser extraction:

```bash
pnpm run scrape:headed
```

For step-by-step debug output with the browser left open before shutdown:

```bash
pnpm run scrape:debug
```

To pause before the initial scan and before every scroll:

```bash
pnpm run scrape:debug:steps
```

At each scroll prompt, press Enter to continue or Escape to stop scrolling and proceed directly to classification.

Debug mode writes one timestamped run folder under `.data/debug/`. A run contains:

- `page/`: full rendered page capture with `page.html`, `body.txt`, `links.json`, `visible-text-blocks.json`, `meta.json`, and `screenshot.png`.
- `posts.json`: only the final unique posts sent to classification.
- `extraction.json`: aggregate parser counters and raw candidate HTML for scraper development.
- `classifications/`: full OpenAI response payloads for each classified post.

The Facebook feature lives under `src/facebook/`: `scraper.ts` owns Playwright orchestration, `page.ts` contains typed browser-context DOM functions, `parser.ts` normalizes and deduplicates extracted candidates, and `index.ts` defines the public API.

The scraper processes overlapping feed positions in order. At each position it expands visible truncated bodies, extracts newly encountered posts immediately, then advances; this avoids losing earlier posts when Facebook virtualizes the feed DOM.
Before scanning, it opens Facebook's group-feed sort menu and selects the `New posts` radio option by its configured semantic label, not its menu position.

To capture the full rendered Facebook page without parsing posts or calling OpenAI:

```bash
pnpm run snapshot:debug
```

To remove debug captures without deleting scraper state:

```bash
pnpm run clean:debug
```

## Daily Schedule

The repository includes `launchd/com.alexisgaziello.fb-crawler.plist`. It starts at login and checks hourly while the user is logged in. The `scrape:daily` command records a successful run in `.data/state.json`, so only the first successful check each local calendar day performs a scrape. Failed runs remain eligible for the next hourly retry.

Install and load it:

```bash
mkdir -p ~/Library/LaunchAgents
cp launchd/com.alexisgaziello.fb-crawler.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.alexisgaziello.fb-crawler.plist
```

Inspect status and logs:

```bash
launchctl print gui/$(id -u)/com.alexisgaziello.fb-crawler
tail -f .data/launchd.stdout.log .data/launchd.stderr.log
```

Unload it with:

```bash
launchctl bootout gui/$(id -u)/com.alexisgaziello.fb-crawler
```

## Configuration

`.env.example` is the single source for configuration defaults and documentation. Copy it to `.env` for local overrides; process environment values take precedence. Configuration is validated at startup.

Runtime state lives in `.data/`:

- `facebook-storage-state.json`: your browser login state.
- `state.json`: reviewed post IDs and the timestamp of the last successful `scrape:daily` run. Legacy `reviewed-posts.json` and `daily-run.json` files are imported automatically when this file is first created.
- `debug/<timestamp>/`: per-run debug folder containing `page/`, `posts.json`, `extraction.json`, and `classifications/`.
- `matches.jsonl`: append-only history of matched posts.

## Automation Considerations

The crawler limits itself to one low-volume feed walk, reuses saved session state, pauses between actions, varies scroll distance, avoids probing unrelated controls, and stops after configured new/reviewed-post thresholds. It uses a common landscape viewport in headless mode and does not inject marker attributes into Facebook's DOM.

This does not make automation indistinguishable from a normal browser. Playwright and headless execution can still expose automation signals. The project intentionally does not spoof browser fingerprints, hide `navigator.webdriver`, or bypass login challenges, CAPTCHA, checkpoints, or permissions; those conditions abort the run and trigger the configured alert path.

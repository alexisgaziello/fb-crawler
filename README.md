# Facebook Skydiving Gear Watcher

Daily local watcher for the Buy/Sell Skydiving Gear Facebook group. It opens the group with Playwright using your saved Facebook session, extracts recent post text, asks OpenAI to classify likely full-rig matches for a 6'3" buyer targeting a 170 main canopy, and sends notifications with post links.

This tool is intended for posts you are allowed to view with your own Facebook account. It does not bypass login, paywalls, CAPTCHAs, group permissions, or platform protections.

## Setup

```bash
pnpm install
pnpm exec playwright install chromium
cp .env.example .env
```

Edit `.env` and set at least `OPENAI_API_KEY`. Add SMTP settings if you want email alerts.

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

Debug mode also writes the extracted post text and raw Facebook article HTML before any OpenAI classification. Each run gets a timestamped file under `.data/debug/posts/`, including page-level article/link summaries to help refine selectors. It also saves full OpenAI classification responses under `.data/debug/classifications/`.

To remove debug captures without deleting scraper state:

```bash
pnpm run clean:debug
```

## Daily Schedule

On macOS, add this to your crontab with `crontab -e` to run daily at 8:30 AM:

```cron
30 8 * * * cd /Users/alexisgaziello/local/fb-crawler && /opt/homebrew/bin/pnpm run scrape >> /Users/alexisgaziello/local/fb-crawler/.data/cron.log 2>&1
```

Adjust the `pnpm` path if `which pnpm` returns a different location.

## Configuration

Key settings:

- `LOG_LEVEL`: logger level. Defaults to `info`; `scrape:debug` sets this to `debug` for that run.
- `OPENAI_MODEL`: defaults to `gpt-5.4-mini`.
- `MAX_POSTS`: maximum Facebook post cards to inspect per run.
- `LOOKBACK_HOURS`: skip posts whose visible timestamp looks older than this.
- `ACTION_DELAY_MIN_MS`, `ACTION_DELAY_MAX_MS`: random delay range between browser actions.
- `REVIEWED_POST_LIMIT`: number of already-classified post IDs to keep locally. Defaults to `1000`.
- `MIN_CANOPY_SIZE`, `TARGET_CANOPY_SIZE`, `MAX_CANOPY_SIZE`: canopy matching window.
- `EMAIL_TO`: enables email when SMTP settings are present.
- `NOTIFY_DESKTOP=true`: enables a macOS desktop notification for matches.

State files live in `.data/`:

- `facebook-storage-state.json`: your browser login state.
- `reviewed-posts.json`: last reviewed post IDs, used to avoid repeat OpenAI calls.
- `debug/posts/`: timestamped debug scrape payloads, written only by debug mode.
- `debug/classifications/`: full OpenAI response payloads for each classified post in debug mode.
- `matches.jsonl`: append-only history of matched posts.

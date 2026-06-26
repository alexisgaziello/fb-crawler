# AGENTS.md

## Project

Local pnpm/TypeScript ESM CLI that checks a Facebook skydiving gear group, extracts recent posts, classifies them with OpenAI, and notifies the user about likely full-rig matches.

## Maintenance

- Update this file when you learn durable repo-specific context, commands, parser findings, or workflow constraints that would help future agents. Keep additions short and remove stale guidance.

## Commands

- Install: `pnpm install`
- Typecheck/lint/test: `pnpm run check`
- Format: `pnpm run format`
- Save Facebook session: `pnpm run auth`
- Run scraper: `pnpm run scrape`
- Debug scraper: `pnpm run scrape:debug`
- Clean debug captures: `pnpm run clean:debug`

## Runtime Notes

- Manifest is `package.yaml`, not `package.json`.
- Uses ESM: `type: module` and TypeScript `NodeNext`.
- Runtime state is under `.data/` and should not be committed.
- Facebook auth is stored in `.data/facebook-storage-state.json`.
- Debug extraction captures are written to `.data/debug/posts/<timestamp>.json`.
- Debug OpenAI responses are written to `.data/debug/classifications/<timestamp>-<postId>.json`.

## Parser Notes

- Facebook DOM is unstable. Do not assume `[role="article"]` means a feed post; it can also be comments or loading placeholders.
- A 2026-06-26 debug run showed real listing text in `bodyTextPreview` while `[role="article"]` only captured a comment permalink plus loading placeholders; inspect `containerSummaries` and `candidateTextBlocks` before changing extraction.
- Debug captures include raw article HTML and page summaries. Inspect those before changing selectors.
- Do not add localized string skips such as specific `aria-label` prefixes. Prefer DOM evidence from debug captures and fixture tests.

## Safety

- Do not bypass Facebook login, CAPTCHA, checkpoint, or group permissions.
- If login/CAPTCHA/checkpoint is detected, abort and notify/log through the existing alert path.
- Prefer low-frequency, slow, session-reusing behavior.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import nodemailer from "nodemailer";
import type { MatchedPost } from "./classifier/index.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

const execFileAsync = promisify(execFile);

export type ScraperAlert = {
  title: string;
  message: string;
  details?: string;
};

type NotificationMessage = {
  title: string;
  text: string;
  html: string;
  desktopMessage: string;
};

export async function notify(matches: MatchedPost[]) {
  if (matches.length === 0) return;

  logger.info({ matchCount: matches.length }, "Relevant posts found.");
  const text = formatPlainText(matches);
  logger.info(text);

  await deliverNotification({
    title: `Skydiving gear alert: ${matches.length} relevant post${matches.length === 1 ? "" : "s"}`,
    text,
    html: formatHtml(matches),
    desktopMessage: `${matches.length} relevant Facebook post${matches.length === 1 ? "" : "s"} found.`,
  });
}

export async function notifyAlert(alert: ScraperAlert) {
  const text = formatAlertText(alert);
  logger.error(text);

  const sent = await deliverNotification({
    title: alert.title,
    text,
    html: `<html><body><pre>${escapeHtml(text)}</pre></body></html>`,
    desktopMessage: alert.message,
  });
  if (!sent) {
    logger.warn("No alert notification channel configured; alert was logged only.");
  }
}

async function deliverNotification(message: NotificationMessage) {
  const sent = await Promise.all([sendEmail(message), sendDesktopNotification(message)]);
  return sent.some(Boolean);
}

async function sendEmail(message: NotificationMessage) {
  if (!config.SMTP_HOST || !config.EMAIL_TO) return false;

  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth:
      config.SMTP_USER && config.SMTP_PASS
        ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
        : undefined,
  });

  const from = config.EMAIL_FROM || config.SMTP_USER || "fb-crawler@localhost";
  await transporter.sendMail({
    from,
    to: config.EMAIL_TO,
    subject: message.title,
    text: message.text,
    html: message.html,
  });
  return true;
}

async function sendDesktopNotification(message: NotificationMessage) {
  if (!config.NOTIFY_DESKTOP || process.platform !== "darwin") return false;

  try {
    await execFileAsync("osascript", [
      "-e",
      `display notification ${JSON.stringify(message.desktopMessage)} with title ${JSON.stringify(message.title)}`,
    ]);
    return true;
  } catch (error) {
    logger.warn({ err: error }, "Desktop notification failed.");
    return false;
  }
}

function formatPlainText(matches: MatchedPost[]) {
  return matches
    .map((match, index) => {
      const c = match.classification;
      return [
        `#${index + 1} ${c.category} (${Math.round(c.confidence * 100)}%)`,
        c.actionSummary,
        c.reason,
        `Matched: ${match.timestamp}`,
        match.author ? `Author: ${match.author}` : undefined,
        match.timestampText ? `Timestamp: ${match.timestampText}` : undefined,
        `URL: ${match.url}`,
        `Extracted: ${JSON.stringify(c.extracted)}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
}

function formatHtml(matches: MatchedPost[]) {
  const items = matches
    .map((match) => {
      const c = match.classification;
      return [
        `<h2>${escapeHtml(c.category)} (${Math.round(c.confidence * 100)}%)</h2>`,
        `<p><strong>${escapeHtml(c.actionSummary)}</strong></p>`,
        `<p>${escapeHtml(c.reason)}</p>`,
        `<p>Matched: ${escapeHtml(match.timestamp)}</p>`,
        match.author ? `<p>Author: ${escapeHtml(match.author)}</p>` : "",
        match.timestampText ? `<p>Timestamp: ${escapeHtml(match.timestampText)}</p>` : "",
        `<p><a href="${escapeHtml(match.url)}">Open Facebook post</a></p>`,
        `<pre>${escapeHtml(JSON.stringify(c.extracted, null, 2))}</pre>`,
      ].join("\n");
    })
    .join("<hr />");

  return `<html><body>${items}</body></html>`;
}

function formatAlertText(alert: ScraperAlert) {
  return [alert.title, alert.message, alert.details].filter(Boolean).join("\n\n");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

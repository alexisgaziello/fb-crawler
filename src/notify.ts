import { execFile } from "node:child_process";
import { promisify } from "node:util";
import nodemailer from "nodemailer";
import type { ClassifiedPost } from "./classifier.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

const execFileAsync = promisify(execFile);

export type ScraperAlert = {
  title: string;
  message: string;
  details?: string;
};

export async function notify(matches: ClassifiedPost[]) {
  if (matches.length === 0) return;

  logger.info({ matchCount: matches.length }, "Relevant posts found.");
  logger.info(formatPlainText(matches));

  await Promise.all([sendEmail(matches), sendDesktopNotification(matches)]);
}

export async function notifyAlert(alert: ScraperAlert) {
  const text = formatAlertText(alert);
  logger.error(text);

  const sent = await Promise.all([sendAlertEmail(alert), sendAlertDesktopNotification(alert)]);
  if (!sent.some(Boolean)) {
    logger.warn("No alert notification channel configured; alert was logged only.");
  }
}

async function sendEmail(matches: ClassifiedPost[]) {
  if (!config.SMTP_HOST || !config.EMAIL_TO) return;

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
    subject: `Skydiving gear alert: ${matches.length} relevant post${matches.length === 1 ? "" : "s"}`,
    text: formatPlainText(matches),
    html: formatHtml(matches),
  });
}

async function sendAlertEmail(alert: ScraperAlert) {
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
    subject: alert.title,
    text: formatAlertText(alert),
    html: `<html><body><pre>${escapeHtml(formatAlertText(alert))}</pre></body></html>`,
  });
  return true;
}

async function sendDesktopNotification(matches: ClassifiedPost[]) {
  if (!config.NOTIFY_DESKTOP || process.platform !== "darwin") return;

  const title = "Skydiving gear alert";
  const message = `${matches.length} relevant Facebook post${matches.length === 1 ? "" : "s"} found.`;
  await execFileAsync("osascript", [
    "-e",
    `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`,
  ]).catch((error) => {
    logger.warn({ err: error }, "Desktop notification failed.");
  });
}

async function sendAlertDesktopNotification(alert: ScraperAlert) {
  if (!config.NOTIFY_DESKTOP || process.platform !== "darwin") return false;

  await execFileAsync("osascript", [
    "-e",
    `display notification ${JSON.stringify(alert.message)} with title ${JSON.stringify(alert.title)}`,
  ]).catch((error) => {
    logger.warn({ err: error }, "Desktop alert notification failed.");
  });
  return true;
}

function formatPlainText(matches: ClassifiedPost[]) {
  return matches
    .map((match, index) => {
      const c = match.classification;
      return [
        `#${index + 1} ${c.category} (${Math.round(c.confidence * 100)}%)`,
        c.actionSummary,
        c.reason,
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

function formatHtml(matches: ClassifiedPost[]) {
  const items = matches
    .map((match) => {
      const c = match.classification;
      return [
        `<h2>${escapeHtml(c.category)} (${Math.round(c.confidence * 100)}%)</h2>`,
        `<p><strong>${escapeHtml(c.actionSummary)}</strong></p>`,
        `<p>${escapeHtml(c.reason)}</p>`,
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

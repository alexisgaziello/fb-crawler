import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { z } from "zod";

const numberFromEnv = z.coerce.number().finite();
const positiveIntegerFromEnv = z.coerce.number().int().positive();

const booleanFromEnv = z
  .preprocess(
    (value) => (typeof value === "string" ? value.toLowerCase() : value),
    z.enum(["1", "true", "yes", "on", "0", "false", "no", "off"]),
  )
  .transform((value) => ["1", "true", "yes", "on"].includes(value));

const envSchema = z.object({
  OPENAI_API_KEY: z.string(),
  OPENAI_MODEL: z.string().min(1),
  FACEBOOK_GROUP_URL: z.union([z.literal(""), z.string().url()]),
  FACEBOOK_SORT_TRIGGER_LABELS: z.string().min(1),
  FACEBOOK_NEW_POSTS_LABELS: z.string().min(1),
  LOG_LEVEL: z.string().min(1),
  HEADLESS: booleanFromEnv,
  HEADLESS_VIEWPORT_WIDTH: positiveIntegerFromEnv,
  HEADLESS_VIEWPORT_HEIGHT: positiveIntegerFromEnv,
  MAX_POSTS: numberFromEnv,
  LOOKBACK_HOURS: numberFromEnv,
  SLOW_MO_MS: numberFromEnv,
  ACTION_DELAY_MIN_MS: numberFromEnv,
  ACTION_DELAY_MAX_MS: numberFromEnv,
  SCROLL_STEPS: numberFromEnv,
  SCROLL_DISTANCE_MIN_PX: positiveIntegerFromEnv,
  SCROLL_DISTANCE_PX: positiveIntegerFromEnv,
  MAX_ALREADY_REVIEWED_POSTS: numberFromEnv,
  ANALYZED_POSTS_CACHE_LIMIT: numberFromEnv,
  BUYER_HEIGHT_FEET: numberFromEnv,
  BUYER_HEIGHT_INCHES: numberFromEnv,
  MIN_HARNESS_HEIGHT_CM: numberFromEnv,
  TARGET_CANOPY_SIZE: numberFromEnv,
  MIN_CANOPY_SIZE: numberFromEnv,
  MAX_CANOPY_SIZE: numberFromEnv,
  SMTP_HOST: z.string(),
  SMTP_PORT: numberFromEnv,
  SMTP_SECURE: booleanFromEnv,
  SMTP_USER: z.string(),
  SMTP_PASS: z.string(),
  EMAIL_FROM: z.string(),
  EMAIL_TO: z.string(),
  NOTIFY_DESKTOP: booleanFromEnv,
});

export const projectRoot = process.cwd();
export const dataDir = path.join(projectRoot, ".data");

const exampleEnvPath = path.join(projectRoot, ".env.example");
const defaultEnv = parse(fs.readFileSync(exampleEnvPath));
const env = envSchema.parse({ ...defaultEnv, ...process.env });

const buyerHeightInches = env.BUYER_HEIGHT_FEET * 12 + env.BUYER_HEIGHT_INCHES;
const buyerHeightCm = inchesToCm(buyerHeightInches);
// A harness whose stated fit range tops out below this height is rejected outright.
const minHarnessMaxHeightCm = env.MIN_HARNESS_HEIGHT_CM;
const minHarnessMaxHeightInches = cmToInches(minHarnessMaxHeightCm);

export const config = {
  ...env,
  buyerHeightInches,
  buyerHeightCm,
  minHarnessMaxHeightCm,
  minHarnessMaxHeightInches,
  harnessHeightToleranceCm: buyerHeightCm - minHarnessMaxHeightCm,
  harnessHeightToleranceInches: buyerHeightInches - minHarnessMaxHeightInches,
  storageStatePath: path.join(dataDir, "facebook-storage-state.json"),
  statePath: path.join(dataDir, "state.json"),
  debugDir: path.join(dataDir, "debug"),
  matchesPath: path.join(dataDir, "matches.jsonl"),
};

function inchesToCm(inches: number) {
  return Math.round(inches * 2.54);
}

function cmToInches(cm: number) {
  return Math.round(cm / 2.54);
}

export function requireOpenAIKey() {
  if (!config.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required. Add it to .env.");
  }
}

export function requireFacebookGroupUrl() {
  if (!config.FACEBOOK_GROUP_URL) {
    throw new Error("FACEBOOK_GROUP_URL is required. Add it to .env.");
  }
}

import "dotenv/config";
import path from "node:path";
import { z } from "zod";

const numberFromEnv = (fallback: number) => z.coerce.number().finite().catch(fallback);

const booleanFromEnv = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value == null || value === "") return fallback;
      return ["1", "true", "yes", "on"].includes(value.toLowerCase());
    });

const envSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5.4-mini"),
  FACEBOOK_GROUP_URL: z.string().url().default("https://www.facebook.com/groups/416383335109560"),
  HEADLESS: booleanFromEnv(true),
  MAX_POSTS: numberFromEnv(25),
  LOOKBACK_HOURS: numberFromEnv(48),
  SLOW_MO_MS: numberFromEnv(0),
  ACTION_DELAY_MIN_MS: numberFromEnv(350),
  ACTION_DELAY_MAX_MS: numberFromEnv(1_600),
  REVIEWED_POST_LIMIT: numberFromEnv(1_000),
  BUYER_HEIGHT_FEET: numberFromEnv(6),
  BUYER_HEIGHT_INCHES: numberFromEnv(3),
  TARGET_CANOPY_SIZE: numberFromEnv(170),
  MIN_CANOPY_SIZE: numberFromEnv(160),
  MAX_CANOPY_SIZE: numberFromEnv(180),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: numberFromEnv(587),
  SMTP_SECURE: booleanFromEnv(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  EMAIL_TO: z.string().optional(),
  NOTIFY_DESKTOP: booleanFromEnv(false),
});

const env = envSchema.parse(process.env);

export const projectRoot = process.cwd();
export const dataDir = path.join(projectRoot, ".data");

export const config = {
  ...env,
  buyerHeightInches: env.BUYER_HEIGHT_FEET * 12 + env.BUYER_HEIGHT_INCHES,
  storageStatePath: path.join(dataDir, "facebook-storage-state.json"),
  reviewedPostsPath: path.join(dataDir, "reviewed-posts.json"),
  debugDir: path.join(dataDir, "debug"),
  debugPostsDir: path.join(dataDir, "debug", "posts"),
  debugClassificationsDir: path.join(dataDir, "debug", "classifications"),
  matchesPath: path.join(dataDir, "matches.jsonl"),
};

export function requireOpenAIKey() {
  if (!config.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required. Add it to .env.");
  }
}

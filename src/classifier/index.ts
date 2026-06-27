import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { config, requireOpenAIKey } from "../config.js";
import type { ScrapedPost } from "../facebook/index.js";
import { logger } from "../logger.js";
import type { DebugRun } from "../state.js";
import {
  buildClassifierPrompt,
  type ClassifierPromptName,
  DEFAULT_CLASSIFIER_PROMPT,
} from "./prompt.js";

export type { ClassifierPromptName } from "./prompt.js";

export type ClassifyOptions = {
  debugRun?: DebugRun;
  promptName?: ClassifierPromptName;
};

const nullableText = z.string().min(1).nullable();
const nullableCanopySize = z.number().int().min(50).max(400).nullable();

const classificationSchema = z
  .object({
    confidence: z.number().min(0).max(1),
    category: z.enum(["strong_match", "possible_match", "not_relevant"]),
    reason: z.string().min(1),
    extracted: z
      .object({
        itemType: z.enum([
          "full_rig",
          "canopy_only",
          "container_only",
          "aad_only",
          "accessory",
          "wtb",
          "other",
          "unknown",
        ]),
        mainCanopySize: nullableCanopySize,
        reserveCanopySize: nullableCanopySize,
        containerSize: nullableText,
        containerFit: nullableText,
        targetMainCompatibility: z.enum(["compatible", "possible", "incompatible", "unknown"]),
        sellerLocation: nullableText,
        askingPrice: nullableText,
      })
      .strict(),
    actionSummary: z.string().min(1),
  })
  .strict();

export type Classification = z.infer<typeof classificationSchema>;

export type ClassifiedPost = ScrapedPost & {
  classification: Classification;
};

export async function classifyPost(
  post: ScrapedPost,
  options: ClassifyOptions = {},
): Promise<Classification> {
  requireOpenAIKey();
  const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  const prompt = buildClassifierPrompt(options.promptName ?? DEFAULT_CLASSIFIER_PROMPT, post);

  const response = await openai.responses.parse({
    model: config.OPENAI_MODEL,
    reasoning: { effort: "low" },
    input: [
      {
        role: "developer",
        content: prompt.developer,
      },
      {
        role: "user",
        content: prompt.user,
      },
    ],
    text: {
      format: zodTextFormat(classificationSchema, "gear_post_classification"),
    },
  });

  if (options.debugRun) {
    await writeDebugClassificationResponse(post, response, options.debugRun);
    logger.debug({ postId: post.id, response }, "OpenAI classification full response.");
  }

  if (!response.output_parsed) {
    throw new Error(`OpenAI returned no parsed classification for ${post.id}`);
  }

  return response.output_parsed;
}

async function writeDebugClassificationResponse(
  post: ScrapedPost,
  response: unknown,
  debugRun: DebugRun,
) {
  const classificationsDir = debugRun.classificationsDir;
  await fs.mkdir(classificationsDir, { recursive: true });
  const savedAt = new Date().toISOString();
  const timestamp = savedAt.replaceAll(":", "-").replaceAll(".", "-");
  const safePostId = post.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const snapshotPath = path.join(classificationsDir, `${timestamp}-${safePostId}.json`);

  await fs.writeFile(
    snapshotPath,
    JSON.stringify(
      {
        savedAt,
        post: {
          id: post.id,
          url: post.url,
          author: post.author,
          timestampText: post.timestampText,
          text: post.text,
        },
        response,
      },
      null,
      2,
    ),
  );
  logger.info({ postId: post.id, snapshotPath }, "Saved debug OpenAI classification response.");
}

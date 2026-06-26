import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { config, requireOpenAIKey } from "./config.js";
import type { ScrapedPost } from "./facebook.js";
import { logger } from "./logger.js";

export type Classification = {
  relevant: boolean;
  confidence: number;
  category: "strong_match" | "possible_match" | "not_relevant";
  reason: string;
  extracted: {
    itemType:
      | "full_rig"
      | "canopy_only"
      | "container_only"
      | "aad_only"
      | "accessory"
      | "wtb"
      | "other"
      | "unknown";
    isFullRig: boolean | null;
    mainCanopySize: number | null;
    reserveCanopySize: number | null;
    containerSize: string | null;
    containerFit: string | null;
    sellerLocation: string | null;
    askingPrice: string | null;
  };
  actionSummary: string;
};

export type ClassifiedPost = ScrapedPost & {
  classification: Classification;
};

type ClassifyOptions = {
  debug?: boolean;
};

const nullableText = z.string().min(1).nullable();
const nullableCanopySize = z.number().int().min(50).max(400).nullable();

const classificationSchema = z
  .object({
    relevant: z.boolean(),
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
        isFullRig: z.boolean().nullable(),
        mainCanopySize: nullableCanopySize,
        reserveCanopySize: nullableCanopySize,
        containerSize: nullableText,
        containerFit: nullableText,
        sellerLocation: nullableText,
        askingPrice: nullableText,
      })
      .strict(),
    actionSummary: z.string().min(1),
  })
  .strict();

export async function classifyPost(
  post: ScrapedPost,
  options: ClassifyOptions = {},
): Promise<Classification> {
  requireOpenAIKey();
  const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  const response = await openai.responses.parse({
    model: config.OPENAI_MODEL,
    reasoning: { effort: "low" },
    input: [
      {
        role: "developer",
        content: [
          "You classify Facebook marketplace-style skydiving gear posts for a buyer.",
          "The buyer wants a complete/full rig, not isolated accessories unless it is clearly part of a full rig.",
          `Buyer height: ${config.BUYER_HEIGHT_FEET}'${config.BUYER_HEIGHT_INCHES}" (${config.buyerHeightInches} inches).`,
          `Ideal main canopy: ${config.TARGET_CANOPY_SIZE}; acceptable range: ${config.MIN_CANOPY_SIZE}-${config.MAX_CANOPY_SIZE}.`,
          "A strong match clearly offers a complete rig with a main in range and container/harness details likely suitable for a tall person.",
          "A possible match has a complete rig and either canopy size or fit is uncertain, or it is close enough to investigate.",
          "Mark not_relevant for WTB posts, sold posts, canopies only, containers only, aad only, helmets, suits, reserves only, rentals, spam, or clearly incompatible rigs.",
          "Be practical: tall-fitting rigs are rare, so do not reject solely because the seller does not state height.",
          "Return every field in the schema. Use null when the post does not state a value.",
          "For itemType, choose the closest enum value. Use unknown only when the post text is too ambiguous to classify.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Post URL: ${post.url}`,
          post.author ? `Author: ${post.author}` : undefined,
          post.timestampText ? `Timestamp: ${post.timestampText}` : undefined,
          "Raw post text:",
          post.text,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    text: {
      format: zodTextFormat(classificationSchema, "gear_post_classification"),
    },
  });

  if (options.debug) {
    await writeDebugClassificationResponse(post, response);
    logger.debug({ postId: post.id, response }, "OpenAI classification full response.");
  }

  if (!response.output_parsed) {
    throw new Error(`OpenAI returned no parsed classification for ${post.id}`);
  }

  return response.output_parsed;
}

async function writeDebugClassificationResponse(post: ScrapedPost, response: unknown) {
  await fs.mkdir(config.debugClassificationsDir, { recursive: true });
  const savedAt = new Date().toISOString();
  const timestamp = savedAt.replaceAll(":", "-").replaceAll(".", "-");
  const safePostId = post.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const snapshotPath = path.join(config.debugClassificationsDir, `${timestamp}-${safePostId}.json`);

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

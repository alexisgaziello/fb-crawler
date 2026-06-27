import { readFileSync } from "node:fs";
import path from "node:path";
import { config, projectRoot } from "../config.js";

const classifierPromptTemplates = {
  "rig-or-container": {
    developer: readPromptTemplate("rig-or-container.developer.txt"),
    user: readPromptTemplate("facebook-post.user.txt"),
  },
} as const;

export type ClassifierPromptName = keyof typeof classifierPromptTemplates;

export const DEFAULT_CLASSIFIER_PROMPT: ClassifierPromptName = "rig-or-container";

type PromptPost = {
  url: string;
  author?: string;
  timestampText?: string;
  text: string;
};

type PromptValue = string | number;

export function buildClassifierPrompt(name: ClassifierPromptName, post: PromptPost) {
  const templates = classifierPromptTemplates[name];
  const developer = renderPromptTemplate(templates.developer, {
    BUYER_HEIGHT_FEET: config.BUYER_HEIGHT_FEET,
    BUYER_HEIGHT_INCHES: config.BUYER_HEIGHT_INCHES,
    BUYER_HEIGHT_TOTAL_INCHES: config.buyerHeightInches,
    MAX_CANOPY_SIZE: config.MAX_CANOPY_SIZE,
    MIN_CANOPY_SIZE: config.MIN_CANOPY_SIZE,
    TARGET_CANOPY_SIZE: config.TARGET_CANOPY_SIZE,
  });
  const user = renderPromptTemplate(templates.user, {
    POST_AUTHOR: post.author ?? "",
    POST_TEXT: post.text,
    POST_TIMESTAMP: post.timestampText ?? "",
    POST_URL: post.url,
  });

  return { developer, user };
}

export function renderPromptTemplate(template: string, values: Record<string, PromptValue>) {
  return template.replaceAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (_placeholder, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`Missing classifier prompt template value: ${name}`);
    }
    return String(value);
  });
}

function readPromptTemplate(filename: string) {
  return readFileSync(path.join(projectRoot, "prompts", filename), "utf8").trim();
}

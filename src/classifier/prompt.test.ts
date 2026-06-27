import { describe, expect, it } from "vitest";
import { config } from "../config.js";
import {
  buildClassifierPrompt,
  DEFAULT_CLASSIFIER_PROMPT,
  renderPromptTemplate,
} from "./prompt.js";

const post = {
  url: "https://www.facebook.com/groups/example/posts/123",
  author: "Example Seller",
  timestampText: "2h",
  text: "Vector container for sale",
};

describe("buildClassifierPrompt", () => {
  it("renders the named developer template with buyer preferences", () => {
    const { developer } = buildClassifierPrompt(DEFAULT_CLASSIFIER_PROMPT, post);

    expect(developer).toContain(
      `Target main canopy: ${config.TARGET_CANOPY_SIZE}; acceptable included-main range for full rigs: ${config.MIN_CANOPY_SIZE}-${config.MAX_CANOPY_SIZE}.`,
    );
    expect(developer).toContain(
      `standalone container/harness is also a strong match when it clearly accepts a ${config.TARGET_CANOPY_SIZE} main`,
    );
    expect(developer).not.toContain("containers only");
  });

  it("renders post data through the user template", () => {
    const { user } = buildClassifierPrompt(DEFAULT_CLASSIFIER_PROMPT, post);

    expect(user).toContain(`Post URL: ${post.url}`);
    expect(user).toContain(`Author: ${post.author}`);
    expect(user).toContain(`Timestamp: ${post.timestampText}`);
    expect(user).toContain(post.text);
  });

  it("fails when a template value is missing", () => {
    expect(() => renderPromptTemplate("Target: {{TARGET}}", {})).toThrow(
      "Missing classifier prompt template value: TARGET",
    );
  });
});

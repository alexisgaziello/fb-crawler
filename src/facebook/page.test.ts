import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import {
  captureFullPageDataInPage,
  extractRawPostsInPage,
  findButtonByLabelsInPage,
  findVisibleTruncatedButtonInPage,
  readBodyTextInPage,
  readFacebookAccessStateInPage,
  readPageMetricsInPage,
} from "./page.js";

const execFileAsync = promisify(execFile);

describe("Facebook page functions", () => {
  it("remain self-contained after tsx transforms them", async () => {
    const script = `
      import * as pageFunctions from "./src/facebook/page.ts";
      const invalid = Object.entries(pageFunctions)
        .filter(([, value]) => typeof value === "function" && value.toString().includes("__name"))
        .map(([name]) => name);
      console.log(JSON.stringify(invalid));
    `;
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      { cwd: process.cwd() },
    );

    expect(stdout.trim()).toBe("[]");
  });

  it("serialize through Playwright and inspect a representative feed", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.setContent(`
        <main role="main">
          <button role="button"><span>Más pertinentes</span></button>
          <div role="feed">
            <div>
              <a href="https://www.facebook.com/commerce/listing/123456789/">
                Mirage complete rig with Sabre 170 main, reserve, and AAD.
              </a>
              <span>Great condition. Located in Florida. $3500.</span>
            </div>
            <div>
              Additional listing details are intentionally truncated... 
              <button role="button">Ver más</button>
            </div>
          </div>
        </main>
      `);

      const sortHandle = await page.waitForFunction(findButtonByLabelsInPage, ["Más pertinentes"]);
      expect(sortHandle.asElement()).not.toBeNull();
      await sortHandle.dispose();

      const truncatedHandle = await page.evaluateHandle(findVisibleTruncatedButtonInPage);
      expect(truncatedHandle.asElement()).not.toBeNull();
      await truncatedHandle.dispose();

      const [metrics, access, rawPosts, debugRawPosts, fullPageData, bodyText] = await Promise.all([
        page.evaluate(readPageMetricsInPage),
        page.evaluate(readFacebookAccessStateInPage),
        page.evaluate(extractRawPostsInPage, {
          groupId: "416383335109560",
          includeHtml: false,
          maxPosts: 5,
        }),
        page.evaluate(extractRawPostsInPage, {
          groupId: "416383335109560",
          includeHtml: true,
          maxPosts: 5,
        }),
        page.evaluate(captureFullPageDataInPage),
        page.evaluate(readBodyTextInPage),
      ]);

      expect(metrics.viewportHeight).toBe(900);
      expect(access).toMatchObject({ hasCaptcha: false, hasLogin: false });
      expect(rawPosts.some((post) => post.href.includes("/commerce/listing/123456789/"))).toBe(
        true,
      );
      expect(rawPosts.every((post) => post.html === undefined)).toBe(true);
      expect(debugRawPosts.some((post) => post.html?.includes("Mirage complete rig"))).toBe(true);
      expect(fullPageData.counts).toMatchObject({ roleMain: 1, roleFeed: 1 });
      expect(bodyText).toContain("Mirage complete rig");
    } finally {
      await browser.close();
    }
  });
});

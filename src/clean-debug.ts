import fs from "node:fs/promises";
import { config } from "./config.js";
import { logger } from "./logger.js";

async function main() {
  await fs.rm(config.debugDir, { recursive: true, force: true });
  logger.info({ debugDir: config.debugDir }, "Cleaned debug data.");
}

main().catch((error) => {
  logger.error({ err: error }, "Failed to clean debug data.");
  process.exitCode = 1;
});

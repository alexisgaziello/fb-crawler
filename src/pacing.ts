import { config } from "./config.js";

export function randomDelayMs(
  minMs = config.ACTION_DELAY_MIN_MS,
  maxMs = config.ACTION_DELAY_MAX_MS,
  random = Math.random,
) {
  const min = Math.max(0, Math.floor(minMs));
  const max = Math.max(min, Math.floor(maxMs));
  return min + Math.floor(random() * (max - min + 1));
}

export async function pauseWithJitter() {
  const delayMs = randomDelayMs();
  if (delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

import { noteFailure } from './failures.js';

export async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runner = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const safeProgress =
  (progress) =>
  (...a) => {
    try {
      progress && progress(...a);
    } catch (e) {
      noteFailure('非同期処理', '進捗コールバック', e);
    }
  };

const UINT32_MAX = 0x100000000;

function normalizeSeed(seed) {
  const parsed = Number(seed);
  if (!Number.isInteger(parsed)) return 1;
  const normalized = parsed >>> 0;
  return normalized === 0 ? 1 : normalized;
}

export function createSeededRng(seed) {
  let state = normalizeSeed(seed);
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / UINT32_MAX;
  };
}

export function weightedChoice(items, rng) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const totalWeight = items.reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 0), 0);
  if (totalWeight <= 0) return items[0] ?? null;
  const roll = (typeof rng === "function" ? rng() : Math.random()) * totalWeight;
  let cumulative = 0;
  for (const item of items) {
    cumulative += Math.max(0, Number(item.weight) || 0);
    if (roll <= cumulative) return item;
  }
  return items[items.length - 1] ?? null;
}

export function nextSeed(seed) {
  const normalized = normalizeSeed(seed);
  return (normalized * 1664525 + 1013904223) >>> 0;
}

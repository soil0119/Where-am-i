export function boundedInteger(value, fallback, { min, max }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;

  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

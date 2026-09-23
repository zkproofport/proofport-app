/** A local receipt of reviewed conditions, never the authentication material. */
export interface HistoryReviewSnapshot {
  version: 1;
  inputs: Record<string, unknown>;
  action?: unknown;
}

export const HISTORY_REVIEW_LIMIT = 131072;
const CONDITION_FIELDS = [
  'scope', 'scopeString', 'domain', 'provider', 'countryList', 'isIncluded',
  'discloseFlags', 'ageThreshold', 'currentYear', 'targetRegion', 'userAddress',
] as const;

export function captureHistoryReview(inputs: unknown): HistoryReviewSnapshot | undefined {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return undefined;
  try {
    const source = inputs as Record<string, unknown>;
    const selected = Object.fromEntries(CONDITION_FIELDS
      .filter(key => Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined)
      .map(key => [key, source[key]]));
    const snapshot: HistoryReviewSnapshot = {version: 1, inputs: selected};
    if (Object.prototype.hasOwnProperty.call(source, 'action') && source.action !== undefined) snapshot.action = source.action;
    const ancestors = new Set<object>();
    let nodes = 0;
    function check(value: unknown, depth: number): boolean {
      if (++nodes > 4096 || depth > 32) return false;
      if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
      if (typeof value === 'number') return Number.isFinite(value);
      if (typeof value !== 'object') return false;
      if (ancestors.has(value)) return false;
      const prototype = Object.getPrototypeOf(value);
      if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
      ancestors.add(value);
      const valid = Object.values(value).every(child => check(child, depth + 1));
      ancestors.delete(value);
      return valid;
    }
    if (!check(snapshot, 0)) return undefined;
    const json = JSON.stringify(snapshot);
    if (json.length > HISTORY_REVIEW_LIMIT) return undefined;
    return JSON.parse(json) as HistoryReviewSnapshot;
  } catch {
    // An unavailable optional receipt must not prevent a valid proof.
    return undefined;
  }
}

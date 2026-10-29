/**
 * Minimum supported version ("force update").
 *
 * At launch, and again on returning to the foreground once the cached answer
 * is older than MIN_VERSION_TTL_MS, the app reads `app-config/min-version.json`
 * from the public zkproofport/proofport-app repository and compares its own
 * marketing version with the minimum for its platform. Lower -> a blocking
 * "update required" screen with a store button. Equal or higher -> continue.
 *
 * WHEN THE FILE CANNOT BE READ, THE APP IS ALLOWED, using the last minimum it
 * did read (cached on the device). Reasons, in order of weight:
 *  - The file lives on raw.githubusercontent.com. Blocking on an unreachable
 *    file would turn a GitHub outage, a captive portal, or a phone with no
 *    signal into "nobody can open the app" — far worse than an old version
 *    running a few more hours.
 *  - A cached minimum that blocks STILL blocks. Once a version has been told
 *    it is retired, going offline does not un-retire it.
 *  - A file that is reachable but malformed (bad JSON, unknown schema, a
 *    version string we cannot parse, a store link to a host that is not the
 *    store) is treated exactly like an unreachable one. A typo in a file we
 *    publish must never lock every user out; the cached answer stands.
 *  - A running version the app cannot parse (no native version) is ALLOWED and
 *    logged. That is a defect in our own build, and blocking on it would make
 *    the update screen unreachable to fix.
 *
 * The answer that was READ always wins over the cache, including when it is
 * lower: lowering the minimum is how a mistaken raise is undone.
 *
 * Raising the minimum: `.claude/agents/app-dev.md`, "Force update".
 */

/** The ONE place the file is read from. Pinned by forceUpdateContract.test.ts. */
export const MIN_VERSION_URL =
  'https://raw.githubusercontent.com/zkproofport/proofport-app/main/app-config/min-version.json';

export const MIN_VERSION_SCHEMA = 1;
export const MIN_VERSION_FETCH_TIMEOUT_MS = 5000;
/** How long a successfully read answer is trusted before a foreground re-check. */
export const MIN_VERSION_TTL_MS = 60 * 60 * 1000;
/** The file is a few hundred bytes; anything far larger is not ours. */
export const MIN_VERSION_MAX_BYTES = 16 * 1024;
export const MIN_VERSION_MAX_MESSAGE_CHARS = 500;
export const MIN_VERSION_CACHE_KEY = '@zkproofport:minVersion:v1';

export type UpdatePlatform = 'ios' | 'android';

/**
 * Which hosts a store link may point at, per platform. The link is opened
 * outside the app, so a file that named any other host would be a way to send
 * every user to a page of the author's choosing.
 */
const STORE_HOSTS: Record<UpdatePlatform, ReadonlyArray<string>> = {
  ios: ['apps.apple.com'],
  android: ['play.google.com'],
};

export function updatePlatformOf(os: string): UpdatePlatform {
  if (!Object.prototype.hasOwnProperty.call(STORE_HOSTS, os)) {
    throw new Error(`Unknown platform '${os}' for the minimum-version check. Known: ${Object.keys(STORE_HOSTS).join(', ')}.`);
  }
  return os as UpdatePlatform;
}

// --------------------------------------------------------------------------
// Versions
// --------------------------------------------------------------------------

export type Version = readonly [number, number, number];

/** Up to 6 digits per part, no leading zeros, nothing around it. */
const VERSION_SHAPE = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

/** Strict MAJOR.MINOR.PATCH. Anything else ("1.4", "v1.4.0", " 1.4.0", "1.4.0-beta") is null. */
export function parseVersion(value: unknown): Version | null {
  if (typeof value !== 'string') return null;
  const m = VERSION_SHAPE.exec(value);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Numeric, part by part: 1.10.0 is newer than 1.9.9. */
export function compareVersions(a: Version, b: Version): -1 | 0 | 1 {
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

// --------------------------------------------------------------------------
// The file
// --------------------------------------------------------------------------

export interface UpdateMessage {
  ko?: string;
  en?: string;
}

/** One platform's row, after validation. */
export interface MinVersionRule {
  platform: UpdatePlatform;
  minimum: string;
  storeUrl: string;
  message: UpdateMessage;
}

export type ParseResult = {ok: true; rule: MinVersionRule} | {ok: false; reason: string};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAllowedStoreUrl(platform: UpdatePlatform, value: unknown): value is string {
  if (typeof value !== 'string') return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.port === '' && url.username === '' &&
    url.password === '' && STORE_HOSTS[platform].includes(url.hostname);
}

/** Message text is display-only: a wrong or missing one falls back to the app's own words. */
function readMessage(value: unknown): UpdateMessage {
  if (!isRecord(value)) return {};
  const out: UpdateMessage = {};
  for (const language of ['ko', 'en'] as const) {
    const text = value[language];
    if (typeof text === 'string' && text.trim() !== '' && text.length <= MIN_VERSION_MAX_MESSAGE_CHARS) {
      out[language] = text;
    }
  }
  return out;
}

/** Validates the file's text for one platform. Never throws. */
export function parseMinVersionFile(text: string, platform: UpdatePlatform): ParseResult {
  if (text.length > MIN_VERSION_MAX_BYTES) {
    return {ok: false, reason: `file is ${text.length} characters, over the ${MIN_VERSION_MAX_BYTES} cap`};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {ok: false, reason: `not JSON: ${(error as Error).message}`};
  }
  if (!isRecord(parsed)) return {ok: false, reason: 'top level is not an object'};
  if (parsed.schema !== MIN_VERSION_SCHEMA) {
    return {ok: false, reason: `schema ${JSON.stringify(parsed.schema)} is not ${MIN_VERSION_SCHEMA}`};
  }
  const row = parsed[platform];
  if (!isRecord(row)) return {ok: false, reason: `no '${platform}' entry`};
  if (!parseVersion(row.minimum)) {
    return {ok: false, reason: `'${platform}.minimum' ${JSON.stringify(row.minimum)} is not MAJOR.MINOR.PATCH`};
  }
  if (!isAllowedStoreUrl(platform, row.storeUrl)) {
    return {ok: false, reason: `'${platform}.storeUrl' ${JSON.stringify(row.storeUrl)} is not an https link to ${STORE_HOSTS[platform].join(', ')}`};
  }
  return {
    ok: true,
    rule: {platform, minimum: row.minimum as string, storeUrl: row.storeUrl, message: readMessage(parsed.message)},
  };
}

// --------------------------------------------------------------------------
// The decision
// --------------------------------------------------------------------------

export interface CachedRule extends MinVersionRule {
  fetchedAt: number;
}

export type Fetched =
  | {kind: 'read'; result: ParseResult}
  | {kind: 'unreachable'; reason: string};

/** Why a fetch gave no usable rule (unreachable, or read but invalid). */
function unusableReason(fetched: Fetched): string {
  if (fetched.kind === 'unreachable') return fetched.reason;
  return fetched.result.ok ? 'usable' : fetched.result.reason;
}

export type UpdateDecision =
  | {kind: 'block'; rule: MinVersionRule; source: 'fetched' | 'cache'}
  | {kind: 'allow'; reason: string; source: 'fetched' | 'cache' | 'none'};

function compareWith(running: Version, rule: MinVersionRule, source: 'fetched' | 'cache'): UpdateDecision {
  // A rule only exists after parseVersion accepted its minimum.
  const minimum = parseVersion(rule.minimum) as Version;
  if (compareVersions(running, minimum) < 0) return {kind: 'block', rule, source};
  return {kind: 'allow', reason: `running version is at or above ${rule.minimum}`, source};
}

/**
 * The whole decision table, with no I/O:
 *
 * | running version | file                 | cache          | result          |
 * |-----------------|----------------------|----------------|-----------------|
 * | unparsable      | any                  | any            | allow (logged)  |
 * | ok              | read, valid          | any            | compare to file |
 * | ok              | read, invalid        | present        | compare to cache|
 * | ok              | read, invalid        | none           | allow           |
 * | ok              | unreachable          | present        | compare to cache|
 * | ok              | unreachable          | none           | allow           |
 */
export function decideUpdate(input: {
  running: unknown;
  fetched: Fetched;
  cached: CachedRule | null;
}): UpdateDecision {
  const running = parseVersion(input.running);
  if (!running) {
    return {kind: 'allow', reason: `running version ${JSON.stringify(input.running)} cannot be compared`, source: 'none'};
  }
  if (input.fetched.kind === 'read' && input.fetched.result.ok) {
    return compareWith(running, input.fetched.result.rule, 'fetched');
  }
  if (input.cached) return compareWith(running, input.cached, 'cache');
  const why = unusableReason(input.fetched);
  return {kind: 'allow', reason: `no usable minimum (${why}) and none cached`, source: 'none'};
}

// --------------------------------------------------------------------------
// I/O, with every dependency passed in so the tests can see each call
// --------------------------------------------------------------------------

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface ForceUpdateDeps {
  fetch: (url: string, init: {signal: AbortSignal; headers: Record<string, string>}) => Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
  storage: KeyValueStore;
  platform: UpdatePlatform;
  runningVersion: unknown;
  now: () => number;
  /** Where to read from. MIN_VERSION_URL except for a __DEV__-only override. */
  url: string;
  timeoutMs?: number;
}

export async function fetchMinVersionFile(deps: Pick<ForceUpdateDeps, 'fetch' | 'platform' | 'url' | 'timeoutMs'>): Promise<Fetched> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? MIN_VERSION_FETCH_TIMEOUT_MS);
  try {
    const response = await deps.fetch(deps.url, {
      signal: controller.signal,
      headers: {'Cache-Control': 'no-cache'},
    });
    if (!response.ok) return {kind: 'unreachable', reason: `HTTP ${response.status}`};
    const text = await response.text();
    return {kind: 'read', result: parseMinVersionFile(text, deps.platform)};
  } catch (error) {
    const e = error as {name?: string; message?: string};
    if (e?.name === 'AbortError') return {kind: 'unreachable', reason: 'timed out'};
    return {kind: 'unreachable', reason: `network error: ${e?.message ?? String(error)}`};
  } finally {
    clearTimeout(timer);
  }
}

/** A cache entry is used only when every field is still valid for this platform. */
export async function readCachedRule(storage: KeyValueStore, platform: UpdatePlatform): Promise<CachedRule | null> {
  let raw: string | null;
  try {
    raw = await storage.getItem(MIN_VERSION_CACHE_KEY);
  } catch (error) {
    console.log('[ForceUpdate] Cache read failed:', error);
    return null;
  }
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    console.log('[ForceUpdate] Cache is not JSON, ignored:', raw);
    return null;
  }
  if (!isRecord(value) || value.platform !== platform || typeof value.fetchedAt !== 'number' ||
      !Number.isFinite(value.fetchedAt) || !parseVersion(value.minimum) ||
      !isAllowedStoreUrl(platform, value.storeUrl)) {
    console.log('[ForceUpdate] Cache entry is not usable, ignored:', raw);
    return null;
  }
  return {
    platform,
    minimum: value.minimum as string,
    storeUrl: value.storeUrl,
    message: readMessage(value.message),
    fetchedAt: value.fetchedAt,
  };
}

/** Stale when older than the TTL, or dated in the future (the clock moved). */
export function isCacheStale(cached: CachedRule | null, now: number, ttlMs = MIN_VERSION_TTL_MS): boolean {
  if (!cached) return true;
  if (cached.fetchedAt > now) return true;
  return now - cached.fetchedAt >= ttlMs;
}

export interface CheckOutcome {
  decision: UpdateDecision;
  /** The rule now cached, after this check. */
  cached: CachedRule | null;
}

/** One full check: read cache, read the file, keep a valid answer, decide. */
export async function checkMinimumVersion(deps: ForceUpdateDeps): Promise<CheckOutcome> {
  const previous = await readCachedRule(deps.storage, deps.platform);
  const fetched = await fetchMinVersionFile(deps);
  let cached = previous;
  if (fetched.kind === 'read' && fetched.result.ok) {
    cached = {...fetched.result.rule, fetchedAt: deps.now()};
    try {
      await deps.storage.setItem(MIN_VERSION_CACHE_KEY, JSON.stringify(cached));
    } catch (error) {
      // The decision below still uses the fresh answer; only the next offline
      // launch loses it.
      console.log('[ForceUpdate] Cache write failed:', error);
    }
  } else {
    const why = unusableReason(fetched);
    console.log(`[ForceUpdate] ${deps.url} not usable (${why}); cached minimum: ${previous ? previous.minimum : 'none'}`);
  }
  const decision = decideUpdate({running: deps.runningVersion, fetched, cached: previous});
  console.log(`[ForceUpdate] running=${JSON.stringify(deps.runningVersion)} platform=${deps.platform} decision=${decision.kind} source=${decision.source}${decision.kind === 'allow' ? ` reason=${decision.reason}` : ` minimum=${decision.rule.minimum}`}`);
  return {decision, cached};
}

/** The message for the screen, in the reader's language when the file has one. */
export function messageFor(rule: MinVersionRule, language: string): string | null {
  if (language === 'ko' || language === 'en') return rule.message[language] ?? null;
  return null;
}

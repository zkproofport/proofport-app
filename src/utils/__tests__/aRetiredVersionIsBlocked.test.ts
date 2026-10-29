/**
 * The minimum-version check (src/utils/forceUpdate.ts): which versions are
 * blocked, and what happens when the file cannot be read or cannot be trusted.
 *
 * The rule the whole table hangs on: an unreadable or malformed file never
 * blocks anyone by itself, but a minimum the app DID read keeps blocking while
 * the file is out of reach.
 */
import {
  MIN_VERSION_CACHE_KEY,
  MIN_VERSION_MAX_BYTES,
  MIN_VERSION_TTL_MS,
  MIN_VERSION_URL,
  checkMinimumVersion,
  compareVersions,
  decideUpdate,
  fetchMinVersionFile,
  isAllowedStoreUrl,
  isCacheStale,
  messageFor,
  parseMinVersionFile,
  parseVersion,
  readCachedRule,
  updatePlatformOf,
  type CachedRule,
  type ForceUpdateDeps,
  type Version,
} from '../forceUpdate';

const IOS_STORE = 'https://apps.apple.com/app/id6803903114';
const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.masselabs.zkproofport';

function file(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 1,
    ios: {minimum: '1.5.0', storeUrl: IOS_STORE},
    android: {minimum: '1.5.0', storeUrl: PLAY_STORE},
    message: {ko: '업데이트해 주세요 🙏', en: 'Please update'},
    ...overrides,
  });
}

function cachedRule(minimum: string, fetchedAt = 1_000): CachedRule {
  return {platform: 'ios', minimum, storeUrl: IOS_STORE, message: {}, fetchedAt};
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = {...initial};
  return {
    data,
    getItem: jest.fn(async (key: string) => (key in data ? data[key] : null)),
    setItem: jest.fn(async (key: string, value: string) => {
      data[key] = value;
    }),
  };
}

function response(status: number, body: string) {
  return {ok: status >= 200 && status < 300, status, text: async () => body};
}

function deps(over: Partial<ForceUpdateDeps> = {}): ForceUpdateDeps & {storage: ReturnType<typeof memoryStorage>} {
  return {
    fetch: jest.fn(async () => response(200, file())),
    storage: memoryStorage(),
    platform: 'ios',
    runningVersion: '1.4.0',
    now: () => 5_000,
    url: MIN_VERSION_URL,
    ...over,
  } as ForceUpdateDeps & {storage: ReturnType<typeof memoryStorage>};
}

describe('parseVersion takes MAJOR.MINOR.PATCH and nothing else', () => {
  it.each([
    ['1.4.0', [1, 4, 0]],
    ['0.0.0', [0, 0, 0]],
    ['10.20.30', [10, 20, 30]],
    ['999999.999999.999999', [999999, 999999, 999999]],
  ])('reads %s', (text, expected) => {
    expect(parseVersion(text)).toEqual(expected);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['leading space', ' 1.4.0'],
    ['trailing newline', '1.4.0\n'],
    ['two parts', '1.4'],
    ['four parts', '1.4.0.1'],
    ['a v prefix', 'v1.4.0'],
    ['a pre-release', '1.4.0-beta.1'],
    ['build metadata', '1.4.0+5'],
    ['a leading zero', '01.4.0'],
    ['a negative part', '1.-4.0'],
    ['a wildcard', '1.4.x'],
    ['a part past six digits', '1.4.1000000'],
    ['full-width digits', '１.４.０'],
    ['a glob', '%.*.?'],
  ])('refuses %s', (_label, text) => {
    expect(parseVersion(text)).toBeNull();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 1.4],
    ['an array', [1, 4, 0]],
    ['an object', {major: 1}],
  ])('refuses %s', (_label, value) => {
    expect(parseVersion(value)).toBeNull();
  });
});

describe('compareVersions is numeric, part by part', () => {
  const v = (s: string) => parseVersion(s) as Version;
  it.each([
    ['1.4.0', '1.4.0', 0],
    ['1.3.9', '1.4.0', -1],
    ['1.4.1', '1.4.0', 1],
    ['1.10.0', '1.9.9', 1],
    ['2.0.0', '1.99.99', 1],
    ['0.9.0', '1.0.0', -1],
  ])('%s vs %s = %d', (a, b, expected) => {
    expect(compareVersions(v(a), v(b))).toBe(expected);
  });
});

describe('the file is validated before anything is believed', () => {
  it('reads a well-formed file for each platform', () => {
    expect(parseMinVersionFile(file(), 'ios')).toEqual({
      ok: true,
      rule: {platform: 'ios', minimum: '1.5.0', storeUrl: IOS_STORE, message: {ko: '업데이트해 주세요 🙏', en: 'Please update'}},
    });
    expect(parseMinVersionFile(file(), 'android')).toMatchObject({ok: true, rule: {storeUrl: PLAY_STORE}});
  });

  it.each([
    ['not JSON', '{"schema":1,'],
    ['empty text', ''],
    ['whitespace text', '  \n'],
    ['an HTML error page', '<html><body>404</body></html>'],
    ['JSON null', 'null'],
    ['a JSON array', '[1]'],
    ['a JSON string', '"1.4.0"'],
    ['a missing schema', JSON.stringify({ios: {minimum: '1.4.0', storeUrl: IOS_STORE}})],
    ['schema 2', file({schema: 2})],
    ['schema as a string', file({schema: '1'})],
    ['no ios row', file({ios: undefined})],
    ['ios row is a string', file({ios: '1.4.0'})],
    ['ios row is null', file({ios: null})],
    ['a malformed minimum', file({ios: {minimum: '1.4', storeUrl: IOS_STORE}})],
    ['a missing minimum', file({ios: {storeUrl: IOS_STORE}})],
    ['a numeric minimum', file({ios: {minimum: 1.4, storeUrl: IOS_STORE}})],
    ['a missing store link', file({ios: {minimum: '1.4.0'}})],
    ['an http store link', file({ios: {minimum: '1.4.0', storeUrl: 'http://apps.apple.com/app/id6803903114'}})],
    ['a look-alike store host', file({ios: {minimum: '1.4.0', storeUrl: 'https://apps.apple.com.evil.test/app'}})],
    ['a store host for the other platform', file({ios: {minimum: '1.4.0', storeUrl: PLAY_STORE}})],
    ['a javascript: link', file({ios: {minimum: '1.4.0', storeUrl: 'javascript:alert(1)'}})],
    ['credentials in the link', file({ios: {minimum: '1.4.0', storeUrl: 'https://u:p@apps.apple.com/app'}})],
    ['an explicit port', file({ios: {minimum: '1.4.0', storeUrl: 'https://apps.apple.com:8443/app'}})],
  ])('refuses %s', (_label, text) => {
    expect(parseMinVersionFile(text, 'ios').ok).toBe(false);
  });

  it('refuses a body over the size cap without parsing it', () => {
    const huge = file({padding: 'x'.repeat(MIN_VERSION_MAX_BYTES)});
    const result = parseMinVersionFile(huge, 'ios');
    expect(result).toMatchObject({ok: false});
    expect((result as {reason: string}).reason).toMatch(/cap/);
  });

  it('keeps a valid platform row when the message is wrong (the message is display-only)', () => {
    for (const message of [undefined, null, 'text', {ko: 5, en: ''}, {ko: '   ', en: 'x'.repeat(501)}]) {
      const result = parseMinVersionFile(file({message}), 'ios');
      expect(result).toMatchObject({ok: true, rule: {minimum: '1.5.0', message: {}}});
    }
  });

  it('keeps Korean, emoji, newlines and tabs in a message as given', () => {
    const text = '새 버전이 필요합니다 🚀\n\t다시 시도';
    expect(parseMinVersionFile(file({message: {ko: text}}), 'ios')).toMatchObject({ok: true, rule: {message: {ko: text}}});
  });

  it('lets each platform stand alone: a broken android row does not stop iOS', () => {
    const text = file({android: {minimum: 'oops', storeUrl: PLAY_STORE}});
    expect(parseMinVersionFile(text, 'ios').ok).toBe(true);
    expect(parseMinVersionFile(text, 'android').ok).toBe(false);
  });
});

describe('the decision table', () => {
  const read = (text: string) => ({kind: 'read' as const, result: parseMinVersionFile(text, 'ios')});
  const unreachable = {kind: 'unreachable' as const, reason: 'HTTP 503'};

  it.each([
    ['below the minimum', '1.4.9', 'block'],
    ['equal to the minimum', '1.5.0', 'allow'],
    ['above the minimum', '1.5.1', 'allow'],
    ['a major above with a lower minor', '2.0.0', 'allow'],
  ])('a read file and a running version %s -> %s', (_label, running, kind) => {
    expect(decideUpdate({running, fetched: read(file()), cached: null}).kind).toBe(kind);
  });

  it('a fresh read wins over a higher cached minimum (how a mistaken raise is undone)', () => {
    const decision = decideUpdate({running: '1.4.0', fetched: read(file({ios: {minimum: '1.4.0', storeUrl: IOS_STORE}})), cached: cachedRule('9.0.0')});
    expect(decision).toMatchObject({kind: 'allow', source: 'fetched'});
  });

  it('a fresh read wins over a lower cached minimum', () => {
    expect(decideUpdate({running: '1.4.0', fetched: read(file()), cached: cachedRule('1.0.0')})).toMatchObject({kind: 'block', source: 'fetched'});
  });

  it('unreachable with a blocking cache still blocks', () => {
    expect(decideUpdate({running: '1.4.0', fetched: unreachable, cached: cachedRule('1.5.0')})).toMatchObject({kind: 'block', source: 'cache'});
  });

  it('unreachable with a cache that does not block allows', () => {
    expect(decideUpdate({running: '1.4.0', fetched: unreachable, cached: cachedRule('1.4.0')})).toMatchObject({kind: 'allow', source: 'cache'});
  });

  it('unreachable with no cache allows', () => {
    expect(decideUpdate({running: '1.4.0', fetched: unreachable, cached: null})).toMatchObject({kind: 'allow', source: 'none'});
  });

  it('a malformed file falls back to the cache, both ways', () => {
    expect(decideUpdate({running: '1.4.0', fetched: read('{bad'), cached: cachedRule('1.5.0')})).toMatchObject({kind: 'block', source: 'cache'});
    expect(decideUpdate({running: '1.4.0', fetched: read(file({schema: 2})), cached: null})).toMatchObject({kind: 'allow', source: 'none'});
  });

  it.each([null, undefined, '', '1.4', 'unknown', 140])('a running version it cannot read (%p) allows, never blocks', running => {
    expect(decideUpdate({running, fetched: read(file({ios: {minimum: '99.0.0', storeUrl: IOS_STORE}})), cached: cachedRule('99.0.0')}))
      .toMatchObject({kind: 'allow', source: 'none'});
  });
});

describe('reading the file over the network', () => {
  it('is unreachable on HTTP 404, 500 and 503, without reading the body', async () => {
    for (const status of [404, 500, 503]) {
      const text = jest.fn();
      const result = await fetchMinVersionFile({...deps(), fetch: async () => ({ok: false, status, text})});
      expect(result).toEqual({kind: 'unreachable', reason: `HTTP ${status}`});
      expect(text).not.toHaveBeenCalled();
    }
  });

  it('is unreachable when offline', async () => {
    const result = await fetchMinVersionFile({...deps(), fetch: async () => {
      throw new TypeError('Network request failed');
    }});
    expect(result).toEqual({kind: 'unreachable', reason: 'network error: Network request failed'});
  });

  it('gives up after the timeout and aborts the request', async () => {
    jest.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const hanging = (_url: string, init: {signal: AbortSignal}) => {
        signal = init.signal;
        return new Promise<never>((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), {name: 'AbortError'})));
        });
      };
      const pending = fetchMinVersionFile({...deps(), fetch: hanging, timeoutMs: 5000});
      jest.advanceTimersByTime(4999);
      expect(signal?.aborted).toBe(false);
      jest.advanceTimersByTime(1);
      await expect(pending).resolves.toEqual({kind: 'unreachable', reason: 'timed out'});
      expect(signal?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reads a 200 and validates it', async () => {
    const result = await fetchMinVersionFile({...deps(), fetch: async () => response(200, 'not json')});
    expect(result).toMatchObject({kind: 'read', result: {ok: false}});
  });
});

describe('the cache', () => {
  it('stores a valid answer and is what the next offline check decides on', async () => {
    const d = deps();
    const first = await checkMinimumVersion(d);
    expect(first.decision).toMatchObject({kind: 'block', source: 'fetched'});
    expect(d.storage.setItem).toHaveBeenCalledWith(MIN_VERSION_CACHE_KEY, expect.any(String));
    expect(JSON.parse(d.storage.data[MIN_VERSION_CACHE_KEY])).toMatchObject({platform: 'ios', minimum: '1.5.0', fetchedAt: 5_000});

    const offline = await checkMinimumVersion({...d, fetch: async () => {
      throw new TypeError('Network request failed');
    }});
    expect(offline.decision).toMatchObject({kind: 'block', source: 'cache'});
  });

  it('is never overwritten by a file it could not trust', async () => {
    const storage = memoryStorage({[MIN_VERSION_CACHE_KEY]: JSON.stringify(cachedRule('1.5.0'))});
    const outcome = await checkMinimumVersion(deps({storage, fetch: async () => response(200, file({schema: 2}))}));
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(outcome.decision).toMatchObject({kind: 'block', source: 'cache'});
  });

  it('still decides on the fresh answer when the cache cannot be written', async () => {
    const storage = {getItem: async () => null, setItem: async () => {
      throw new Error('disk full');
    }};
    const outcome = await checkMinimumVersion(deps({storage}));
    expect(outcome.decision).toMatchObject({kind: 'block', source: 'fetched'});
  });

  it.each([
    ['not JSON', '{'],
    ['another platform', JSON.stringify({...cachedRule('1.5.0'), platform: 'android'})],
    ['a malformed minimum', JSON.stringify({...cachedRule('1.5.0'), minimum: '1.5'})],
    ['a foreign store link', JSON.stringify({...cachedRule('1.5.0'), storeUrl: 'https://evil.test'})],
    ['no fetchedAt', JSON.stringify({...cachedRule('1.5.0'), fetchedAt: undefined})],
    ['a NaN fetchedAt', JSON.stringify({...cachedRule('1.5.0'), fetchedAt: 'NaN'})],
  ])('ignores an entry with %s', async (_label, raw) => {
    expect(await readCachedRule(memoryStorage({[MIN_VERSION_CACHE_KEY]: raw}), 'ios')).toBeNull();
  });

  it('ignores a storage that throws', async () => {
    const storage = {getItem: async () => {
      throw new Error('locked');
    }, setItem: async () => undefined};
    expect(await readCachedRule(storage, 'ios')).toBeNull();
  });

  it.each([
    ['no cache', null, 10_000, true],
    ['just fetched', cachedRule('1.0.0', 10_000), 10_000, false],
    ['one ms before the TTL', cachedRule('1.0.0', 0), MIN_VERSION_TTL_MS - 1, false],
    ['exactly at the TTL', cachedRule('1.0.0', 0), MIN_VERSION_TTL_MS, true],
    ['twice the TTL', cachedRule('1.0.0', 0), MIN_VERSION_TTL_MS * 2, true],
    ['dated in the future (clock moved back)', cachedRule('1.0.0', 50_000), 10_000, true],
  ])('staleness: %s', (_label, cached, now, stale) => {
    expect(isCacheStale(cached as CachedRule | null, now as number)).toBe(stale);
  });
});

describe('platforms and store links', () => {
  it('knows ios and android and refuses anything else by name', () => {
    expect(updatePlatformOf('ios')).toBe('ios');
    expect(updatePlatformOf('android')).toBe('android');
    for (const os of ['web', 'windows', 'macos', '', '__proto__', 'constructor']) {
      expect(() => updatePlatformOf(os)).toThrow(/Unknown platform/);
    }
  });

  it('allows only the platform\'s own store over https', () => {
    expect(isAllowedStoreUrl('ios', IOS_STORE)).toBe(true);
    expect(isAllowedStoreUrl('android', PLAY_STORE)).toBe(true);
    expect(isAllowedStoreUrl('android', IOS_STORE)).toBe(false);
    expect(isAllowedStoreUrl('ios', 'itms-apps://apps.apple.com/app/id6803903114')).toBe(false);
    expect(isAllowedStoreUrl('ios', 'not a url')).toBe(false);
  });

  it('picks the reader\'s language from the file, else none (the app\'s words are used)', () => {
    const rule = {platform: 'ios' as const, minimum: '1.5.0', storeUrl: IOS_STORE, message: {ko: '한국어'}};
    expect(messageFor(rule, 'ko')).toBe('한국어');
    expect(messageFor(rule, 'en')).toBeNull();
    expect(messageFor(rule, 'ja')).toBeNull();
  });
});

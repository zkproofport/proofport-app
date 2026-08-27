/**
 * Where a debug build looks for the OpenStoa backend.
 *
 * THE DEFECT THIS CLOSES. The Android branch returned the `10.0.2.2` emulator
 * alias unconditionally — two lines below a comment saying a physical device
 * needs the Mac's LAN IP. On a phone that alias resolves to nothing, so a debug
 * build on real hardware could not reach the local backend at all, and the only
 * way to exercise chat against local code was an emulator. The comment was
 * right and the code did not do what it said.
 *
 * THE RULE NOW: ask Metro. The bundle came from a URL, and that URL's host is
 * by definition reachable from whatever downloaded it — one fact that covers
 * the phone, the emulator and the simulator, instead of three guesses. The only
 * case Metro cannot answer is loopback, which means "this machine" and is the
 * PHONE when the phone is the one resolving it; that is exactly what `10.0.2.2`
 * exists for on Android.
 *
 * EDGE-CASE MATRIX (CLAUDE.md) → coverage
 *   contract  → a LAN host from Metro is used verbatim, on BOTH platforms
 *   boundary  → `localhost` and `127.0.0.1` fall back per platform
 *   empty     → no dev server / no URL → the per-platform default
 *   hostile   → a malformed URL does not produce a malformed base URL
 *   external  → `getDevServer` throwing does not crash the app at startup
 *   contract  → staging and production are unaffected by any of it
 *   UTF-8 / very large / authz / race → N/A: this reads one URL string from the
 *              dev server and makes no authorization or ordering decision.
 */

/*
 * `mock`-prefixed on purpose: jest forbids a `jest.mock` factory from touching
 * an out-of-scope variable, and permits it only for names beginning with
 * `mock`. Without the prefix the whole suite fails to load, which reads as a
 * broken test rather than a naming rule.
 */
/** What `getDevServer()` answers for the case under test. */
let mockDevServerUrl: string | undefined;
/** Whether requiring it throws, as it does outside a Metro-connected build. */
let mockDevServerThrows = false;
let mockPlatform: 'android' | 'ios' = 'android';
let mockEnvironment: 'development' | 'staging' | 'production' = 'development';

jest.mock(
  'react-native/Libraries/Core/Devtools/getDevServer',
  () => ({
    __esModule: true,
    default: () => {
      if (mockDevServerThrows) throw new Error('no dev server');
      return { url: mockDevServerUrl };
    },
  }),
  { virtual: true },
);

jest.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatform;
    },
  },
}));

jest.mock('../../config', () => ({ getEnvironment: () => mockEnvironment }));

/*
 * `__DEV__` is injected by the RN bundler and is not on the global type, so it
 * is set through a cast rather than declared — a `declare const global` here
 * collides with jest's own `global`.
 */
const withDev = globalThis as unknown as { __DEV__: boolean };

function resolve(): string {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../openStoaBaseUrl').resolveOpenStoaBaseUrl();
}

beforeEach(() => {
  mockDevServerUrl = undefined;
  mockDevServerThrows = false;
  mockPlatform = 'android';
  mockEnvironment = 'development';
  withDev.__DEV__ = true;
});

describe('a debug build follows Metro', () => {
  it('CONTRACT: a LAN host is used verbatim on ANDROID — the phone case that was broken', () => {
    /*
     * The regression. A physical Android phone gets its bundle from the Mac's
     * LAN address, so that is where the backend is too. Returning `10.0.2.2`
     * here is what made a debug build on real hardware useless.
     */
    mockDevServerUrl = 'http://192.168.0.42:8081/index.bundle';
    expect(resolve()).toBe('http://192.168.0.42:3200');
  });

  it('CONTRACT: and on iOS', () => {
    mockPlatform = 'ios';
    mockDevServerUrl = 'http://192.168.0.42:8081/index.bundle';
    expect(resolve()).toBe('http://192.168.0.42:3200');
  });

  it('CONTRACT: loopback is KEPT — a USB-reversed phone reaches the backend there', () => {
    /*
     * The case the first version of this fix broke. A phone attached over USB
     * with `adb reverse tcp:8081` sees Metro at `localhost`; the backend
     * reversed the same way is at `localhost:3200`. Rewriting that to the
     * emulator alias sent every request nowhere.
     */
    mockDevServerUrl = 'http://localhost:8081/x';
    expect(resolve()).toBe('http://localhost:3200');
    mockDevServerUrl = 'http://127.0.0.1:8081/x';
    expect(resolve()).toBe('http://127.0.0.1:3200');
  });

  it('CONTRACT: an emulator needs no special case — it reaches Metro through the alias', () => {
    // `getDevServer()` already reports 10.0.2.2 there, so following Metro
    // produces the right answer without a platform branch.
    mockDevServerUrl = 'http://10.0.2.2:8081/x';
    expect(resolve()).toBe('http://10.0.2.2:3200');
  });

  it('EMPTY: no URL at all → the per-platform default', () => {
    mockDevServerUrl = undefined;
    expect(resolve()).toBe('http://10.0.2.2:3200');
    mockPlatform = 'ios';
    expect(resolve()).toBe('http://127.0.0.1:3200');
  });

  it('EXTERNAL: getDevServer throwing does not take the app down', () => {
    // It throws in any build Metro is not attached to, which covers plenty of
    // the ways a developer actually runs this.
    mockDevServerThrows = true;
    expect(resolve()).toBe('http://10.0.2.2:3200');
  });

  it('HOSTILE: a malformed URL yields a sane default, never a malformed base URL', () => {
    for (const bad of ['', 'not a url', '://', 'http://']) {
      mockDevServerUrl = bad;
      expect(resolve()).toMatch(/^http:\/\/[\w.-]+:3200$/);
    }
  });
});

describe('deployed builds are unaffected', () => {
  it('CONTRACT: staging and production ignore Metro entirely', () => {
    withDev.__DEV__ = false;
    mockDevServerUrl = 'http://192.168.0.42:8081/x';

    mockEnvironment = 'staging';
    expect(resolve()).toBe('https://stg-community.zkproofport.app');

    mockEnvironment = 'production';
    expect(resolve()).toBe('https://www.openstoa.xyz');
  });
});

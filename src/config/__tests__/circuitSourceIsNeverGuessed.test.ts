/**
 * Where a production build reads circuit data from, when GitHub does not answer.
 *
 * WHY THIS EXISTS. The resolver used to end with `if (!tag) return
 * GITHUB_RAW('main')`. Nothing failed when it fired: the download succeeded,
 * the digest manifest published beside the file at the same ref agreed with it,
 * and the app proved with circuit bytes that were never released — while the
 * verifier ADDRESS stayed at the release's, because the broadcast resolver
 * returns null on the same failure instead of moving to main. A single
 * unreachable API call paired a circuit with a verifier never deployed for it.
 *
 * The API call is unreachable more often than it sounds: the unauthenticated
 * GitHub API allows 60 calls an hour per IP, and phones behind one carrier NAT
 * share that IP.
 *
 * What replaces it: the tag this device resolved LAST time, at any age, because
 * that is the release the files on disk actually came from. Only when there has
 * never been one does resolution fail — and then it says so.
 */

const mockDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => (mockDisk.has(k) ? mockDisk.get(k)! : null),
    setItem: async (k: string, v: string) => void mockDisk.set(k, v),
    removeItem: async (k: string) => void mockDisk.delete(k),
  },
}));

// The phone's filesystem, needed only because circuitDownload.ts imports it at
// module scope. Nothing in these tests touches a file.
jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    DocumentDirectoryPath: '/tmp/documents',
    MainBundlePath: '/tmp/bundle',
    exists: async () => false,
    mkdir: async () => {},
    unlink: async () => {},
    stat: async () => ({size: 0}),
    hash: async () => '',
  },
}));

const TAG_KEY = '@proofport/deployment/release-tag';
const HOUR = 60 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {resolveCircuitBaseUrl} = require('../deployments');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {circuitBaseUrl} = require('../../utils/circuitDownload');

function githubAnswers(tag: string) {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    json: async () => ({tag_name: tag}),
  }));
  (globalThis as {fetch?: unknown}).fetch = fetchMock;
  return fetchMock;
}

function githubFails(kind: 'offline' | 'rate-limited' | 'no-tag') {
  const fetchMock = jest.fn(async () => {
    if (kind === 'offline') throw new Error('Network request failed');
    if (kind === 'rate-limited') return {ok: false, status: 403, json: async () => ({})};
    return {ok: true, json: async () => ({message: 'Not Found'})};
  });
  (globalThis as {fetch?: unknown}).fetch = fetchMock;
  return fetchMock;
}

beforeEach(() => {
  mockDisk.clear();
  delete (globalThis as {fetch?: unknown}).fetch;
});

describe('a production build asks GitHub which release to read', () => {
  it('uses the tag GitHub names, and remembers it', async () => {
    const fetchMock = githubAnswers('v1.3.0');

    expect(await resolveCircuitBaseUrl('production')).toBe(
      'https://raw.githubusercontent.com/zkproofport/circuits/v1.3.0',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockDisk.get(TAG_KEY)!).tag).toBe('v1.3.0');
  });

  it('does not ask again while the remembered tag is under an hour old', async () => {
    mockDisk.set(TAG_KEY, JSON.stringify({tag: 'v1.3.0', fetchedAt: Date.now() - (HOUR - 1000)}));
    const fetchMock = githubAnswers('v9.9.9');

    expect(await resolveCircuitBaseUrl('production')).toContain('/v1.3.0');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks again once the remembered tag reaches an hour old', async () => {
    mockDisk.set(TAG_KEY, JSON.stringify({tag: 'v1.3.0', fetchedAt: Date.now() - HOUR}));
    const fetchMock = githubAnswers('v1.4.0');

    expect(await resolveCircuitBaseUrl('production')).toContain('/v1.4.0');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('when GitHub cannot be read', () => {
  it.each(['offline', 'rate-limited', 'no-tag'] as const)(
    'keeps using the tag this device saw before (%s)',
    async kind => {
      // A month old, which the old TTL would have thrown away.
      mockDisk.set(TAG_KEY, JSON.stringify({tag: 'v1.3.0', fetchedAt: Date.now() - 30 * 24 * HOUR}));
      githubFails(kind);

      expect(await resolveCircuitBaseUrl('production')).toBe(
        'https://raw.githubusercontent.com/zkproofport/circuits/v1.3.0',
      );
    },
  );

  it.each(['offline', 'rate-limited', 'no-tag'] as const)(
    'fails, naming the repo, when no tag was ever seen (%s)',
    async kind => {
      githubFails(kind);

      await expect(resolveCircuitBaseUrl('production')).rejects.toThrow(
        /zkproofport\/circuits/,
      );
    },
  );

  it('never answers with main — the whole point', async () => {
    githubFails('offline');

    const err = await resolveCircuitBaseUrl('production').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/githubusercontent\.com\/[^ ]*\/main/);
  });

  it.each([
    ['not JSON at all', 'not json'],
    ['a tag that is not a string', JSON.stringify({tag: 12345, fetchedAt: Date.now()})],
    ['an empty tag', JSON.stringify({tag: '', fetchedAt: Date.now()})],
  ])('treats %s in storage as no tag at all', async (_label, stored) => {
    mockDisk.set(TAG_KEY, stored);
    githubFails('offline');

    await expect(resolveCircuitBaseUrl('production')).rejects.toThrow();
  });

  it('accepts a remembered tag with no timestamp rather than discarding it', async () => {
    mockDisk.set(TAG_KEY, JSON.stringify({tag: 'v1.3.0'}));
    githubFails('offline');

    expect(await resolveCircuitBaseUrl('production')).toContain('/v1.3.0');
  });
});

describe('development and staging', () => {
  it.each(['development', 'staging'] as const)(
    '%s reads main and never asks GitHub for a tag',
    async env => {
      const fetchMock = githubAnswers('v1.3.0');

      expect(await resolveCircuitBaseUrl(env)).toBe(
        'https://raw.githubusercontent.com/zkproofport/circuits/main',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe('the circuits that live only on main', () => {
  it.each(['arc_eligibility', 'giwa_attestation', 'mdl_kr_age'])(
    '%s reads main on a production build, with no tag involved',
    async circuit => {
      const fetchMock = githubFails('offline');

      expect(await circuitBaseUrl(circuit, 'production')).toBe(
        'https://raw.githubusercontent.com/zkproofport/circuits/main',
      );
      // The release resolver is not consulted, so an offline production build
      // can still work with these.
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(['coinbase_attestation', 'coinbase_country_attestation', 'oidc_domain_attestation'])(
    '%s reads the release tag on a production build',
    async circuit => {
      githubAnswers('v1.3.0');

      expect(await circuitBaseUrl(circuit, 'production')).toContain('/v1.3.0');
    },
  );
});

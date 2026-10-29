/**
 * Where a build reads circuit data and verifier records from. Never guessed,
 * and never asked of GitHub.
 *
 * WHY THIS EXISTS. Production used to ask
 * `api.github.com/repos/zkproofport/circuits/releases/latest` at launch, so a
 * newly published circuits tag switched every installed app to new circuits
 * and verifiers -- apps whose input builders predate them included. Decided
 * 2026-10-27: each app version pins one exact tag (CIRCUITS_RELEASE_TAG) for
 * the official circuits; development and staging read `main`; the Laboratory
 * circuits read `main` everywhere. A pinned tag that does not answer is an
 * error naming the tag, never a fallback to `main` or another release.
 *
 * Before that, the resolver ended with `if (!tag) return GITHUB_RAW('main')`,
 * which paired a circuit from main with a release's verifier address; the
 * "never main" cases below keep that closed.
 */
// Coinbase KYC v2 and OIDC read per-platform circuit files; this test is the iPhone's.
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'ios'}}));

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

const TAG = 'v2.0.0';
const RAW = 'https://raw.githubusercontent.com/zkproofport/circuits';
// The official circuits read from the tag. coinbase_attestation (v2) and
// oidc_domain_attestation (with the provider-key statement) are read from
// pinned circuits commits on this branch (circuitArtifacts.ts); their own
// cases are at the end of this file and in coinbaseKycIsV2Everywhere.test.ts.
const OFFICIAL = ['coinbase_country_attestation'] as const;

/* eslint-disable @typescript-eslint/no-var-requires */
const {
  resolveCircuitBaseUrl,
  fetchDeploymentAddress,
  getVerifierAddress,
  syncDeployments,
  circuitsRef,
  isCircuitsReleaseMissingError,
} = require('../deployments');
const {circuitBaseUrl} = require('../../utils/circuitDownload');
const {CIRCUITS_RELEASE_TAG, STATIC_CONFIGS} = require('../contracts');
/* eslint-enable @typescript-eslint/no-var-requires */

/** Every URL fetched; answers from `records` (path after RAW), 404 otherwise. */
function github(records: Record<string, string> = {}, opts: {offline?: boolean} = {}) {
  const fetchMock = jest.fn(async (url: string) => {
    if (opts.offline) throw new Error('Network request failed');
    const address = records[url.replace(RAW, '')];
    if (!address) return {ok: false, status: 404, json: async () => ({})};
    return {ok: true, status: 200, json: async () => ({
      chain: 0, timestamp: 1790092800, commit: 'fixture', libraries: [],
      transactions: [{contractName: 'HonkVerifier', contractAddress: address}],
    })};
  });
  (globalThis as {fetch?: unknown}).fetch = fetchMock;
  return fetchMock;
}

/** The production broadcast records every official circuit has at `tag`. */
function releaseRecords(tag = TAG): Record<string, string> {
  return {
    [`/${tag}/broadcast/DeployCoinbaseCountryAttestation.s.sol/8453/run-latest.json`]: '0xF3D5A09d2C85B28C52EF2905c1BE3a852b609D0C',
    [`/${tag}/broadcast/DeployOidcDomainAttestation.s.sol/8453/run-latest.json`]: '0x9677Ba46Ad226Ce8B3C4517d9c0143e4D458BeAe',
  };
}

const urlsOf = (m: jest.Mock) => m.mock.calls.map(([u]) => u as string);

beforeEach(() => {
  mockDisk.clear();
  delete (globalThis as {fetch?: unknown}).fetch;
});

describe('one exact circuits tag per app version', () => {
  it('is a plain semver tag, v2.0.0 for this circuit set', () => {
    expect(CIRCUITS_RELEASE_TAG).toBe(TAG);
    expect(CIRCUITS_RELEASE_TAG).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it('production names that tag; development and staging name main', () => {
    expect(STATIC_CONFIGS.production.circuitsSource).toEqual({type: 'release', tag: TAG});
    expect(STATIC_CONFIGS.development.circuitsSource).toEqual({type: 'branch', branch: 'main'});
    expect(STATIC_CONFIGS.staging.circuitsSource).toEqual({type: 'branch', branch: 'main'});
  });

  it.each(OFFICIAL)('production reads %s files from the exact tag, without asking GitHub', async circuit => {
    const fetchMock = github();
    expect(await circuitBaseUrl(circuit, 'production')).toBe(`${RAW}/${TAG}`);
    expect(circuitsRef(circuit, 'production')).toBe(TAG);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(OFFICIAL)('production reads the %s verifier record from the same tag', async circuit => {
    const fetchMock = github(releaseRecords());
    expect(await fetchDeploymentAddress(circuit, 'production')).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const urls = urlsOf(fetchMock);
    expect(urls).toHaveLength(1);
    expect(urls[0].startsWith(`${RAW}/${TAG}/broadcast/`)).toBe(true);
    expect(urls[0].endsWith('/8453/run-latest.json')).toBe(true);
  });

  it('a whole production sync touches only the tag and main, never the API', async () => {
    const fetchMock = github({
      ...releaseRecords(),
      '/main/broadcast/DeployGiwaAttestation.s.sol/91342/run-latest.json': '0xF6Edb9d6114B2546B6E559997fdDE08CAeEA83b3',
    });
    await syncDeployments('production').catch(() => undefined);
    const urls = urlsOf(fetchMock);
    expect(urls.length).toBeGreaterThan(3);
    for (const u of urls) {
      expect(u).not.toMatch(/api\.github\.com|releases/);
      expect(u.startsWith(`${RAW}/${TAG}/`) || u.startsWith(`${RAW}/main/`)).toBe(true);
    }
    // The official circuits never read main in production.
    expect(urls.filter(u => u.startsWith(`${RAW}/main/`) && /Coinbase|Oidc/.test(u))).toEqual([]);
  });

  it('a "latest" tag remembered by an older app version changes nothing', async () => {
    mockDisk.set('@proofport/deployment/release-tag', JSON.stringify({tag: 'v9.9.9', fetchedAt: Date.now()}));
    const fetchMock = github(releaseRecords());
    expect(await circuitBaseUrl('coinbase_country_attestation', 'production')).toBe(`${RAW}/${TAG}`);
    await fetchDeploymentAddress('coinbase_country_attestation', 'production');
    expect(urlsOf(fetchMock).some(u => u.includes('v9.9.9'))).toBe(false);
  });

  it('a verifier cached under another tag, or under the old unkeyed key, is not used', async () => {
    mockDisk.set('@proofport/deployment/production/coinbase_country_attestation', JSON.stringify({address: '0x1111111111111111111111111111111111111111'}));
    mockDisk.set('@proofport/deployment/production/coinbase_country_attestation@v1.3.0', JSON.stringify({address: '0x2222222222222222222222222222222222222222'}));
    github({}, {offline: true});
    expect(await getVerifierAddress('coinbase_country_attestation', 'production')).toBe('0x8e89f11E65f219203f5bE9d6a69a4da084630C56');
  });

  it('a verifier read from this tag is cached under it and survives going offline', async () => {
    const redeployed = '0x3333333333333333333333333333333333333333';
    github({[`/${TAG}/broadcast/DeployCoinbaseCountryAttestation.s.sol/8453/run-latest.json`]: redeployed});
    expect(await fetchDeploymentAddress('coinbase_country_attestation', 'production')).toBe(redeployed);
    expect(JSON.parse(mockDisk.get(`@proofport/deployment/production/coinbase_country_attestation@${TAG}`)!).ref).toBe(TAG);
    github({}, {offline: true});
    expect(await fetchDeploymentAddress('coinbase_country_attestation', 'production')).toBeNull();
    expect(await getVerifierAddress('coinbase_country_attestation', 'production')).toBe(redeployed);
  });
});

describe('the pinned tag is missing', () => {
  it('a 404 at the tag is an error naming the tag and the file, never main', async () => {
    github({});
    const err = await fetchDeploymentAddress('coinbase_country_attestation', 'production').catch((e: Error) => e);
    expect(isCircuitsReleaseMissingError(err)).toBe(true);
    expect((err as Error).message).toContain(`Circuits release ${TAG} is not available`);
    expect((err as Error).message).toContain(`${RAW}/${TAG}/broadcast/DeployCoinbaseCountryAttestation.s.sol/8453/run-latest.json`);
    expect((err as Error).message).not.toMatch(/circuits\/main\//);
  });

  it('a sync tries every circuit, caches the ones that answer, then names every missing file', async () => {
    // Coinbase Country is now the only official circuit whose record is read
    // at the tag; Coinbase KYC v2 and OIDC (provider-key statement) have
    // none to miss, and GIWA reads main.
    const giwa = '0xf6edb9d6114b2546b6e559997fdde08caeea83b3';
    github({'/main/broadcast/DeployGiwaAttestation.s.sol/91342/run-latest.json': giwa});
    const err = await syncDeployments('production').catch((e: Error) => e);
    expect(isCircuitsReleaseMissingError(err)).toBe(true);
    expect((err as Error).message).toContain('DeployCoinbaseCountryAttestation.s.sol');
    expect((err as Error).message).not.toContain('DeployOidcDomainAttestation');
    expect((err as Error).message).not.toContain('DeployCoinbaseAttestation.s.sol');
    expect(await fetchDeploymentAddress('giwa_attestation', 'production')).toBe(giwa);
  });

  it('offline is not a missing tag: no error, built-in addresses answer', async () => {
    github({}, {offline: true});
    await expect(syncDeployments('production')).resolves.toBe(false);
    expect(await getVerifierAddress('coinbase_country_attestation', 'production')).toBe('0x8e89f11E65f219203f5bE9d6a69a4da084630C56');
  });

  it('a server error (500) is not a missing tag either', async () => {
    (globalThis as {fetch?: unknown}).fetch = jest.fn(async () => ({ok: false, status: 500, json: async () => ({})}));
    await expect(fetchDeploymentAddress('coinbase_country_attestation', 'production')).resolves.toBeNull();
  });

  it.each(['development', 'staging'] as const)('a 404 on main in %s stays a quiet null (not a pinned release)', async env => {
    github({});
    await expect(fetchDeploymentAddress('coinbase_country_attestation', env)).resolves.toBeNull();
  });
});

describe('development and staging', () => {
  it.each(['development', 'staging'] as const)('%s reads main and never asks GitHub for a tag', async env => {
    const fetchMock = github();
    expect(resolveCircuitBaseUrl(env)).toBe(`${RAW}/main`);
    for (const circuit of OFFICIAL) {
      expect(await circuitBaseUrl(circuit, env)).toBe(`${RAW}/main`);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an unknown environment is an error, not production or main', () => {
    expect(() => resolveCircuitBaseUrl('prod')).toThrow(/Unknown environment 'prod'/);
  });
});

describe('the circuits that live only on main', () => {
  it.each(['giwa_attestation', 'mdl_kr_age'])('%s reads main on a production build, with no tag involved', async circuit => {
    const fetchMock = github({}, {offline: true});
    expect(await circuitBaseUrl(circuit, 'production')).toBe(`${RAW}/main`);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('a verifier follows the circuit bytes', () => {
  const giwa = '0xf6edb9d6114b2546b6e559997fdde08caeea83b3';
  const oldGiwa = '0xeb9eb5452790cfe549ff83ceb3dbe1c432231492';

  function broadcasts(currentGiwa = giwa) {
    return github({
      '/main/broadcast/DeployGiwaAttestation.s.sol/91342/run-latest.json': currentGiwa,
      [`/${TAG}/broadcast/DeployGiwaAttestation.s.sol/91342/run-latest.json`]: oldGiwa,
      [`/${TAG}/broadcast/DeployCoinbaseCountryAttestation.s.sol/8453/run-latest.json`]: '0xF3D5A09d2C85B28C52EF2905c1BE3a852b609D0C',
      '/main/broadcast/DeployCoinbaseCountryAttestation.s.sol/84532/run-latest.json': '0xdee363585926c3c28327efd1edd01cf4559738cf',
    });
  }

  it.each(['development', 'staging', 'production'])('%s resolves GIWA to the current main verifier', async env => {
    const fetchMock = broadcasts();
    expect(await fetchDeploymentAddress('giwa_attestation', env)).toBe(giwa);
    expect(urlsOf(fetchMock).every(url => url.includes('/main/broadcast/'))).toBe(true);
  });

  it('keeps supported production verifiers on the tag and staging on main', async () => {
    broadcasts();
    expect(await fetchDeploymentAddress('coinbase_country_attestation', 'production')).toBe('0xF3D5A09d2C85B28C52EF2905c1BE3a852b609D0C');
    expect(await fetchDeploymentAddress('coinbase_country_attestation', 'staging')).toBe('0xdee363585926c3c28327efd1edd01cf4559738cf');
  });

  it('reads Coinbase KYC v2 from its configured address, never a broadcast or an old cache', async () => {
    const fetchMock = broadcasts();
    mockDisk.set('@proofport/deployment/staging/coinbase_attestation', JSON.stringify({address: '0x0036B61dBFaB8f3CfEEF77dD5D45F7EFBFE2035c'}));
    expect(await fetchDeploymentAddress('coinbase_attestation', 'staging')).toBeNull();
    expect(await getVerifierAddress('coinbase_attestation', 'staging')).toBe('0x1885aA2283DB21ad0fc63A2Df98efe92F31908E6');
    expect(await getVerifierAddress('coinbase_attestation', 'production')).toBe('0x6FC22d3576FB70457d1529B3F70f711A3cBA7A7F');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('DeployCoinbaseAttestation'))).toBe(false);
  });

  it('reads OIDC (provider-key statement) from its configured address, never a broadcast or an old cache', async () => {
    const fetchMock = broadcasts();
    mockDisk.set('@proofport/deployment/staging/oidc_domain_attestation', JSON.stringify({address: '0x003334A7C2ff15ee9ee845Ab88e152A2A3694167'}));
    expect(await fetchDeploymentAddress('oidc_domain_attestation', 'staging')).toBeNull();
    expect(await getVerifierAddress('oidc_domain_attestation', 'staging')).toBe('0xeA5933ABc598401c89F63B3f13AE56A7E78984e8');
    expect(await getVerifierAddress('oidc_domain_attestation', 'production')).toBe('0xF1AA88aD844bFd1dc552526a67f5980aAd4E7f35');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('DeployOidcDomainAttestation'))).toBe(false);
  });

  it('ignores the old unversioned giwa cache and has an offline verifier', async () => {
    mockDisk.set('@proofport/deployment/production/giwa_attestation', JSON.stringify({address: oldGiwa}));
    const fetchMock = github({}, {offline: true});
    const address = await getVerifierAddress('giwa_attestation', 'production');
    expect(address.toLowerCase()).toBe(giwa);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a refreshed experimental verifier available offline', async () => {
    const redeployed = '0x2222222222222222222222222222222222222222';
    broadcasts(redeployed);
    expect(await fetchDeploymentAddress('giwa_attestation', 'production')).toBe(redeployed);
    github({}, {offline: true});
    expect(await getVerifierAddress('giwa_attestation', 'production')).toBe(redeployed);
  });

  it('ignores a cache for an earlier experimental circuit data version', async () => {
    mockDisk.set('@proofport/deployment/production/giwa_attestation/v1', JSON.stringify({address: oldGiwa}));
    github({}, {offline: true});
    expect((await getVerifierAddress('giwa_attestation', 'production')).toLowerCase()).toBe(giwa);
  });
});

describe('a circuit cache version is never guessed', () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const {circuitDataVersion} = require('../../utils/circuitDownload');
  const {CIRCUIT_DATA_VERSIONS} = require('../contracts');
  /* eslint-enable @typescript-eslint/no-var-requires */

  it('returns the configured version for every known circuit', () => {
    const {circuitArtifactSource} = require('../circuitArtifacts');
    for (const [id, version] of Object.entries(CIRCUIT_DATA_VERSIONS)) {
      // A circuit read from a pinned commit carries that source's version.
      expect(circuitDataVersion(id)).toBe(circuitArtifactSource(id)?.dataVersion ?? version);
    }
  });

  it('OIDC is at v6, the provider-key-statement circuit, in both tables', () => {
    const {circuitArtifactSource} = require('../circuitArtifacts');
    expect(CIRCUIT_DATA_VERSIONS.oidc_domain_attestation).toBe(6);
    expect(circuitArtifactSource('oidc_domain_attestation')?.dataVersion).toBe(6);
    expect(circuitDataVersion('oidc_domain_attestation')).toBe(6);
  });

  it('throws on an unknown circuit instead of answering 0', () => {
    // 0 would match an old cache written with the same fallback, and the
    // stale files would never be refreshed.
    expect(() => circuitDataVersion('not_a_circuit')).toThrow(/No CIRCUIT_DATA_VERSIONS entry for circuit 'not_a_circuit'/);
  });
});

describe('a tag change invalidates the circuit files on disk', () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const {cacheNeedsInvalidation} = require('../../utils/cacheInvalidation');
  const {CIRCUIT_DATA_VERSIONS} = require('../contracts');
  /* eslint-enable @typescript-eslint/no-var-requires */
  const v = CIRCUIT_DATA_VERSIONS.coinbase_attestation;

  it('files from another release are replaced', () => {
    expect(cacheNeedsInvalidation({
      stored: {baseUrl: `${RAW}/v1.3.0`, downloadedAt: 0, dataVersion: v},
      expectedVersion: v,
      currentBaseUrl: resolveCircuitBaseUrl('production'),
      hasCachedFiles: true,
    })).toBe(true);
  });

  it('files from this exact tag and version are kept', () => {
    expect(cacheNeedsInvalidation({
      stored: {baseUrl: `${RAW}/${TAG}`, downloadedAt: 0, dataVersion: v},
      expectedVersion: v,
      currentBaseUrl: resolveCircuitBaseUrl('production'),
      hasCachedFiles: true,
    })).toBe(false);
  });
});

describe('no code path asks for the latest release', () => {
  it('no source file under src names releases/latest or the GitHub API', () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const fs = require('node:fs');
    const path = require('node:path');
    /* eslint-enable @typescript-eslint/no-var-requires */
    const root = path.join(__dirname, '..', '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== '__tests__') walk(p);
        } else if (/\.(ts|tsx|js)$/.test(e.name)) {
          const text = fs.readFileSync(p, 'utf8');
          if (/releases\/latest|api\.github\.com\/repos/.test(text)) offenders.push(path.relative(root, p));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

describe('OIDC files come from the pinned circuits commit', () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const {cacheNeedsInvalidation} = require('../../utils/cacheInvalidation');
  const {OIDC_SIGNATURE_CIRCUITS_REF} = require('../circuitArtifacts');
  const {circuitDataVersion} = require('../../utils/circuitDownload');
  /* eslint-enable @typescript-eslint/no-var-requires */

  it('is a full commit SHA, not a branch that moves under an installed app', () => {
    expect(OIDC_SIGNATURE_CIRCUITS_REF).toMatch(/^[0-9a-f]{40}$/);
  });

  it.each(['development', 'staging', 'production'] as const)('%s reads it, and asks GitHub nothing', async env => {
    const fetchMock = github({});
    expect(await circuitBaseUrl('oidc_domain_attestation', env)).toBe(`${RAW}/${OIDC_SIGNATURE_CIRCUITS_REF}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['main, v5 (the circuit before the statement)', `${RAW}/main`, 5],
    ['the release tag, v5', `${RAW}/${TAG}`, 5],
    ['the pinned commit but v5', `${RAW}/5081cfda1ed00cfe9ec0aa20180338dc45f10670`, 5],
  ])('replaces OIDC files cached from %s', async (_l, baseUrl, dataVersion) => {
    expect(cacheNeedsInvalidation({
      stored: {baseUrl, downloadedAt: 0, dataVersion},
      expectedVersion: circuitDataVersion('oidc_domain_attestation'),
      currentBaseUrl: await circuitBaseUrl('oidc_domain_attestation', 'staging'),
      hasCachedFiles: true,
    })).toBe(true);
  });

  it('keeps OIDC files from the pinned commit at v6', async () => {
    expect(cacheNeedsInvalidation({
      stored: {baseUrl: `${RAW}/${OIDC_SIGNATURE_CIRCUITS_REF}`, downloadedAt: 0, dataVersion: 6},
      expectedVersion: circuitDataVersion('oidc_domain_attestation'),
      currentBaseUrl: await circuitBaseUrl('oidc_domain_attestation', 'production'),
      hasCachedFiles: true,
    })).toBe(false);
  });
});

/**
 * Where a build reads circuit data and verifier records from. Never guessed,
 * and never asked of GitHub.
 *
 * WHY THIS EXISTS. Production used to ask
 * `api.github.com/repos/zkproofport/circuits/releases/latest` at launch, so a
 * newly published circuits tag switched every installed app to new circuits
 * and verifiers -- apps whose input builders predate them included. Decided
 * 2026-10-27: each app version pins one exact tag (CIRCUITS_RELEASE_TAG) for
 * the official circuits; development and staging read `main`. Since
 * 2026-11-17 the Laboratory circuits read an exact commit everywhere, not
 * `main` -- GIWA_V2_CIRCUITS_REF since their v2 packages (2026-11-27) --
 * and since then no circuit reads a verifier record: every address is the
 * table core pins (everyCircuitIsReadFromAPinnedRef.test.ts). A pinned
 * tag that does not answer is an error naming the tag, never a fallback to
 * `main` or another release.
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
// Since Coinbase Country v2 (2026-10-30) no official circuit reads its files
// or its verifier record at the release tag: Coinbase KYC v2, Coinbase Country
// v2 and OIDC (provider-key statement) each read a pinned ref
// (circuitArtifacts.ts) and a configured address. The tag stays in the build
// for when those rows are folded into it; nothing reads it until then, which
// the cases below hold.

/* eslint-disable @typescript-eslint/no-var-requires */
const {
  resolveCircuitBaseUrl,
  fetchDeploymentAddress,
  getVerifierAddress,
  syncDeployments,
} = require('../deployments');
const {circuitBaseUrl} = require('../../utils/circuitDownload');
const {GIWA_V2_CIRCUITS_REF} = require('../circuitArtifacts');
const {CIRCUITS_RELEASE_TAG, CIRCUITS_WITH_BROADCAST, FALLBACK_VERIFIERS, STATIC_CONFIGS} = require('../contracts');
// Coinbase Country v2 reads OPRF_CIRCUITS_REF since the OPRF nullifier (GIWA
// and the Dojang Playground did too, until their v2 packages). It is empty until
// those circuits are pushed (everyCircuitIsReadFromAPinnedRef.test.ts holds
// that); these cases run the pinned-ref paths with a test commit in its place.
const OPRF_REF = 'c0ffee'.repeat(6) + 'c0ff';
require('../circuitArtifacts').__setOprfCircuitsRefForTests(OPRF_REF);
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

  it.each(['development', 'staging', 'production'] as const)(
    '%s reads Coinbase Country v2 files from its pinned ref, never the tag or main, and asks GitHub nothing',
    async env => {
      const fetchMock = github();
      const url = await circuitBaseUrl('coinbase_country_attestation', env).catch((e: Error) => e);
      if (OPRF_REF === '') {
        expect(url).toBeInstanceOf(Error);
        expect((url as Error).message).toBe('OPRF_CIRCUITS_REF is empty (src/config/circuitArtifacts.ts).');
      } else {
        expect(url).toBe(`${RAW}/${OPRF_REF}`);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('a whole production sync reads no record at all: every address is the table core pins', async () => {
    const fetchMock = github({
      ...releaseRecords(),
      // v1 GIWA records at every ref an older build read: answering, and still never asked.
      [`/${OPRF_REF}/broadcast/DeployGiwaAttestation.s.sol/91342/run-latest.json`]: '0xF6Edb9d6114B2546B6E559997fdDE08CAeEA83b3',
      [`/${GIWA_V2_CIRCUITS_REF}/broadcast/DeployGiwaAttestation.s.sol/91342/run-latest.json`]: '0xF6Edb9d6114B2546B6E559997fdDE08CAeEA83b3',
      '/main/broadcast/DeployGiwaAttestation.s.sol/91342/run-latest.json': '0xF6Edb9d6114B2546B6E559997fdDE08CAeEA83b3',
    });
    await expect(syncDeployments('production')).resolves.toBe(false);
    // GIWA and the Dojang Playground were the last circuits with a record
    // path; since v2 (2026-11-27) there is none, so nothing is fetched --
    // not main, not the tag, not the API.
    expect(CIRCUITS_WITH_BROADCAST).toEqual([]);
    expect(urlsOf(fetchMock)).toEqual([]);
  });

  it('a "latest" tag remembered by an older app version changes nothing', async () => {
    mockDisk.set('@proofport/deployment/release-tag', JSON.stringify({tag: 'v9.9.9', fetchedAt: Date.now()}));
    const fetchMock = github(releaseRecords());
    await syncDeployments('production').catch(() => undefined);
    for (const circuit of ['coinbase_attestation', 'coinbase_country_attestation', 'oidc_domain_attestation'] as const) {
      await fetchDeploymentAddress(circuit, 'production');
    }
    expect(urlsOf(fetchMock).some(u => u.includes('v9.9.9'))).toBe(false);
  });

  it('reads Coinbase Country v2 from its configured address, never a broadcast or an old cache', async () => {
    mockDisk.set('@proofport/deployment/production/coinbase_country_attestation', JSON.stringify({address: '0x1111111111111111111111111111111111111111'}));
    mockDisk.set(`@proofport/deployment/production/coinbase_country_attestation@${TAG}`, JSON.stringify({address: '0x8e89f11E65f219203f5bE9d6a69a4da084630C56'}));
    const fetchMock = github(releaseRecords());
    for (const env of ['development', 'staging', 'production'] as const) {
      expect(await fetchDeploymentAddress('coinbase_country_attestation', env)).toBeNull();
      expect(await getVerifierAddress('coinbase_country_attestation', env)).toBe(FALLBACK_VERIFIERS[env].coinbase_country_attestation);
    }
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('DeployCoinbaseCountryAttestation'))).toBe(false);
  });
});

describe('the pinned tag is missing', () => {
  it('cannot stop a production sync: no circuit reads a record at the tag', async () => {
    const fetchMock = github({[`/${OPRF_REF}/broadcast/DeployGiwaAttestation.s.sol/91342/run-latest.json`]: '0xf6edb9d6114b2546b6e559997fdde08caeea83b3'});
    await expect(syncDeployments('production')).resolves.toBe(false);
    expect(urlsOf(fetchMock).filter(u => u.startsWith(`${RAW}/${TAG}/`))).toEqual([]);
    expect(await fetchDeploymentAddress('giwa_attestation', 'production')).toBeNull();
    expect(await getVerifierAddress('giwa_attestation', 'production')).toBe(FALLBACK_VERIFIERS.production.giwa_attestation);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offline is not a missing tag: no error, built-in addresses answer', async () => {
    github({}, {offline: true});
    await expect(syncDeployments('production')).resolves.toBe(false);
    expect(await getVerifierAddress('coinbase_attestation', 'production')).toBe('0x6FC22d3576FB70457d1529B3F70f711A3cBA7A7F');
  });
});

describe('development and staging', () => {
  it.each(['development', 'staging'] as const)('%s keeps main for a circuit with no row, but the Laboratory circuits read their pinned commit', async env => {
    const fetchMock = github();
    expect(resolveCircuitBaseUrl(env)).toBe(`${RAW}/main`);
    for (const circuit of ['giwa_attestation', 'dojang_playground']) {
      expect(await circuitBaseUrl(circuit, env)).toBe(`${RAW}/${GIWA_V2_CIRCUITS_REF}`);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an unknown environment is an error, not production or main', () => {
    expect(() => resolveCircuitBaseUrl('prod')).toThrow(/Unknown environment 'prod'/);
  });
});

describe('the Laboratory circuits (not in any release tag)', () => {
  it.each(['giwa_attestation', 'dojang_playground'])('%s reads GIWA_V2_CIRCUITS_REF on a production build, with no tag, main or OPRF ref involved', async circuit => {
    const fetchMock = github({}, {offline: true});
    expect(await circuitBaseUrl(circuit, 'production')).toBe(`${RAW}/${GIWA_V2_CIRCUITS_REF}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('a verifier follows the circuit bytes', () => {
  // GIWA KYC v2's iPhone contract on GIWA Sepolia (2026-11-27), the app's
  // address in every environment, which core pins.
  const giwa = '0x55e7b9d9f2e9ac0080b668514ee01f15b686bfce';
  // v1 contracts (bb 6.0.0 OPRF-era, and older): they reject every v2 proof.
  const v1Giwa = '0xa272056866453f0182426a29b9ca6382d6c6a060';
  const oldGiwa = '0xeb9eb5452790cfe549ff83ceb3dbe1c432231492';

  // main answers with another address: reading it would be visible.
  const mainGiwa = '0x3333333333333333333333333333333333333333';
  function broadcasts(currentGiwa = v1Giwa) {
    return github({
      [`/${OPRF_REF}/broadcast/DeployGiwaAttestation.s.sol/91342/run-latest.json`]: currentGiwa,
      [`/${GIWA_V2_CIRCUITS_REF}/broadcast/DeployGiwaAttestation.s.sol/91342/run-latest.json`]: currentGiwa,
      '/main/broadcast/DeployGiwaAttestation.s.sol/91342/run-latest.json': mainGiwa,
      [`/${TAG}/broadcast/DeployGiwaAttestation.s.sol/91342/run-latest.json`]: oldGiwa,
    });
  }

  it.each(['development', 'staging', 'production'])('%s resolves GIWA and Dojang to their v2 configured addresses, never a broadcast (v1 records answer and are not asked)', async env => {
    const fetchMock = broadcasts();
    expect(await fetchDeploymentAddress('giwa_attestation', env)).toBeNull();
    expect(await fetchDeploymentAddress('dojang_playground', env)).toBeNull();
    expect((await getVerifierAddress('giwa_attestation', env)).toLowerCase()).toBe(giwa);
    expect((await getVerifierAddress('dojang_playground', env)).toLowerCase()).toBe('0xc1c42ade7c31afdf99fbaedf97da5b07fccba724');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads Coinbase KYC v2 from its configured address, never a broadcast or an old cache', async () => {
    const fetchMock = broadcasts();
    mockDisk.set('@proofport/deployment/staging/coinbase_attestation', JSON.stringify({address: '0x0036B61dBFaB8f3CfEEF77dD5D45F7EFBFE2035c'}));
    expect(await fetchDeploymentAddress('coinbase_attestation', 'staging')).toBeNull();
    expect(await getVerifierAddress('coinbase_attestation', 'staging')).toBe('0xe78fCDc7562ce3afCEadaF29f4b8B96DC997C01A');
    expect(await getVerifierAddress('coinbase_attestation', 'production')).toBe('0x6FC22d3576FB70457d1529B3F70f711A3cBA7A7F');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('DeployCoinbaseAttestation'))).toBe(false);
  });

  it('reads OIDC (provider-key statement) from its configured address, never a broadcast or an old cache', async () => {
    const fetchMock = broadcasts();
    mockDisk.set('@proofport/deployment/staging/oidc_domain_attestation', JSON.stringify({address: '0x003334A7C2ff15ee9ee845Ab88e152A2A3694167'}));
    expect(await fetchDeploymentAddress('oidc_domain_attestation', 'staging')).toBeNull();
    expect(await getVerifierAddress('oidc_domain_attestation', 'staging')).toBe('0x14a2241B0A24679825BeFAaa562d4A204262D84f');
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

  it('a v1 GIWA address cached by an earlier build, under any ref, is never read back', async () => {
    // v1 was refreshed from DeployGiwaAttestation records and cached under
    // `<id>@<ref>`; those contracts reject every v2 proof.
    for (const ref of ['9651df892c28fbeb9331ebc5358abfdf062c7c42', OPRF_REF, GIWA_V2_CIRCUITS_REF, 'main', TAG]) {
      mockDisk.set(`@proofport/deployment/production/giwa_attestation@${ref}`, JSON.stringify({address: v1Giwa}));
    }
    github({}, {offline: true});
    expect((await getVerifierAddress('giwa_attestation', 'production')).toLowerCase()).toBe(giwa);
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

  it('OIDC is at v9, the provider-key-statement circuit on Noir 1.0.0 / bb 6.0.0, in both tables', () => {
    const {circuitArtifactSource} = require('../circuitArtifacts');
    expect(CIRCUIT_DATA_VERSIONS.oidc_domain_attestation).toBe(9);
    expect(circuitArtifactSource('oidc_domain_attestation')?.dataVersion).toBe(9);
    expect(circuitDataVersion('oidc_domain_attestation')).toBe(9);
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
    ['the pinned commit at v6 (nargo 1.0.0-beta.19 / bb 4.2 files)', `${RAW}/5081cfda1ed00cfe9ec0aa20180338dc45f10670`, 6],
  ])('replaces OIDC files cached from %s', async (_l, baseUrl, dataVersion) => {
    expect(cacheNeedsInvalidation({
      stored: {baseUrl, downloadedAt: 0, dataVersion},
      expectedVersion: circuitDataVersion('oidc_domain_attestation'),
      currentBaseUrl: await circuitBaseUrl('oidc_domain_attestation', 'staging'),
      hasCachedFiles: true,
    })).toBe(true);
  });

  it('keeps OIDC files from the pinned commit at v9', async () => {
    expect(cacheNeedsInvalidation({
      stored: {baseUrl: `${RAW}/${OIDC_SIGNATURE_CIRCUITS_REF}`, downloadedAt: 0, dataVersion: 9},
      expectedVersion: circuitDataVersion('oidc_domain_attestation'),
      currentBaseUrl: await circuitBaseUrl('oidc_domain_attestation', 'production'),
      hasCachedFiles: true,
    })).toBe(false);
  });
});

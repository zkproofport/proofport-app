/**
 * Every circuit's files, and every verifier record the app reads, come from
 * an exact zkproofport/circuits ref -- a full commit or a version tag, the
 * same in every environment. Never `main`, never "latest".
 *
 * WHY THIS EXISTS. Until 2026-11-17 the Laboratory circuits (GIWA KYC, the
 * Dojang Playground) were read from circuits `main` in every build, release
 * builds included. A push to circuits main therefore changed what every
 * installed app downloaded, and the only thing standing in the way was the
 * cache version. From 2026-11-17 they read LAB_CIRCUITS_REF (circuitArtifacts.ts), the
 * main commit whose bytes were compared, file by file, with what main served
 * that day; then OPRF_CIRCUITS_REF (OPRF nullifier); and since 2026-11-27
 * (v2: the device status statement) three packages each, every one read from
 * GIWA_V2_CIRCUITS_REF. A Laboratory circuit without a row is an error naming it.
 */
// A module, so its top-level names do not collide with the other script-style tests under tsc.
export {};

const mockPlatform = {OS: 'ios'};
jest.mock('react-native', () => ({NativeModules: {}, Platform: mockPlatform}));

const mockDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => (mockDisk.has(k) ? mockDisk.get(k)! : null),
    setItem: async (k: string, v: string) => void mockDisk.set(k, v),
    removeItem: async (k: string) => void mockDisk.delete(k),
  },
}));

const mockDownloads: string[] = [];
jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    DocumentDirectoryPath: '/tmp/documents',
    MainBundlePath: '/tmp/bundle',
    exists: async () => false,
    mkdir: async () => {},
    unlink: async () => {},
    stat: async () => ({size: 10}),
    hash: async () => 'ff',
    stopDownload: () => {},
    downloadFile: (o: {fromUrl: string}) => {
      mockDownloads.push(o.fromUrl);
      return {jobId: 1, promise: Promise.resolve({statusCode: 200, bytesWritten: 10})};
    },
  },
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('node:fs');
const path = require('node:path');
const artifacts = require('../circuitArtifacts');
const {ALL_CIRCUIT_IDS, MAIN_BRANCH_CIRCUIT_IDS} = require('../circuitIds');
const {CIRCUITS_BRANCH, CIRCUIT_DATA_VERSIONS, FALLBACK_VERIFIERS} = require('../contracts');
const {circuitsRef, fetchDeploymentAddress, getVerifierAddress, syncDeployments} = require('../deployments');
const {__setAndroidChainKindForTests} = require('../signerPlatform');
const {circuitBaseUrl, downloadCircuitFiles, __resetCircuitManifestCache} = require('../../utils/circuitDownload');
const {cacheNeedsInvalidation} = require('../../utils/cacheInvalidation');
/* eslint-enable @typescript-eslint/no-var-requires */

const {
  GIWA_V2_CIRCUITS_REF,
  LAB_CIRCUITS_REF,
  OPRF_CIRCUITS_REF,
  CIRCUIT_ARTIFACT_SOURCES,
  hasPinnedArtifactSource,
  requireArtifactRef,
  sharedArtifactRef,
} = artifacts;

const RAW = 'https://raw.githubusercontent.com/zkproofport/circuits';
const ENVS = ['development', 'staging', 'production'] as const;
const LAB = ['giwa_attestation', 'dojang_playground'] as const;
const VARIANTS = ['app_attest', 'android', 'android_factory'] as const;
/** circuits main on 2026-11-17; every file the app fetched from main that day is byte-identical here. */
const VERIFIED_MAIN_COMMIT = '9651df892c28fbeb9331ebc5358abfdf062c7c42';
/** circuits 9993bc5: GIWA KYC / Dojang Playground v2, CI-built from 951f273 (2026-11-27). */
const GIWA_V2_COMMIT = '9993bc5d263b78817b637830ab093af9e0258c31';
/** A GIWA / Dojang URL must never contain one of these. */
const NOT_GIWA_V2 = ['/main/', '/main', `/${VERIFIED_MAIN_COMMIT}`, `/${OPRF_CIRCUITS_REF}`];
const GIWA_V2_PACKAGES = {
  giwa_attestation: {
    app_attest: ['giwa-attestation-v2/target', 'giwa_attestation_v2'],
    android: ['giwa-attestation-v2-android/target', 'giwa_attestation_v2_android'],
    android_factory: ['giwa-attestation-v2-android-factory/target', 'giwa_attestation_v2_android_factory'],
  },
  dojang_playground: {
    app_attest: ['dojang-playground-v2/target', 'dojang_playground_v2'],
    android: ['dojang-playground-v2-android/target', 'dojang_playground_v2_android'],
    android_factory: ['dojang-playground-v2-android-factory/target', 'dojang_playground_v2_android_factory'],
  },
} as const;

/** Put this phone on `variant` (iPhone, or Android with that chain kind). */
function onVariant(variant: (typeof VARIANTS)[number]): void {
  mockPlatform.OS = variant === 'app_attest' ? 'ios' : 'android';
  __setAndroidChainKindForTests(variant === 'app_attest' ? null : variant);
}

function github(records: Record<string, string> = {}, opts: {offline?: boolean} = {}) {
  const fetchMock = jest.fn(async (url: string) => {
    if (opts.offline) throw new Error('Network request failed');
    const address = records[url.replace(RAW, '')];
    if (!address) return {ok: false, status: 404, json: async () => ({}), text: async () => ''};
    return {ok: true, status: 200, json: async () => ({
      chain: 91342, timestamp: 1, commit: 'fixture', libraries: [],
      transactions: [{contractName: 'HonkVerifier', contractAddress: address}],
    })};
  });
  (globalThis as {fetch?: unknown}).fetch = fetchMock;
  return fetchMock;
}

beforeEach(() => {
  mockPlatform.OS = 'ios';
  __setAndroidChainKindForTests(null);
  mockDisk.clear();
  mockDownloads.length = 0;
  __resetCircuitManifestCache();
  delete (globalThis as {fetch?: unknown}).fetch;
});

describe('the pin', () => {
  it('LAB_CIRCUITS_REF is the full commit verified against main, not a branch', () => {
    expect(LAB_CIRCUITS_REF).toMatch(/^[0-9a-f]{40}$/);
    // Moving it is a release decision (app-dev.md "At release time"): change
    // this line together with the constant, after comparing the files.
    expect(LAB_CIRCUITS_REF).toBe(VERIFIED_MAIN_COMMIT);
    expect(LAB_CIRCUITS_REF).not.toBe(CIRCUITS_BRANCH);
  });

  it("LAB_CIRCUITS_REF (v1's files) is read by no row of any circuit since v2", () => {
    for (const id of ALL_CIRCUIT_IDS) {
      for (const v of VARIANTS) {
        expect([id, v, CIRCUIT_ARTIFACT_SOURCES[id][v].refName]).not.toEqual([id, v, 'LAB_CIRCUITS_REF']);
        expect([id, v, CIRCUIT_ARTIFACT_SOURCES[id][v].ref]).not.toEqual([id, v, LAB_CIRCUITS_REF]);
      }
    }
  });

  it('GIWA_V2_CIRCUITS_REF is the full CI-built commit, not a branch, LAB_CIRCUITS_REF or OPRF_CIRCUITS_REF', () => {
    // Moving it is a release decision: change this line together with the
    // constant, after checking the files against their SHA256SUMS.
    expect(GIWA_V2_CIRCUITS_REF).toBe(GIWA_V2_COMMIT);
    expect(GIWA_V2_CIRCUITS_REF).toMatch(/^[0-9a-f]{40}$/);
    expect([CIRCUITS_BRANCH, LAB_CIRCUITS_REF, OPRF_CIRCUITS_REF]).not.toContain(GIWA_V2_CIRCUITS_REF);
  });

  // v2 (2026-11-27): one package per statement signer, like Coinbase KYC v2.
  it.each(LAB)('%s has three packages, each its own files, every one read from GIWA_V2_CIRCUITS_REF', id => {
    const row = CIRCUIT_ARTIFACT_SOURCES[id];
    expect(row).toBeDefined();
    expect(new Set(VARIANTS.map(v => row[v])).size).toBe(3);
    for (const v of VARIANTS) {
      expect(row[v].variant).toBe(v);
      expect(row[v].ref).toBe(GIWA_V2_CIRCUITS_REF);
      expect(row[v].refName).toBe('GIWA_V2_CIRCUITS_REF');
      expect([row[v].basePath, row[v].remoteFileName]).toEqual(GIWA_V2_PACKAGES[id][v]);
      expect(row[v].vkPath).toBe(`${row[v].basePath}/vk`);
      // iPhone 2^20: one .srs. Android 2^21: three parts.
      expect(row[v].srsParts).toBe(v === 'app_attest' ? null : 3);
    }
    expect(new Set(VARIANTS.map(v => row[v].dataVersion)).size).toBe(3);
    expect(row.app_attest.dataVersion).toBe(CIRCUIT_DATA_VERSIONS[id]);
    expect(sharedArtifactRef(id)).toBe(GIWA_V2_CIRCUITS_REF);
  });

  it('GIWA and Dojang carry their v2 public-input counts on every package (133 / 101; 132 / 100 before)', () => {
    for (const v of VARIANTS) {
      expect(CIRCUIT_ARTIFACT_SOURCES.giwa_attestation[v].publicInputCount).toBe(133);
      expect(CIRCUIT_ARTIFACT_SOURCES.dojang_playground[v].publicInputCount).toBe(101);
    }
    expect(VARIANTS.map(v => CIRCUIT_ARTIFACT_SOURCES.giwa_attestation[v].dataVersion)).toEqual([6, 7, 8]);
    expect(VARIANTS.map(v => CIRCUIT_ARTIFACT_SOURCES.dojang_playground[v].dataVersion)).toEqual([5, 6, 7]);
  });
});

describe('every circuit, every variant, every environment', () => {
  it('the Laboratory list is exactly GIWA and the Dojang Playground (so the cases below are not vacuous)', () => {
    expect([...MAIN_BRANCH_CIRCUIT_IDS].sort()).toEqual([...LAB].sort());
  });

  it("every id in core's circuit list has a pinned row (a new circuit fails here until it has one)", () => {
    expect(ALL_CIRCUIT_IDS.length).toBeGreaterThanOrEqual(6);
    expect(ALL_CIRCUIT_IDS.filter((id: string) => !hasPinnedArtifactSource(id))).toEqual([]);
  });

  it('every row of every variant names a full commit or a version tag, never a branch (or is the empty OPRF ref, refused by name)', () => {
    const refs: string[] = [];
    for (const id of ALL_CIRCUIT_IDS) {
      for (const v of VARIANTS) {
        const row = CIRCUIT_ARTIFACT_SOURCES[id][v];
        if (row.refName === 'OPRF_CIRCUITS_REF' && row.ref === '') {
          expect(() => requireArtifactRef(row)).toThrow(/OPRF_CIRCUITS_REF is empty/);
          refs.push('');
          continue;
        }
        const ref = requireArtifactRef(row);
        refs.push(ref);
        expect(ref).toMatch(/^(?:[0-9a-f]{40}|v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)$/);
        expect(ref).not.toBe(CIRCUITS_BRANCH);
      }
    }
    expect(refs).toHaveLength(ALL_CIRCUIT_IDS.length * VARIANTS.length);
  });

  it.each(ENVS)('%s: no circuit base URL on this iPhone build is main or the environment ref', async env => {
    github();
    for (const id of ALL_CIRCUIT_IDS) {
      if (artifacts.circuitArtifactSource(id).ref === '') {
        await expect(circuitBaseUrl(id, env)).rejects.toThrow(/OPRF_CIRCUITS_REF is empty/);
        continue;
      }
      const url = await circuitBaseUrl(id, env);
      expect(url).not.toMatch(/\/main$|\/v2\.0\.0$/);
      expect(url).toBe(`${RAW}/${artifacts.circuitArtifactSource(id).ref}`);
    }
  });

  it.each(ENVS)('%s: GIWA and Dojang files, on every phone, are read from GIWA_V2_CIRCUITS_REF -- never main, LAB_CIRCUITS_REF or OPRF_CIRCUITS_REF', async env => {
    const fetchMock = github();
    for (const id of LAB) {
      for (const v of VARIANTS) {
        onVariant(v);
        mockDownloads.length = 0;
        __resetCircuitManifestCache();
        await expect(circuitBaseUrl(id, env)).resolves.toBe(`${RAW}/${GIWA_V2_CIRCUITS_REF}`);
        // iPhone: one .srs, downloaded whole. Android: three parts, never
        // joined without a SHA256SUMS (the fetch mock has none), so the
        // download stops after the json -- asked for at the right place.
        const run = downloadCircuitFiles(id, env, undefined, () => {});
        if (v === 'app_attest') await run;
        else await expect(run).rejects.toThrow(`No SHA256SUMS at ${RAW}/${GIWA_V2_CIRCUITS_REF}/${GIWA_V2_PACKAGES[id][v][0]}/SHA256SUMS`);
        const [dir, file] = GIWA_V2_PACKAGES[id][v];
        expect([id, v, mockDownloads[0]]).toEqual([id, v, `${RAW}/${GIWA_V2_CIRCUITS_REF}/${dir}/${file}.json`]);
        for (const url of mockDownloads) {
          expect([id, v, url.startsWith(`${RAW}/${GIWA_V2_CIRCUITS_REF}/`)]).toEqual([id, v, true]);
        }
      }
    }
    const fetched = fetchMock.mock.calls.map(([u]) => String(u));
    expect(fetched.length).toBeGreaterThan(0);
    for (const url of fetched) {
      expect(url.startsWith(`${RAW}/${GIWA_V2_CIRCUITS_REF}/`)).toBe(true);
      for (const bad of NOT_GIWA_V2) expect(url).not.toContain(bad);
    }
  });

  it.each(ENVS)('%s: GIWA and Dojang do not read OPRF_CIRCUITS_REF -- emptying it or making it a branch changes nothing about their files', async env => {
    github();
    for (const value of ['', 'main']) {
      artifacts.__setOprfCircuitsRefForTests(value);
      try {
        for (const id of LAB) {
          for (const v of VARIANTS) {
            onVariant(v);
            await expect(circuitBaseUrl(id, env)).resolves.toBe(`${RAW}/${GIWA_V2_CIRCUITS_REF}`);
          }
          expect(sharedArtifactRef(id)).toBe(GIWA_V2_CIRCUITS_REF);
          expect(circuitsRef(id, env)).toBe(GIWA_V2_CIRCUITS_REF);
        }
      } finally {
        artifacts.__setOprfCircuitsRefForTests(null);
      }
    }
  });
});

describe('verifier addresses for GIWA and Dojang come from the table, never a record', () => {
  it.each(ENVS)('%s: no record is fetched (BROADCAST_PATHS null), the address is the per-environment row, and a cached record is never read', async env => {
    const fetchMock = github();
    const {BROADCAST_PATHS} = require('../contracts'); // eslint-disable-line @typescript-eslint/no-var-requires
    for (const id of LAB) {
      expect(BROADCAST_PATHS[id]).toBeNull();
      // The ref the cache entry (getDeploymentInfo) is keyed by is the files'.
      expect(circuitsRef(id, env)).toBe(GIWA_V2_CIRCUITS_REF);
      await expect(fetchDeploymentAddress(id, env)).resolves.toBeNull();
      // A record cached by an earlier build (v1's contract) is never read.
      for (const ref of [LAB_CIRCUITS_REF, OPRF_CIRCUITS_REF, GIWA_V2_CIRCUITS_REF]) {
        mockDisk.set(`@proofport/deployment/${env}/${id}@${ref}`, JSON.stringify({address: '0x000000000000000000000000000000000000dead'}));
      }
      await expect(getVerifierAddress(id, env)).resolves.toBe(FALLBACK_VERIFIERS[env][id]);
    }
    await syncDeployments(env);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('a Laboratory circuit whose row is gone is an error, never main', () => {
  function withoutRow(id: string) {
    let mod: {circuitBaseUrl: (c: string, e: string) => Promise<string>; circuitsRef: (c: string, e: string) => string} | undefined;
    jest.isolateModules(() => {
      jest.doMock('../circuitArtifacts', () => {
        const actual = jest.requireActual('../circuitArtifacts');
        return {
          ...actual,
          circuitArtifactSource: (c: string) => (c === id ? undefined : actual.circuitArtifactSource(c)),
          hasPinnedArtifactSource: (c: string) => (c === id ? false : actual.hasPinnedArtifactSource(c)),
          sharedArtifactRef: (c: string) => (c === id ? undefined : actual.sharedArtifactRef(c)),
        };
      });
      mod = {
        circuitBaseUrl: require('../../utils/circuitDownload').circuitBaseUrl,
        circuitsRef: require('../deployments').circuitsRef,
      };
    });
    jest.dontMock('../circuitArtifacts');
    return mod!;
  }

  it.each(LAB.flatMap(id => ENVS.map(env => [id, env] as const)))('%s in %s', async (id, env) => {
    const m = withoutRow(id);
    await expect(m.circuitBaseUrl(id, env)).rejects.toThrow(new RegExp(`Laboratory circuit '${id}' has no pinned row in CIRCUIT_ARTIFACT_SOURCES.*never read from a branch`));
    expect(() => m.circuitsRef(id, env)).toThrow(new RegExp(`Laboratory circuit '${id}' has no pinned row in CIRCUIT_ARTIFACT_SOURCES.*never read from a branch`));
  });
});

describe('a ref that is not a commit or a tag is refused, naming its constant', () => {
  // A source shaped like the Laboratory rows, built here so a removed row
  // fails the cases above by assertion rather than this block at collection.
  const lab = {
    variant: 'app_attest', ref: LAB_CIRCUITS_REF, refName: 'LAB_CIRCUITS_REF',
    basePath: 'giwa-attestation/target', vkPath: 'giwa-attestation/target/vk', vkFileName: 'vk',
    remoteFileName: 'giwa_attestation', dataVersion: 4, publicInputCount: 192, srsParts: null,
  };

  it.each([
    ['main', /LAB_CIRCUITS_REF is 'main'.*branch/],
    ['oidc-signature', /LAB_CIRCUITS_REF is 'oidc-signature'/],
    ['refs/heads/main', /LAB_CIRCUITS_REF is 'refs\/heads\/main'/],
    ['latest', /LAB_CIRCUITS_REF is 'latest'/],
    ['9651df8', /LAB_CIRCUITS_REF is '9651df8'/],
    [VERIFIED_MAIN_COMMIT.toUpperCase(), /LAB_CIRCUITS_REF is '9651DF/],
    [` ${VERIFIED_MAIN_COMMIT}`, /LAB_CIRCUITS_REF is ' 9651df/],
    [`${VERIFIED_MAIN_COMMIT}\n`, /LAB_CIRCUITS_REF is '9651df/],
    ['v2.0.0/../main', /LAB_CIRCUITS_REF is 'v2.0.0\/..\/main'/],
    ['메인', /LAB_CIRCUITS_REF is '메인'/],
    ['', /^LAB_CIRCUITS_REF is empty/],
  ])('%j', (ref, message) => {
    expect(() => requireArtifactRef({...lab, ref})).toThrow(message);
  });

  it.each(['v2.0.0', 'v2.0.0-rc.1', VERIFIED_MAIN_COMMIT])('accepts %s', ref => {
    expect(requireArtifactRef({...lab, ref})).toBe(ref);
  });

  it('an Android package refuses a tag too: it must name a full commit', () => {
    for (const variant of ['android', 'android_factory']) {
      expect(() => requireArtifactRef({...lab, variant, ref: 'v2.0.0'})).toThrow(/LAB_CIRCUITS_REF is 'v2.0.0': set it to the 40-hex/);
      expect(requireArtifactRef({...lab, variant, ref: GIWA_V2_COMMIT})).toBe(GIWA_V2_COMMIT);
    }
  });

  it('the record ref runs the same check as the download, on every package', () => {
    for (const id of LAB) expect(sharedArtifactRef(id)).toBe(GIWA_V2_CIRCUITS_REF);
    // Coinbase KYC's three packages read OPRF_CIRCUITS_REF through a seam: a
    // branch there fails the shared ref by name, not only the download.
    expect(sharedArtifactRef('coinbase_attestation')).toBe(OPRF_CIRCUITS_REF);
    artifacts.__setOprfCircuitsRefForTests('main');
    try {
      expect(() => sharedArtifactRef('coinbase_attestation')).toThrow(/OPRF_CIRCUITS_REF is 'main'/);
      expect(() => circuitsRef('coinbase_attestation', 'production')).toThrow(/OPRF_CIRCUITS_REF is 'main'/);
    } finally {
      artifacts.__setOprfCircuitsRefForTests(null);
    }
    for (const id of ['nope', '__proto__', '']) expect(sharedArtifactRef(id)).toBeUndefined();
  });
});

describe('an id that is not a circuit', () => {
  it.each(['nope', '', '__proto__', 'constructor', 'GIWA_ATTESTATION', 'giwa-attestation', ' giwa_attestation', '기와', '../main'])(
    '%j is an error naming it, in the file URL and the record ref',
    async id => {
      for (const env of ENVS) {
        await expect(circuitBaseUrl(id, env)).rejects.toThrow(`Unknown circuit '${id}'`);
        expect(() => circuitsRef(id, env)).toThrow(`Unknown circuit '${id}'`);
      }
    },
  );
});

describe('no source builds a circuits URL at a branch', () => {
  it('nothing under src passes CIRCUITS_BRANCH or a literal branch to GITHUB_RAW', () => {
    const root = path.join(__dirname, '..', '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== '__tests__') walk(p);
        } else if (/\.(ts|tsx|js)$/.test(e.name)) {
          const text: string = fs.readFileSync(p, 'utf8');
          if (/GITHUB_RAW\(\s*(CIRCUITS_BRANCH|['"`]main['"`])/.test(text) || /zkproofport\/circuits\/main\//.test(text)) {
            offenders.push(path.relative(root, p));
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

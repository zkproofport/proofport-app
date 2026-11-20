/**
 * Every circuit's files, and every verifier record the app reads, come from
 * an exact zkproofport/circuits ref -- a full commit or a version tag, the
 * same in every environment. Never `main`, never "latest".
 *
 * WHY THIS EXISTS. Until 2026-11-17 the Laboratory circuits (GIWA KYC, the
 * Dojang Playground) were read from circuits `main` in every build, release
 * builds included. A push to circuits main therefore changed what every
 * installed app downloaded, and the only thing standing in the way was the
 * cache version. They now read LAB_CIRCUITS_REF (circuitArtifacts.ts), the
 * main commit whose bytes were compared, file by file, with what main served
 * that day. A Laboratory circuit without a row is an error naming it.
 */
// A module, so its top-level names do not collide with the other script-style tests under tsc.
export {};

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
const {circuitsRef, fetchDeploymentAddress, getVerifierAddress} = require('../deployments');
const {circuitBaseUrl, downloadCircuitFiles, __resetCircuitManifestCache} = require('../../utils/circuitDownload');
const {cacheNeedsInvalidation} = require('../../utils/cacheInvalidation');
/* eslint-enable @typescript-eslint/no-var-requires */

const {
  LAB_CIRCUITS_REF,
  CIRCUIT_ARTIFACT_SOURCES,
  hasPinnedArtifactSource,
  requireArtifactRef,
  signerIndependentArtifactRef,
} = artifacts;

const RAW = 'https://raw.githubusercontent.com/zkproofport/circuits';
const ENVS = ['development', 'staging', 'production'] as const;
const LAB = ['giwa_attestation', 'dojang_playground'] as const;
const VARIANTS = ['app_attest', 'android', 'android_factory'] as const;
/** circuits main on 2026-11-17; every file the app fetched from main that day is byte-identical here. */
const VERIFIED_MAIN_COMMIT = '9651df892c28fbeb9331ebc5358abfdf062c7c42';

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

  // Since the OPRF nullifier the Laboratory files (and their verifier
  // records) come from OPRF_CIRCUITS_REF; an empty one ends every read at an
  // error naming it.
  it.each(LAB)('%s has one row for every phone, read from OPRF_CIRCUITS_REF', id => {
    const row = CIRCUIT_ARTIFACT_SOURCES[id];
    expect(row).toBeDefined();
    for (const v of VARIANTS) {
      expect(row[v]).toBe(row.app_attest);
      expect(row[v].ref).toBe(artifacts.OPRF_CIRCUITS_REF);
      expect(row[v].refName).toBe('OPRF_CIRCUITS_REF');
    }
    expect(row.app_attest.dataVersion).toBe(CIRCUIT_DATA_VERSIONS[id]);
    expect(row.app_attest.srsParts).toBeNull();
  });

  it('GIWA and Dojang carry their OPRF public-input counts (132 / 100; 192 / 160 before)', () => {
    expect(CIRCUIT_ARTIFACT_SOURCES.giwa_attestation.app_attest.publicInputCount).toBe(132);
    expect(CIRCUIT_ARTIFACT_SOURCES.dojang_playground.app_attest.publicInputCount).toBe(100);
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

  it.each(ENVS)('%s: GIWA and Dojang files are read from OPRF_CIRCUITS_REF -- never main, never LAB_CIRCUITS_REF', async env => {
    github();
    expect(artifacts.OPRF_CIRCUITS_REF).toMatch(/^[0-9a-f]{40}$/);
    expect(artifacts.OPRF_CIRCUITS_REF).not.toBe(LAB_CIRCUITS_REF);
    for (const id of LAB) {
      await expect(circuitBaseUrl(id, env)).resolves.toBe(`${RAW}/${artifacts.OPRF_CIRCUITS_REF}`);
    }
  });

  it.each(ENVS)('%s: GIWA and Dojang download nothing when OPRF_CIRCUITS_REF is empty -- never main, never LAB_CIRCUITS_REF', async env => {
    const fetchMock = github();
    artifacts.__setOprfCircuitsRefForTests('');
    try {
      for (const id of LAB) {
        await expect(downloadCircuitFiles(id, env, undefined, () => {})).rejects.toThrow(/OPRF_CIRCUITS_REF is empty/);
      }
    } finally {
      artifacts.__setOprfCircuitsRefForTests(null);
    }
    expect(mockDownloads).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('verifier records follow the pinned files', () => {
  it.each(ENVS)('%s: a GIWA / Dojang verifier record is read from the files\' ref (OPRF_CIRCUITS_REF), never main or LAB_CIRCUITS_REF', async env => {
    const fetchMock = github();
    for (const id of LAB) {
      expect(circuitsRef(id, env)).toBe(artifacts.OPRF_CIRCUITS_REF);
      expect(circuitsRef(id, env)).not.toBe(LAB_CIRCUITS_REF);
    }
    expect(fetchMock.mock.calls.map(([u]) => String(u)).filter(u => u.includes('/main/'))).toEqual([]);
  });

  it.each(ENVS)('%s: a GIWA / Dojang verifier record is an error naming OPRF_CIRCUITS_REF when it is empty', env => {
    artifacts.__setOprfCircuitsRefForTests('');
    try {
      for (const id of LAB) expect(() => circuitsRef(id, env)).toThrow(/OPRF_CIRCUITS_REF is empty/);
    } finally {
      artifacts.__setOprfCircuitsRefForTests(null);
    }
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
          signerIndependentArtifactRef: (c: string) => (c === id ? undefined : actual.signerIndependentArtifactRef(c)),
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
    await expect(m.circuitBaseUrl(id, env)).rejects.toThrow(new RegExp(`Laboratory circuit '${id}' has no pinned row.*LAB_CIRCUITS_REF`));
    expect(() => m.circuitsRef(id, env)).toThrow(new RegExp(`Laboratory circuit '${id}' has no pinned row`));
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

  it('a branch-shaped Laboratory ref fails the record ref too, not only the download', () => {
    // signerIndependentArtifactRef runs the same check as the download.
    for (const id of LAB) expect(signerIndependentArtifactRef(id)).toBe(artifacts.OPRF_CIRCUITS_REF);
    artifacts.__setOprfCircuitsRefForTests('main');
    try {
      for (const id of LAB) expect(() => signerIndependentArtifactRef(id)).toThrow(/OPRF_CIRCUITS_REF is 'main'/);
    } finally {
      artifacts.__setOprfCircuitsRefForTests(null);
    }
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

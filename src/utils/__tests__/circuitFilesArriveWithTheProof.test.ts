/**
 * A circuit's files are fetched when a proof of that circuit starts, and only
 * that circuit's (user, 2026-10-29: "circuits must be downloaded only when
 * needed"). These cases hold the download itself to that:
 *
 *   - the first proof of a circuit fetches its files and nothing else;
 *   - the second uses the cache (no request at all);
 *   - a file whose sha256 is wrong is refused, retried, and never kept;
 *   - a connection that drops mid-file is retried; one that keeps dropping
 *     ends in an error that names the file, leaves nothing unverified, and a
 *     later attempt resumes from the parts that did verify;
 *   - two circuits keep separate files, and two proofs of one circuit share
 *     one download;
 *   - launch and the Laboratory switch download nothing (static check).
 *
 * The filesystem is an in-memory RNFS; the Android circuits' ref is a test
 * commit.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const mockFiles = new Map<string, Buffer>();
const mockServed = new Map<string, {status: number; body: Buffer}>();
/** URL -> how many more requests for it drop mid-transfer. */
const mockDrops = new Map<string, number>();
/** URL -> how many more requests for it deliver a truncated body with 200. */
const mockTruncate = new Map<string, number>();
const mockRequests: string[] = [];
const mockDisk = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => (mockDisk.has(k) ? mockDisk.get(k)! : null),
    setItem: async (k: string, v: string) => void mockDisk.set(k, v),
    removeItem: async (k: string) => void mockDisk.delete(k),
  },
}));
jest.mock('react-native-fs', () => {
  const nodeCrypto = jest.requireActual('node:crypto');
  const missing = (p: string) => Object.assign(new Error(`ENOENT: ${p}`), {code: 'ENOENT'});
  return {
    __esModule: true,
    default: {
      DocumentDirectoryPath: '/docs',
      MainBundlePath: '/bundle',
      exists: async (p: string) => p === '/docs/circuits' || mockFiles.has(p),
      mkdir: async () => {},
      unlink: async (p: string) => {
        if (!mockFiles.delete(p)) throw missing(p);
      },
      stat: async (p: string) => {
        const f = mockFiles.get(p);
        if (!f) throw missing(p);
        return {size: f.length};
      },
      hash: async (p: string) => {
        const f = mockFiles.get(p);
        if (!f) throw missing(p);
        return nodeCrypto.createHash('sha256').update(f).digest('hex');
      },
      writeFile: async (p: string, data: string) => void mockFiles.set(p, Buffer.from(data, 'base64')),
      appendFile: async (p: string, data: string) => {
        const f = mockFiles.get(p);
        if (!f) throw missing(p);
        mockFiles.set(p, Buffer.concat([f, Buffer.from(data, 'base64')]));
      },
      // What the iPhone throws; the join reads through fileRange.ts.
      read: async () => {
        throw new Error(jest.requireActual('./fixtures/memoryExpoFile').IOS_RNFS_READ_ERROR);
      },
      moveFile: async (from: string, to: string) => {
        const f = mockFiles.get(from);
        if (!f) throw missing(from);
        mockFiles.delete(from);
        mockFiles.set(to, f);
      },
      stopDownload: () => {},
      downloadFile: (o: {fromUrl: string; toFile: string; progress?: (r: {bytesWritten: number; contentLength: number}) => void}) => {
        mockRequests.push(o.fromUrl);
        const served = mockServed.get(o.fromUrl) ?? {status: 404, body: Buffer.from('404: Not Found')};
        const drops = mockDrops.get(o.fromUrl) ?? 0;
        if (drops > 0) {
          mockDrops.set(o.fromUrl, drops - 1);
          // Half the body written, then the connection is gone.
          mockFiles.set(o.toFile, served.body.subarray(0, served.body.length >> 1));
          return {jobId: 1, promise: Promise.reject(new Error('Software caused connection abort'))};
        }
        const truncate = mockTruncate.get(o.fromUrl) ?? 0;
        const body = truncate > 0 ? served.body.subarray(0, served.body.length - 1) : served.body;
        if (truncate > 0) mockTruncate.set(o.fromUrl, truncate - 1);
        mockFiles.set(o.toFile, body);
        o.progress?.({bytesWritten: body.length, contentLength: served.body.length});
        return {jobId: 1, promise: Promise.resolve({statusCode: served.status, bytesWritten: body.length})};
      },
    },
  };
});
jest.mock('expo-file-system', () => jest.requireActual('./fixtures/memoryExpoFile').memoryExpoFile(() => mockFiles));
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'android'}}));
const TEST_REF = 'cd'.repeat(20);
jest.mock('../../config/circuitArtifacts', () => {
  const actual = jest.requireActual('../../config/circuitArtifacts');
  return {
    ...actual,
    circuitArtifactSource: (c: string) => {
      const s = actual.circuitArtifactSource(c);
      return s && s.variant === 'android' ? {...s, ref: 'cd'.repeat(20)} : s;
    },
  };
});

/* eslint-disable @typescript-eslint/no-var-requires */
const {downloadCircuitFiles, __resetCircuitManifestCache, __setDownloadRetryDelaysForTests} = require('../circuitDownload');
const {__setAndroidChainKindForTests} = require('../../config/signerPlatform');
/* eslint-enable @typescript-eslint/no-var-requires */

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const RAW = `https://raw.githubusercontent.com/zkproofport/circuits/${TEST_REF}`;

const CIRCUITS = {
  coinbase_attestation: {dir: 'coinbase-attestation-v2-android', pkg: 'coinbase_attestation_v2_android'},
  oidc_domain_attestation: {dir: 'oidc-domain-attestation-android', pkg: 'oidc_domain_attestation_android'},
} as const;
type Id = keyof typeof CIRCUITS;

/** Publish one circuit: json, three .srs parts with SHA256SUMS, vk. */
function publish(id: Id, opts: {wrongJsonDigest?: boolean} = {}) {
  const {dir, pkg} = CIRCUITS[id];
  const base = `${RAW}/${dir}/target`;
  const seed = id.length;
  const parts = [3000, 2000, 7].map((n, i) => Buffer.alloc(n).map((_v, j) => (j * 7 + i + seed) & 0xff) as Buffer);
  const json = Buffer.from(`{"abi":{},"circuit":"${id}"}`);
  const vk = Buffer.from(`vk-of-${id}`);
  parts.forEach((p, i) => mockServed.set(`${base}/${pkg}.srs.part${i}`, {status: 200, body: p}));
  mockServed.set(`${base}/${pkg}.json`, {status: 200, body: json});
  mockServed.set(`${base}/vk/vk`, {status: 200, body: vk});
  const lines = [
    `${opts.wrongJsonDigest ? '0'.repeat(64) : sha(json)}  ${pkg}.json`,
    `${sha(Buffer.concat(parts))}  ${pkg}.srs`,
    ...parts.map((p, i) => `${sha(p)}  ${pkg}.srs.part${i}`),
  ];
  mockServed.set(`${base}/SHA256SUMS`, {status: 200, body: Buffer.from(lines.join('\n') + '\n')});
  mockServed.set(`${base}/vk/SHA256SUMS`, {status: 200, body: Buffer.from(`${sha(vk)}  vk\n`)});
  return {base, pkg, json, vk, joined: Buffer.concat(parts), parts};
}

const fileOf = (id: Id, ext: string) => `/docs/circuits/${id}.${ext}`;

async function download(id: Id): Promise<{error?: Error; logs: string[]}> {
  const logs: string[] = [];
  try {
    await downloadCircuitFiles(id, 'production', undefined, (m: string) => logs.push(m));
    return {logs};
  } catch (e) {
    return {error: e as Error, logs};
  }
}

beforeEach(() => {
  __setAndroidChainKindForTests('android');
  __setDownloadRetryDelaysForTests([0]);
  mockFiles.clear();
  mockServed.clear();
  mockDrops.clear();
  mockTruncate.clear();
  mockRequests.length = 0;
  mockDisk.clear();
  __resetCircuitManifestCache();
  (globalThis as {fetch?: unknown}).fetch = jest.fn(async (url: string) => {
    const s = mockServed.get(url);
    return {ok: s?.status === 200, status: s?.status ?? 404, text: async () => (s ? s.body.toString() : '')};
  });
});

describe('a proof fetches its own circuit, once', () => {
  it('the first proof downloads that circuit and no other', async () => {
    const c = publish('coinbase_attestation');
    publish('oidc_domain_attestation');
    expect((await download('coinbase_attestation')).error).toBeUndefined();
    expect(mockRequests.every(u => u.startsWith(c.base))).toBe(true);
    expect(mockRequests).toHaveLength(5);
    expect(mockFiles.get(fileOf('coinbase_attestation', 'srs'))?.equals(c.joined)).toBe(true);
    expect([...mockFiles.keys()].some(k => k.includes('oidc'))).toBe(false);
  });

  it('the second proof of the same circuit uses the cache: no request at all', async () => {
    publish('coinbase_attestation');
    await download('coinbase_attestation');
    mockRequests.length = 0;
    const {error, logs} = await download('coinbase_attestation');
    expect(error).toBeUndefined();
    expect(mockRequests).toEqual([]);
    expect(logs.filter(l => l.endsWith('already exists'))).toHaveLength(3);
  });

  it('a cached, hash-valid circuit is never fetched again, not even its checksum list', async () => {
    publish('oidc_domain_attestation');
    await download('oidc_domain_attestation');
    mockRequests.length = 0;
    (globalThis.fetch as jest.Mock).mockClear();
    for (let i = 0; i < 3; i++) expect((await download('oidc_domain_attestation')).error).toBeUndefined();
    expect(mockRequests).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('an app update with unchanged circuits downloads nothing (a fresh process, same files on disk)', async () => {
    publish('oidc_domain_attestation');
    await download('oidc_domain_attestation');
    mockRequests.length = 0;
    (globalThis.fetch as jest.Mock).mockClear();
    let fresh: {downloadCircuitFiles: typeof downloadCircuitFiles} | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../../config/signerPlatform').__setAndroidChainKindForTests('android');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      fresh = require('../circuitDownload');
    });
    await fresh!.downloadCircuitFiles('oidc_domain_attestation', 'production', undefined, () => {});
    expect(mockRequests).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('two circuits keep their own files, and the second does not touch the first', async () => {
    const c = publish('coinbase_attestation');
    const o = publish('oidc_domain_attestation');
    await download('coinbase_attestation');
    mockRequests.length = 0;
    expect((await download('oidc_domain_attestation')).error).toBeUndefined();
    expect(mockRequests.every(u => u.startsWith(o.base))).toBe(true);
    expect(mockFiles.get(fileOf('coinbase_attestation', 'srs'))?.equals(c.joined)).toBe(true);
    expect(mockFiles.get(fileOf('oidc_domain_attestation', 'srs'))?.equals(o.joined)).toBe(true);
    expect(mockFiles.get(fileOf('oidc_domain_attestation', 'vk'))?.equals(o.vk)).toBe(true);
  });

  it('two proofs of one circuit at once share one download', async () => {
    publish('oidc_domain_attestation');
    const [a, b] = await Promise.all([download('oidc_domain_attestation'), download('oidc_domain_attestation')]);
    expect(a.error).toBeUndefined();
    expect(b.error).toBeUndefined();
    expect(mockRequests).toHaveLength(5);
    expect(b.logs.join('\n')).toMatch(/a download is already running; waiting for it/);
  });
});

describe('a file that does not verify is never kept', () => {
  it('a json whose sha256 is wrong is refused after every attempt, and not left on the phone', async () => {
    const c = publish('coinbase_attestation', {wrongJsonDigest: true});
    const {error} = await download('coinbase_attestation');
    expect(error?.message).toMatch(/coinbase_attestation\.json failed verification \(digest-mismatch\)/);
    expect(mockRequests.filter(u => u === `${c.base}/${c.pkg}.json`)).toHaveLength(3);
    expect(mockFiles.has(fileOf('coinbase_attestation', 'json'))).toBe(false);
  });

  it('a body cut short once (200, one byte missing) is fetched again and then kept', async () => {
    const c = publish('coinbase_attestation');
    mockTruncate.set(`${c.base}/${c.pkg}.srs.part1`, 1);
    expect((await download('coinbase_attestation')).error).toBeUndefined();
    expect(mockFiles.get(fileOf('coinbase_attestation', 'srs'))?.equals(c.joined)).toBe(true);
  });
});

describe('a flaky network', () => {
  it('one dropped connection is retried and the proof gets its files', async () => {
    const c = publish('oidc_domain_attestation');
    mockDrops.set(`${c.base}/${c.pkg}.json`, 1);
    mockDrops.set(`${c.base}/${c.pkg}.srs.part0`, 2);
    const {error, logs} = await download('oidc_domain_attestation');
    expect(error).toBeUndefined();
    expect(logs.join('\n')).toMatch(/Retrying oidc_domain_attestation_android\.srs\.part0 .*attempt 3 of 3/);
    expect(mockFiles.get(fileOf('oidc_domain_attestation', 'srs'))?.equals(c.joined)).toBe(true);
  });

  it('a connection that keeps dropping ends in an error naming the file, leaves nothing unverified, and the next attempt resumes', async () => {
    const c = publish('oidc_domain_attestation');
    const part1 = `${c.base}/${c.pkg}.srs.part1`;
    mockDrops.set(part1, 3);
    const first = await download('oidc_domain_attestation');
    expect(first.error?.message).toBe('Software caused connection abort');
    expect(first.logs.join('\n')).toMatch(/oidc_domain_attestation_android\.srs\.part1 failed: Software caused connection abort/);
    // No half-written part, no joined file, no destination.
    const srs = fileOf('oidc_domain_attestation', 'srs');
    expect(mockFiles.has(`${srs}.part1`)).toBe(false);
    expect(mockFiles.has(`${srs}.joining`)).toBe(false);
    expect(mockFiles.has(srs)).toBe(false);
    // The part that verified is kept for the retry.
    expect(mockFiles.get(`${srs}.part0`)?.equals(c.parts[0])).toBe(true);

    mockRequests.length = 0;
    const second = await download('oidc_domain_attestation');
    expect(second.error).toBeUndefined();
    expect(second.logs.join('\n')).toMatch(/Kept oidc_domain_attestation_android\.srs\.part0 from an earlier download/);
    expect(mockRequests).not.toContain(`${c.base}/${c.pkg}.srs.part0`);
    expect(mockFiles.get(srs)?.equals(c.joined)).toBe(true);
    expect([...mockFiles.keys()].filter(k => /\.srs\.(part\d|joining)$/.test(k))).toEqual([]);
  });

  it('a kept part that no longer matches the manifest is fetched again', async () => {
    const c = publish('oidc_domain_attestation');
    const srs = fileOf('oidc_domain_attestation', 'srs');
    mockFiles.set(`${srs}.part0`, Buffer.from('a part of something else'));
    expect((await download('oidc_domain_attestation')).error).toBeUndefined();
    expect(mockRequests).toContain(`${c.base}/${c.pkg}.srs.part0`);
    expect(mockFiles.get(srs)?.equals(c.joined)).toBe(true);
  });

  it('a 404 is an answer, not a flake: one request, no retry', async () => {
    const c = publish('coinbase_attestation');
    mockServed.delete(`${c.base}/vk/vk`);
    const {error} = await download('coinbase_attestation');
    expect(error?.message).toMatch(/HTTP 404/);
    expect(mockRequests.filter(u => u === `${c.base}/vk/vk`)).toHaveLength(1);
  });

  it('a 503 is retried', async () => {
    const c = publish('coinbase_attestation');
    mockServed.set(`${c.base}/vk/vk`, {status: 503, body: Buffer.from('busy')});
    const {error} = await download('coinbase_attestation');
    expect(error?.message).toMatch(/HTTP 503/);
    expect(mockRequests.filter(u => u === `${c.base}/vk/vk`)).toHaveLength(3);
  });
});

describe('nothing downloads ahead of a proof', () => {
  const SRC = path.join(__dirname, '..', '..');
  const ROOT = path.join(SRC, '..');
  const ALLOWED = new Set([
    'utils/circuitDownload.ts', // the download itself
    'utils/proofRun.ts', // the one caller, used by every proof hook
    'utils/index.ts', // re-export
  ]);

  function sources(dir: string): string[] {
    return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }

  it('only proofRun.ts calls downloadCircuitFiles; launch and More do not', () => {
    const callers = sources(SRC)
      .filter(f => /downloadCircuitFiles\(/.test(fs.readFileSync(f, 'utf8')))
      .map(f => path.relative(SRC, f).split(path.sep).join('/'))
      .filter(f => !ALLOWED.has(f));
    expect(callers).toEqual([]);
    expect(fs.readFileSync(path.join(ROOT, 'App.tsx'), 'utf8')).not.toMatch(/downloadCircuitFiles/);
  });

  it.each(['useOidcDomain', 'useCoinbaseKyc', 'useCoinbaseCountry', 'useGiwaKyc', 'useDojangPlayground', 'useHumanPassport'])(
    '%s fetches its circuit at the start of every proof, unconditionally',
    hook => {
      const source = fs.readFileSync(path.join(SRC, 'hooks', `${hook}.ts`), 'utf8');
      expect(source).toMatch(/\n\s*await circuitFilesForProof\(\w+, addLog\);/);
      expect(source).not.toMatch(/allCircuitFilesExist/);
      expect(source).not.toMatch(/generateNoirProof\(/);
      expect(source).toMatch(/await proveCircuit\(\{/);
    },
  );
});

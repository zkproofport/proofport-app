/**
 * A 2^21 .srs is over GitHub's file limit, so the Android circuits publish
 * it in parts with SHA256SUMS listing every part and the joined file.
 * circuitDownload.ts must: fetch each part, check its sha256, append it to
 * the joined file in bounded chunks (never the whole file in JS at once),
 * check the joined sha256, and only then put it at `<id>.srs`. Any failure
 * deletes every part, the half-joined file and the destination -- a later
 * launch must never find a file to trust.
 *
 * The filesystem is an in-memory RNFS; the circuits ref is set to a test
 * commit (the real ANDROID_SIGNATURE_CIRCUITS_REF is filled in when CI has
 * built the files).
 */
import * as crypto from 'node:crypto';

const mockFiles = new Map<string, Buffer>();
const mockServed = new Map<string, {status: number; body: Buffer}>();
const mockReads: Array<{path: string; length: number; position: number}> = [];
const mockHashFails = new Set<string>();
const mockSizeOverride = new Map<string, number>();
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
        return {size: mockSizeOverride.get(p) ?? f.length};
      },
      hash: async (p: string) => {
        if (mockHashFails.has(p)) throw new Error('out of memory');
        const f = mockFiles.get(p);
        if (!f) throw missing(p);
        return nodeCrypto.createHash('sha256').update(f).digest('hex');
      },
      writeFile: async (p: string, data: string, enc: string) => {
        if (enc !== 'base64') throw new Error(`unexpected encoding ${enc}`);
        mockFiles.set(p, Buffer.from(data, 'base64'));
      },
      appendFile: async (p: string, data: string, enc: string) => {
        if (enc !== 'base64') throw new Error(`unexpected encoding ${enc}`);
        const f = mockFiles.get(p);
        if (!f) throw missing(p);
        mockFiles.set(p, Buffer.concat([f, Buffer.from(data, 'base64')]));
      },
      read: async (p: string, length: number, position: number, enc: string) => {
        if (enc !== 'base64') throw new Error(`unexpected encoding ${enc}`);
        const f = mockFiles.get(p);
        if (!f) throw missing(p);
        mockReads.push({path: p, length, position});
        return f.subarray(position, position + length).toString('base64');
      },
      moveFile: async (from: string, to: string) => {
        const f = mockFiles.get(from);
        if (!f) throw missing(from);
        mockFiles.delete(from);
        mockFiles.set(to, f);
      },
      stopDownload: () => {},
      downloadFile: (o: {fromUrl: string; toFile: string; progress?: (r: {bytesWritten: number; contentLength: number}) => void}) => {
        const served = mockServed.get(o.fromUrl) ?? {status: 404, body: Buffer.from('404: Not Found')};
        mockFiles.set(o.toFile, served.body);
        o.progress?.({bytesWritten: served.body.length, contentLength: served.body.length});
        return {jobId: 1, promise: Promise.resolve({statusCode: served.status, bytesWritten: served.body.length})};
      },
    },
  };
});
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'android'}}));
const TEST_REF = 'ab'.repeat(20);
jest.mock('../../config/circuitArtifacts', () => {
  const actual = jest.requireActual('../../config/circuitArtifacts');
  return {
    ...actual,
    // The Android rows as they will be once the commit is filled in.
    circuitArtifactSource: (c: string) => {
      const s = actual.circuitArtifactSource(c);
      return s && s.variant === 'android' ? {...s, ref: 'ab'.repeat(20)} : s;
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {downloadCircuitFiles, SRS_JOIN_CHUNK_BYTES, __resetCircuitManifestCache} = require('../circuitDownload');

const BASE = `https://raw.githubusercontent.com/zkproofport/circuits/${TEST_REF}/coinbase-attestation-v2-android/target`;
const NAME = 'coinbase_attestation_v2_android';
const DEST = '/docs/circuits/coinbase_attestation.srs';
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const MiB = 1024 * 1024;

/** Three parts of the given sizes, with recognisable bytes, served with a manifest. */
function publish(sizes = [9 * MiB + 5, 4 * MiB, 212], tweak: {manifest?: (lines: string[]) => string[]} = {}) {
  const parts = sizes.map((n, i) => Buffer.alloc(n, i + 1).map((_v, j) => (j * 31 + i) & 0xff) as Buffer);
  const joined = Buffer.concat(parts);
  parts.forEach((p, i) => mockServed.set(`${BASE}/${NAME}.srs.part${i}`, {status: 200, body: p}));
  const json = Buffer.from('{"abi":{}}');
  const vk = Buffer.from('vk-bytes');
  mockServed.set(`${BASE}/${NAME}.json`, {status: 200, body: json});
  mockServed.set(`${BASE}/vk/vk`, {status: 200, body: vk});
  let lines = [
    `${sha(json)}  ${NAME}.json`,
    `${sha(joined)}  ${NAME}.srs`,
    ...parts.map((p, i) => `${sha(p)}  ${NAME}.srs.part${i}`),
  ];
  if (tweak.manifest) lines = tweak.manifest(lines);
  mockServed.set(`${BASE}/SHA256SUMS`, {status: 200, body: Buffer.from(lines.join('\n') + '\n')});
  mockServed.set(`${BASE}/vk/SHA256SUMS`, {status: 200, body: Buffer.from(`${sha(vk)}  vk\n`)});
  return {parts, joined};
}

const leftovers = () => [...mockFiles.keys()].filter(p => /\.srs\.(part\d+|joining)$/.test(p));

beforeEach(() => {
  mockFiles.clear();
  mockServed.clear();
  mockReads.length = 0;
  mockHashFails.clear();
  mockSizeOverride.clear();
  mockDisk.clear();
  __resetCircuitManifestCache();
  (globalThis as {fetch?: unknown}).fetch = jest.fn(async (url: string) => {
    const s = mockServed.get(url);
    return {ok: s?.status === 200, status: s?.status ?? 404, text: async () => (s ? s.body.toString() : '')};
  });
});

async function download(): Promise<{error?: Error; logs: string[]}> {
  const logs: string[] = [];
  try {
    await downloadCircuitFiles('coinbase_attestation', 'production', undefined, (m: string) => logs.push(m));
    return {logs};
  } catch (e) {
    return {error: e as Error, logs};
  }
}

describe('a .srs published in parts', () => {
  it('is fetched part by part, joined in bounded chunks, and checked whole', async () => {
    const {joined} = publish();
    const {error, logs} = await download();
    expect(error).toBeUndefined();
    expect(mockFiles.get(DEST)?.equals(joined)).toBe(true);
    expect(leftovers()).toEqual([]);
    // 9 MiB + 5 -> 3 reads; 4 MiB -> 1; 212 bytes -> 1. Never more than a chunk at once.
    expect(SRS_JOIN_CHUNK_BYTES).toBe(4 * MiB);
    expect(mockReads.map(r => r.length)).toEqual([4 * MiB, 4 * MiB, MiB + 5, 4 * MiB, 212]);
    expect(mockReads.map(r => r.position)).toEqual([0, 4 * MiB, 8 * MiB, 0, 0]);
    expect(Math.max(...mockReads.map(r => r.length))).toBeLessThanOrEqual(SRS_JOIN_CHUNK_BYTES);
    expect(logs.join('\n')).toMatch(/Joined coinbase_attestation\.srs from 3 parts: \d+ bytes \(verified: sha256\)/);
    expect(mockFiles.has('/docs/circuits/coinbase_attestation.json')).toBe(true);
    expect(mockFiles.has('/docs/circuits/coinbase_attestation.vk')).toBe(true);
  });

  it('requests the parts from the pinned commit, under the package name', async () => {
    publish();
    const requested: string[] = [];
    const RNFS = jest.requireMock('react-native-fs').default;
    const original = RNFS.downloadFile;
    RNFS.downloadFile = (o: {fromUrl: string}) => {
      requested.push(o.fromUrl);
      return original(o);
    };
    try {
      await download();
    } finally {
      RNFS.downloadFile = original;
    }
    expect(requested).toEqual([
      `${BASE}/${NAME}.json`,
      `${BASE}/${NAME}.srs.part0`,
      `${BASE}/${NAME}.srs.part1`,
      `${BASE}/${NAME}.srs.part2`,
      `${BASE}/vk/vk`,
    ]);
  });

  it.each([
    ['a part whose sha256 does not match', () => publish(undefined, {manifest: l => l.map(x => (x.endsWith('.part1') ? `${'0'.repeat(64)}  ${NAME}.srs.part1` : x))}), /srs\.part1 failed verification \(digest-mismatch\)/],
    ['a joined file whose sha256 does not match', () => publish(undefined, {manifest: l => l.map(x => (x.endsWith('.srs') ? `${'1'.repeat(64)}  ${NAME}.srs` : x))}), /Joined coinbase_attestation\.srs failed verification \(digest-mismatch\)/],
    ['a manifest without a line for a part', () => publish(undefined, {manifest: l => l.filter(x => !x.endsWith('.part2'))}), /has no sha256 for coinbase_attestation_v2_android\.srs\.part2/],
    ['a manifest without the joined line', () => publish(undefined, {manifest: l => l.filter(x => !x.endsWith('.srs'))}), /has no sha256 for coinbase_attestation_v2_android\.srs$/],
    ['no manifest at all', () => {
      publish();
      mockServed.delete(`${BASE}/SHA256SUMS`);
    }, /No SHA256SUMS at .*: a \.srs published in parts is never joined unchecked/],
    ['a part that is not there (404)', () => {
      publish();
      mockServed.delete(`${BASE}/${NAME}.srs.part2`);
    }, new RegExp(`HTTP 404 from ${BASE}/${NAME}\\.srs\\.part2 -- circuits ref ${TEST_REF}`)],
    ['a part the phone cannot hash', () => {
      publish();
      mockHashFails.add(`${DEST}.part0`);
    }, /part0 could not be hashed; a part is joined only after its sha256 matched/],
    ['a joined file the phone cannot hash', () => {
      publish();
      mockHashFails.add(`${DEST}.joining`);
    }, /Joined coinbase_attestation\.srs could not be hashed/],
  ])('%s is refused, and nothing is left behind', async (_l, arrange, message) => {
    arrange();
    const {error} = await download();
    expect(error?.message).toMatch(message);
    expect(mockFiles.has(DEST)).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('a part over 64 MiB is refused', async () => {
    publish();
    const RNFS = jest.requireMock('react-native-fs').default;
    const original = RNFS.downloadFile;
    RNFS.downloadFile = (o: {fromUrl: string; toFile: string}) => {
      const r = original(o);
      if (o.toFile.endsWith('.part1')) mockSizeOverride.set(o.toFile, 64 * MiB + 1);
      return r;
    };
    try {
      const {error} = await download();
      expect(error?.message).toMatch(/srs\.part1 is 67108865 bytes; a part is at most 67108864/);
    } finally {
      RNFS.downloadFile = original;
    }
    expect(mockFiles.has(DEST)).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('replaces a stale or half-joined file from an earlier attempt, and a retry after a failure succeeds', async () => {
    const {joined} = publish(undefined, {manifest: l => l.map(x => (x.endsWith('.part0') ? `${'0'.repeat(64)}  ${NAME}.srs.part0` : x))});
    mockFiles.set(`${DEST}.joining`, Buffer.from('half of something'));
    expect((await download()).error).toBeDefined();
    expect(leftovers()).toEqual([]);

    __resetCircuitManifestCache();
    publish();
    const {error} = await download();
    expect(error).toBeUndefined();
    expect(mockFiles.get(DEST)?.equals(joined)).toBe(true);
  });
});

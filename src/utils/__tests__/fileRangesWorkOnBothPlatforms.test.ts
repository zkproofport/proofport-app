/**
 * fileRange.ts reads and appends byte ranges through expo-file-system's
 * FileHandle -- one path for iPhone and Android, because react-native-fs's
 * read() cannot be called on iPhone under the New Architecture. A range is
 * exact: outside the file, a short read, or a bad number is an error naming
 * the file, never a shorter or different result. Every handle it opens is
 * closed, also when the read fails.
 */
const mockFiles = new Map<string, Buffer>();
const mockRangeReads: Array<{path: string; position: number; length: number}> = [];
const mockOpened: Array<{closed: () => boolean}> = [];
let mockShortRead = false;

jest.mock('expo-file-system', () => {
  const base = jest.requireActual('./fixtures/memoryExpoFile').memoryExpoFile(() => mockFiles, () => mockRangeReads);
  class File extends base.File {
    open() {
      const h = super.open();
      let closed = false;
      const close = h.close.bind(h);
      h.close = () => {
        closed = true;
        close();
      };
      const read = h.readBytes.bind(h);
      h.readBytes = (n: number) => (mockShortRead ? read(n).subarray(0, n - 1) : read(n));
      mockOpened.push({closed: () => closed});
      return h;
    }
  }
  return {__esModule: true, File};
});

import {appendFileBytes, bytesToLatin1, readFileRange} from '../fileRange';

const bytes = (n: number) => Buffer.from(Array.from({length: n}, (_v, i) => (i * 7 + 3) & 0xff));

beforeEach(() => {
  mockFiles.clear();
  mockRangeReads.length = 0;
  mockOpened.length = 0;
  mockShortRead = false;
  mockFiles.set('/d/f.bin', bytes(1000));
});

afterEach(() => {
  expect(mockOpened.every(h => h.closed())).toBe(true);
});

describe('readFileRange', () => {
  it.each([
    ['the head', 0, 10],
    ['the middle', 400, 123],
    ['up to the last byte', 990, 10],
    ['the whole file', 0, 1000],
  ])('%s: exactly those bytes, from that position', (_l, position, length) => {
    const got = readFileRange('/d/f.bin', position, length);
    expect(Buffer.from(got).equals(mockFiles.get('/d/f.bin')!.subarray(position, position + length))).toBe(true);
    expect(mockRangeReads).toEqual([{path: '/d/f.bin', position, length}]);
  });

  it('a zero-length range is empty and reads nothing', () => {
    expect(readFileRange('/d/f.bin', 1000, 0)).toEqual(new Uint8Array(0));
    expect(mockRangeReads).toEqual([]);
  });

  it.each([
    ['one byte past the end', 991, 10],
    ['starting past the end', 1001, 0],
    ['twice the file', 0, 2000],
  ])('%s is refused, naming the file and its size', (_l, position, length) => {
    expect(() => readFileRange('/d/f.bin', position, length)).toThrow(/\/d\/f\.bin: bytes .* requested; the file is 1000 bytes/);
  });

  it.each([
    ['a negative position', -1, 1],
    ['a negative length', 0, -1],
    ['a fractional length', 0, 1.5],
    ['NaN', NaN, 1],
    ['Infinity', 0, Infinity],
  ])('%s is refused before the file is opened', (_l, position, length) => {
    expect(() => readFileRange('/d/f.bin', position, length)).toThrow(/must be a non-negative integer/);
    expect(mockOpened).toEqual([]);
  });

  it('a short read is an error, not a shorter result (and the handle is still closed)', () => {
    mockShortRead = true;
    expect(() => readFileRange('/d/f.bin', 0, 10)).toThrow('/d/f.bin: read 9 of 10 bytes at 0');
  });

  it('a missing file is an error naming it', () => {
    expect(() => readFileRange('/d/none.bin', 0, 1)).toThrow(/\/d\/none\.bin/);
  });

  it.each(['d/f.bin', '', 'file:///d/f.bin'])('a path that is not absolute (%p) is refused', p => {
    expect(() => readFileRange(p, 0, 1)).toThrow(/is not an absolute file path/);
  });

  it('a path with spaces and Korean is read as the same file', () => {
    mockFiles.set('/d/서명 파일.bin', bytes(5));
    expect(Buffer.from(readFileRange('/d/서명 파일.bin', 1, 3)).equals(bytes(5).subarray(1, 4))).toBe(true);
  });
});

describe('appendFileBytes', () => {
  it('adds to the end, leaving what was there', () => {
    mockFiles.set('/d/j', Buffer.from('ab'));
    appendFileBytes('/d/j', new Uint8Array([0x63, 0x64]));
    appendFileBytes('/d/j', new Uint8Array(0));
    appendFileBytes('/d/j', new Uint8Array([0xff]));
    expect(mockFiles.get('/d/j')).toEqual(Buffer.from([0x61, 0x62, 0x63, 0x64, 0xff]));
  });

  it('a file that does not exist is an error, not a new file', () => {
    expect(() => appendFileBytes('/d/missing', new Uint8Array([1]))).toThrow(/\/d\/missing/);
    expect(mockFiles.has('/d/missing')).toBe(false);
  });
});

describe('bytesToLatin1', () => {
  it('one character per byte across every byte value and past its 8 KiB step', () => {
    const all = Buffer.from(Array.from({length: 0x2000 * 3 + 17}, (_v, i) => i & 0xff));
    const text = bytesToLatin1(new Uint8Array(all));
    expect(text.length).toBe(all.length);
    expect(Buffer.from(text, 'latin1').equals(all)).toBe(true);
  });

  it('empty in, empty out', () => {
    expect(bytesToLatin1(new Uint8Array(0))).toBe('');
  });
});

describe('no app code calls react-native-fs read()', () => {
  // It throws on every iPhone call under the New Architecture (its iOS
  // signature takes NSInteger pointers). A new call site would pass on
  // Android and fail only on iPhone, as the ABI check did in 1.4.5.
  it('src/ outside tests has no RNFS.read( call', () => {
    const fs = jest.requireActual('node:fs');
    const path = jest.requireActual('node:path');
    const root = path.resolve(__dirname, '../..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p);
        } else if (/\.(ts|tsx|js|jsx)$/.test(e.name) && /\bRNFS\s*\.\s*read\s*\(/.test(fs.readFileSync(p, 'utf8'))) {
          offenders.push(path.relative(root, p));
        }
      }
    };
    walk(root);
    expect(fs.existsSync(path.join(root, 'utils/circuitAbi.ts'))).toBe(true);
    expect(offenders).toEqual([]);
  });
});

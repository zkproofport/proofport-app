/**
 * An in-memory stand-in for expo-file-system's File / FileHandle, backed by
 * the same Map a test's react-native-fs mock uses, so both libraries see one
 * filesystem. Use from a jest.mock factory:
 *
 *   jest.mock('expo-file-system', () =>
 *     jest.requireActual('./fixtures/memoryExpoFile').memoryExpoFile(() => mockFiles, () => mockRangeReads));
 *
 * Thunks, because the factory runs when the module under test is imported --
 * before the test file's own `const mockFiles = ...` line has run.
 */
export type RangeRead = {path: string; position: number; length: number};

export function memoryExpoFile(filesOf: () => Map<string, Buffer>, readsOf: () => RangeRead[] = () => []) {
  const pathOf = (uri: string) => {
    // Paths.join collapses 'file:///x' to 'file:/x'; accept both, as the native side does.
    const m = /^file:\/*(\/.*)$/.exec(uri);
    if (!m) throw new Error(`tried to create a file with a non-file URI: ${uri}`);
    return '/' + m[1].replace(/^\/+/, '');
  };
  class FileHandle {
    private pos = 0;
    private closed = false;
    constructor(private readonly path: string) {}
    private live(): Buffer {
      if (this.closed) throw new Error('file handle is closed');
      const f = filesOf().get(this.path);
      if (!f) throw new Error(`ENOENT: ${this.path}`);
      return f;
    }
    get size(): number | null {
      return this.live().length;
    }
    get offset(): number | null {
      return this.pos;
    }
    set offset(v: number | null) {
      if (v !== null) this.pos = v;
    }
    readBytes(length: number): Uint8Array {
      const f = this.live();
      readsOf().push({path: this.path, position: this.pos, length});
      const out = new Uint8Array(f.subarray(this.pos, this.pos + length));
      this.pos += out.length;
      return out;
    }
    writeBytes(bytes: Uint8Array): void {
      const f = this.live();
      const head = f.subarray(0, this.pos);
      const tail = f.subarray(Math.min(f.length, this.pos + bytes.length));
      filesOf().set(this.path, Buffer.concat([head, Buffer.alloc(Math.max(0, this.pos - f.length)), Buffer.from(bytes), tail]));
      this.pos += bytes.length;
    }
    close(): void {
      this.closed = true;
    }
  }
  class File {
    readonly path: string;
    constructor(uri: string) {
      this.path = pathOf(uri);
    }
    open(): FileHandle {
      if (!filesOf().has(this.path)) throw new Error(`ENOENT: ${this.path}`);
      return new FileHandle(this.path);
    }
  }
  return {__esModule: true, File};
}

/** What react-native-fs's iOS `read` throws under the New Architecture (TestFlight 1.4.5 build 16). */
export const IOS_RNFS_READ_ERROR =
  'RNFSManager.read(): Error while converting JavaScript argument 1 to Objective C type NSInteger. Objective C type NSInteger is unsupported.';

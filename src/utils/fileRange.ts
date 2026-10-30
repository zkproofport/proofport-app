/**
 * Byte ranges of a file on the phone, read and appended without moving the
 * whole file through JavaScript.
 *
 * react-native-fs's `read(path, length, position)` cannot be used for this.
 * Its iOS method declares `length` and `position` as `NSInteger *` (pointers),
 * and under the New Architecture the TurboModule interop layer
 * (RCTInteropTurboModule.mm, setInvocationArg) converts only scalar, object,
 * struct and block arguments -- a pointer to an integer reaches its final
 * `throw`: "Error while converting JavaScript argument 1 to Objective C type
 * NSInteger. Objective C type NSInteger is unsupported." Every iPhone call
 * failed that way (TestFlight 1.4.5 build 16, the OIDC ABI check), while
 * Android, whose method takes plain ints, worked. One path for both
 * platforms: expo-file-system's FileHandle, a native seek plus a read of
 * `length` bytes on each.
 */
import {File} from 'expo-file-system';

function fileAt(path: string): File {
  if (!path.startsWith('/')) throw new Error(`${path} is not an absolute file path`);
  return new File(`file://${path}`);
}

function requireByteCount(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer; got ${value}`);
}

/**
 * `length` bytes of `path` starting at `position`. The range must lie inside
 * the file: a short read is an error, never a shorter result.
 */
export function readFileRange(path: string, position: number, length: number): Uint8Array {
  requireByteCount('position', position);
  requireByteCount('length', length);
  const handle = fileAt(path).open();
  try {
    const size = handle.size;
    if (size === null) throw new Error(`${path}: the file size could not be read`);
    if (position + length > size) {
      throw new Error(`${path}: bytes ${position}..${position + length} requested; the file is ${size} bytes`);
    }
    if (length === 0) return new Uint8Array(0);
    handle.offset = position;
    const bytes = handle.readBytes(length);
    if (bytes.length !== length) throw new Error(`${path}: read ${bytes.length} of ${length} bytes at ${position}`);
    return bytes;
  } finally {
    handle.close();
  }
}

/** Appends `bytes` to the end of `path`, which must already exist. */
export function appendFileBytes(path: string, bytes: Uint8Array): void {
  const handle = fileAt(path).open();
  try {
    const size = handle.size;
    if (size === null) throw new Error(`${path}: the file size could not be read`);
    handle.offset = size;
    handle.writeBytes(bytes);
  } finally {
    handle.close();
  }
}

/** One character per byte (latin1), so a range that ends inside a UTF-8 character still decodes. */
export function bytesToLatin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x2000) {
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x2000)));
  }
  return out;
}

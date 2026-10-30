/**
 * The parameter names of a downloaded circuit's `fn main`, in ABI order, read
 * from its compiled `<circuit>.json`.
 *
 * The public-input count does not tell two versions of a circuit apart when
 * only private inputs changed (the OIDC circuit before and after the
 * provider-key statement both have 214); handing a vector built for one to the
 * other fails inside the prover with a witness error that names nothing. The
 * names do tell them apart.
 *
 * Only the head of the file is read. The ABI is a few KB near the top (nargo
 * writes noir_version, hash, abi, then the bytecode), while the file is up to
 * ~9 MB; reading all of it through RNFS.readFile('utf8') decodes base64 and
 * UTF-8 in JavaScript and took 34.6 s on a Galaxy A23 (2026-10-29,
 * [ProofTiming] "circuit ABI check"). The window grows until the ABI object
 * is closed, so a file that puts it later is still read correctly, just
 * slower. The range is read through fileRange.ts: RNFS.read cannot be called
 * on iPhone under the New Architecture (see there).
 */
import RNFS from 'react-native-fs';
import {getCircuitFilePath} from './circuitDownload';
import {bytesToLatin1, readFileRange} from './fileRange';

/** First read; the OIDC ABI ends about 17.5 KB in. */
export const ABI_HEAD_BYTES = 64 * 1024;

export async function circuitAbiParameterNames(circuitName: string): Promise<string[]> {
  const path = getCircuitFilePath(circuitName, 'json');
  const abiText = await readAbiText(path);
  let abi: {parameters?: unknown};
  try {
    abi = JSON.parse(abiText);
  } catch (e) {
    throw new Error(`${path} is not JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const params = abi?.parameters;
  if (!Array.isArray(params) || params.some(p => typeof (p as {name?: unknown})?.name !== 'string')) {
    throw new Error(`${path} carries no ABI parameter list`);
  }
  return params.map(p => (p as {name: string}).name);
}

async function readAbiText(path: string): Promise<string> {
  const size = Number((await RNFS.stat(path)).size);
  if (!Number.isFinite(size) || size <= 0) throw new Error(`${path} is empty`);
  for (let window = Math.min(ABI_HEAD_BYTES, size); ; window = Math.min(window * 4, size)) {
    // One character per byte, so a window that ends inside a multi-byte
    // character cannot fail to decode; the ABI text is decoded as UTF-8 once
    // it is complete.
    const head = bytesToLatin1(readFileRange(path, 0, window));
    const found = topLevelValue(head, 'abi');
    if (found === 'incomplete' && window < size) continue;
    if (found === 'incomplete' || found === null) throw new Error(`${path} is not JSON: no complete top-level "abi"`);
    return utf8FromBytes(found);
  }
}

/**
 * The raw text of a top-level key's value in a JSON object, scanning only as
 * far as needed. `null` when the object ends without the key, `'incomplete'`
 * when the text ends first.
 */
export function topLevelValue(text: string, key: string): string | null | 'incomplete' {
  let depth = 0;
  let i = 0;
  let lastString: string | null = null;
  let valueStart = -1;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      i++;
      while (i < n && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      if (i >= n) return 'incomplete';
      lastString = depth === 1 ? text.slice(start + 1, i) : null;
      i++;
      continue;
    }
    if (c === ':' && depth === 1) {
      if (lastString === key) {
        valueStart = i + 1;
        const end = valueEnd(text, valueStart);
        return end === -1 ? 'incomplete' : text.slice(valueStart, end).trim();
      }
    } else if (c === '{' || c === '[') {
      depth++;
    } else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return null;
    }
    i++;
  }
  return 'incomplete';
}

/** Index just past the JSON value starting at `from`, or -1 when the text ends first. */
function valueEnd(text: string, from: number): number {
  let depth = 0;
  let i = from;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      if (i >= text.length) return -1;
      if (depth === 0) return i + 1;
    } else if (c === '{' || c === '[') {
      depth++;
    } else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i + 1;
      if (depth < 0) return i;
    } else if (c === ',' && depth === 0) {
      return i;
    }
    i++;
  }
  return -1;
}

/** One-character-per-byte text decoded as UTF-8; throws on invalid UTF-8. */
function utf8FromBytes(bytes: string): string {
  return decodeURIComponent(bytes.replace(/[%\u0080-ÿ]/g, ch => '%' + ch.charCodeAt(0).toString(16).padStart(2, '0')));
}

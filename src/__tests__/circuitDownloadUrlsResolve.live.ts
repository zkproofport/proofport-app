/**
 * Every URL this app builds for circuit data actually answers. Opt-in:
 * `npm run test:urls-live`.
 *
 * WHY LIVE. These are strings whose only meaning is what GitHub returns. A
 * wrong one fails on a phone, mid-download, as a 404 that reads like a network
 * problem — and it is invisible here, because the strings are consistent with
 * each other and exhaustive over the circuit list while being wrong.
 *
 * That happened on 2026-09-04. The key paths moved into the SDK, and only the
 * DIRECTORY (`…/target/vk`) was carried over, not the file inside it
 * (`…/target/vk/vk`). Off-chain verification in a browser said "Could not fetch
 * the verification key (HTTP 404)". Nothing in either repository's unit tests
 * could have caught it.
 */
import {CIRCUIT_FILE_PATHS} from '../config/contracts';
import {ALL_CIRCUIT_IDS} from '../config/circuitIds';

const BASE = 'https://raw.githubusercontent.com/zkproofport/circuits/main';

describe.each(ALL_CIRCUIT_IDS)('circuit data for %s', circuit => {
  const paths = CIRCUIT_FILE_PATHS[circuit];

  it('has a verification key at the URL this app builds', async () => {
    if (!paths) return; // hosted elsewhere on purpose
    const url = `${BASE}/${paths.vkPath}/${paths.vkFileName}`;
    const resp = await fetch(url);
    expect(resp.status).toBe(200);

    const bytes = new Uint8Array(await resp.arrayBuffer());
    // A directory listing or an HTML error page arrives as a 200 full of text.
    expect(bytes.length).toBeGreaterThan(512);
    expect(bytes[0]).not.toBe('<'.charCodeAt(0));
  }, 30_000);

  it('has a compiled circuit under basePath', async () => {
    if (!paths) return;
    // basePath is where the circuit JSON and SRS sit — one level above the key
    // directory. Checking it separately because deriving the two from one
    // string is exactly where the last mistake was.
    const url = `${BASE}/${paths.basePath}/${circuit}.json`;
    const resp = await fetch(url);
    expect(resp.status).toBe(200);
  }, 30_000);
});

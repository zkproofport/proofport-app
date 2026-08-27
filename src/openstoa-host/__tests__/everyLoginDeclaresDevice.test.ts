/**
 * Every login path must say what kind of device it is.
 *
 * THE DEFECT THIS CLOSES, found on a real phone and invisible in every test
 * that existed. The host has two ways to obtain a session — the self-relay
 * proof flow and, in debug builds, `dev-login`. The proof flow declared
 * `mobile`; `dev-login` sent only a content type. So the server minted a `web`
 * session FOR A PHONE, and the middleware that keeps chat off the web then
 * refused every chat, MLS and TAK request from the app itself.
 *
 * The symptom looked nothing like the cause. The room opened, the message list
 * rendered, and the only visible trace was a key-request fetch coming back
 * "Chat is available in the ZKProofport app" — a sentence written for browsers,
 * shown to a phone. It took a device, a log line and an hour to find.
 *
 * WHY A SOURCE SCAN. The thing that was wrong is the ABSENCE of headers on one
 * call. A behavioural test would have to drive a login flow that needs a relay,
 * a proof and a network; this asks the question directly — does every place
 * that mints a session declare its device? — and a third login path added
 * tomorrow fails here rather than in production.
 *
 * COMMENTS ARE STRIPPED BEFORE ANYTHING IS MATCHED, and that is not a detail.
 * On 2026-08-26 two source scans in this repo were found to be satisfied by
 * PROSE: one passed with the call it guarded deleted, because a nearby comment
 * quoted the endpoint; another failed against correct code for the same reason.
 * A scan that reads comments is not a guard, it is a spell-checker.
 *
 * THE HEADERS MOVED BEHIND A HELPER (2026-08-26). Both sites now spread
 * `deviceHeaders()`, which also carries the device's public key when there is
 * one. So the assertions follow the indirection instead of demanding a literal
 * at the call site: each site must USE the helper, and the helper must set the
 * kind and the id. Demanding the literal would have forced the next person to
 * either duplicate the headers or delete the guard.
 *
 * EDGE-CASE MATRIX (CLAUDE.md) → coverage
 *   contract  → every `/api/auth/` call that returns a token declares its device
 *   contract  → the kind is `mobile`, since this host IS the phone
 *   integrity → the device id comes from the shared install id, not a literal,
 *               so the session and the MLS layer agree about which device this is
 *   boundary  → the list of login paths is DERIVED from source, never hand-kept
 *   hostile   → a comment mentioning a header satisfies nothing
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const RAW = readFileSync(join(dirname(__dirname), 'zkProofportHostApi.ts'), 'utf8');

/**
 * Source with comments removed.
 *
 * Block comments become a single space rather than nothing, so two tokens that
 * were only separated by a comment do not fuse into one word.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const HOST = stripComments(RAW);

/**
 * The calls that MINT a session, and only those.
 *
 * Deliberately narrow, because the wide version was wrong in two ways worth
 * recording. `proof-request` starts a proof and returns a deep link — no token,
 * no device to declare. And an endpoint named inside an ERROR MESSAGE is not a
 * call at all; matching the bare URL text flagged a string that exists to tell
 * a developer which address failed.
 *
 * So a site counts only when the URL sits in a `fetchWithDeadline(` argument
 * list AND the endpoint is one that returns a token.
 */
const MINTS_A_SESSION = ['dev-login', 'poll/'];

function loginCallSites(): Array<{ endpoint: string; window: string }> {
  const out: Array<{ endpoint: string; window: string }> = [];
  for (const m of HOST.matchAll(/fetchWithDeadline\(\s*\n?\s*`\$\{baseUrl\}\/api\/auth\/([^`]+)`/g)) {
    const endpoint = m[1];
    if (!MINTS_A_SESSION.some((e) => endpoint.startsWith(e))) continue;
    // The call's own options object: enough to see its headers.
    out.push({ endpoint, window: HOST.slice(m.index!, m.index! + 1200) });
  }
  return out;
}

/** The helper's body, which is where the header literals live now. */
function deviceHeadersBody(): string {
  const at = HOST.indexOf('async function deviceHeaders(');
  return at === -1 ? '' : HOST.slice(at, at + 600);
}

describe('every login path declares its device', () => {
  const sites = loginCallSites();

  it('BOUNDARY: the scan really found the login calls', () => {
    // If this reads zero the regex has drifted and every assertion below is
    // vacuously true — the worst possible failure mode for this file.
    expect(sites.length).toBe(2);
    expect(sites.map((s) => s.endpoint)).toEqual(
      expect.arrayContaining([expect.stringContaining('dev-login'), expect.stringContaining('poll')]),
    );
  });

  it('BOUNDARY: the helper the sites delegate to actually exists', () => {
    // Same reason as above: every assertion that reads the helper's body is
    // vacuous if the body is the empty string.
    expect(deviceHeadersBody()).not.toBe('');
  });

  it.each(loginCallSites().map((s) => [s.endpoint, s.window] as const))(
    'CONTRACT: /api/auth/%s declares its device',
    (_endpoint, window) => {
      // jest's `expect` takes one argument, so the endpoint is in the case name
      // rather than in a message — a failure still says which call it was.
      expect(window).toContain('deviceHeaders()');
    },
  );

  it('CONTRACT: the declared kind is mobile — this host IS the phone', () => {
    // A phone that says `web` gets a session the app itself cannot use for
    // chat, which is exactly the defect that produced this file.
    const body = deviceHeadersBody();
    const at = body.indexOf('x-openstoa-device-kind');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(body.slice(at, at + 60)).toContain("'mobile'");
  });

  it('INTEGRITY: the device id comes from the shared install id, not a literal', () => {
    /*
     * Two login paths hard-coding two different strings would make one phone
     * look like two devices, and the one-device rule would fire against its own
     * user. `installDeviceId()` is the single source.
     */
    const body = deviceHeadersBody();
    const at = body.indexOf('x-openstoa-device-id');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(body.slice(at, at + 80)).toContain('installDeviceId()');
  });

  it('INTEGRITY: the public key is sent only when there is one', () => {
    /*
     * An empty or literal value here would be worse than sending nothing: the
     * server groups install ids BY this key, so a constant would merge every
     * phone on the account into one device and suppress the very warning the
     * grouping exists to make accurate.
     */
    const body = deviceHeadersBody();
    const at = body.indexOf('x-openstoa-device-key');
    expect(at).toBeGreaterThanOrEqual(0);
    // Conditional spread — the header is absent, not empty, when no key exists.
    expect(body.slice(Math.max(0, at - 40), at + 60)).toContain('pk ?');
  });

  it('HOSTILE: a comment naming a header does not satisfy this file', () => {
    // The guard for the guard. If `stripComments` regresses, the scans above
    // start reading prose and this is the only thing that notices.
    expect(stripComments('/* x-openstoa-device-kind */ const a = 1;')).not.toContain(
      'x-openstoa-device-kind',
    );
    expect(stripComments('// deviceHeaders()\nconst a = 1;')).not.toContain('deviceHeaders()');
    // ...and it must not eat the code it sits beside.
    expect(stripComments('/* c */ const a = 1;')).toContain('const a = 1;');
    // A URL inside a string is not a comment, and must survive.
    expect(stripComments("const u = 'https://example.com/x';")).toContain('https://example.com/x');
  });
});

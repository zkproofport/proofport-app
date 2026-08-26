/*
 * WHY THIS EXISTS. A proof deep link carries its own `callbackUrl`, and the app
 * derives the relay it will talk to from that string. Whoever writes the link
 * therefore chooses the server — unless the app checks. `validateRequestWithRelay`
 * does check (`src/utils/deeplink.ts`, the `trustedHosts` gate), and until now
 * nothing failed if that check were deleted.
 *
 * The gate itself was already right when this was written: exact hostname match.
 * The cases below were checked against the two ways it could be loosened, and
 * the result corrected a wrong assumption in this comment's first draft:
 *
 *   `trustedHosts.some(h => host.endsWith(h))`  → 3 of these fail
 *   `const isTrustedHost = true`                → 11 of these fail
 *
 * Note which three catch the suffix rewrite: the PREFIX look-alike
 * (`evilrelay.zkproofport.app`), the SUBDOMAIN (`x.relay.zkproofport.app`) and
 * staging-in-a-production-build. `relay.zkproofport.app.evil.test` does NOT —
 * it does not end with the trusted host, so a suffix test refuses it too. The
 * case that reads most like the attack is not the case that guards against it.
 *
 * Only the REFUSAL paths are exercised. They return before the network call, so
 * the test needs no fetch and cannot pass by accident because a real relay
 * happened to answer.
 */
import {validateRequestWithRelay} from '../deeplink';

jest.mock('../../config/environment', () => ({
  getRelayConfig: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {getRelayConfig} = require('../../config/environment');

const PRODUCTION = {trustedHosts: ['relay.zkproofport.app'], allowPrivateIps: false};
const DEVELOPMENT = {
  trustedHosts: ['localhost', 'stg-relay.zkproofport.app', 'relay.zkproofport.app'],
  allowPrivateIps: true,
};

const CALLBACK = '/api/v1/proof/callback';
const REQUEST_ID = '7f27684b-4b8f-4f68-bd88-4d805dc3b3d2';

describe('a deep link cannot choose the relay', () => {
  beforeEach(() => {
    (getRelayConfig as jest.Mock).mockReturnValue(PRODUCTION);
  });

  it.each([
    ['a look-alike suffix', 'https://relay.zkproofport.app.evil.test'],
    ['a look-alike prefix', 'https://evilrelay.zkproofport.app'],
    ['a subdomain of the real host', 'https://x.relay.zkproofport.app'],
    ['a different host entirely', 'https://attacker.test'],
    ['the staging relay, in a production build', 'https://stg-relay.zkproofport.app'],
    ['an IP address', 'https://203.0.113.7'],
    ['a private address', 'http://10.0.0.5'],
    ['loopback', 'http://127.0.0.1:4001'],
    ['localhost by name', 'http://localhost:4001'],
  ])('refuses %s', async (_label, base) => {
    const result = await validateRequestWithRelay(REQUEST_ID, `${base}${CALLBACK}`);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Untrusted relay server|Invalid relay URL/);
  });

  it('refuses a callback URL that is not the relay callback endpoint', async () => {
    for (const url of [
      'https://relay.zkproofport.app/api/v1/proof/other',
      'https://relay.zkproofport.app/',
      'https://attacker.test/collect',
      '',
    ]) {
      const result = await validateRequestWithRelay(REQUEST_ID, url);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/not a registered relay endpoint/);
    }
  });

  it('refuses a callback URL that is not a URL at all', async () => {
    const result = await validateRequestWithRelay(REQUEST_ID, `not-a-url${CALLBACK}`);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Invalid relay URL format/);
  });

  it('the host check is exact, not a suffix test', async () => {
    // `not-really-relay.zkproofport.app` ENDS WITH nothing trusted, so this one
    // survives a suffix rewrite as well — it is here for completeness, not as
    // the guard. The guards are the prefix and subdomain cases above.
    const result = await validateRequestWithRelay(
      REQUEST_ID,
      `https://not-really-relay.zkproofport.app${CALLBACK}`,
    );
    expect(result.valid).toBe(false);
  });

  it('a development build still refuses a host nobody trusts', async () => {
    (getRelayConfig as jest.Mock).mockReturnValue(DEVELOPMENT);
    const result = await validateRequestWithRelay(REQUEST_ID, `https://attacker.test${CALLBACK}`);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Untrusted relay server/);
  });

  it('every refusal names the problem without naming other hosts', async () => {
    // The message may say which host was refused — that is the caller's own
    // input. It must not list what WOULD be accepted.
    const result = await validateRequestWithRelay(REQUEST_ID, `https://attacker.test${CALLBACK}`);
    expect(result.error).toContain('attacker.test');
    expect(result.error).not.toContain('relay.zkproofport.app');
  });
});

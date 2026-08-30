/**
 * Passkey recovery is off in both clients, and it must stay off together.
 *
 * It was never run to completion — register a passkey, wipe the device, get the
 * chat keys back — and it only ever existed for iPhone: the host bridge is
 * iOS-only and Android has no implementation. Half a recovery route is worse
 * than none, because somebody registers a passkey, believes their keys are
 * safe, and finds out otherwise on the day they need them.
 *
 * Turning ONE side back on is the shape to prevent. The web and the app share a
 * recovery salt so a passkey made in one is meant to work in the other; if only
 * one offers it, a person can register somewhere they cannot recover from.
 */
import * as fs from 'fs';
import * as path from 'path';

const APP_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..');

const HOST_BRIDGE = path.join(APP_ROOT, 'src', 'openstoa-host', 'zkProofportHostApi.ts');
const WEB_PASSKEY = path.join(REPO_ROOT, 'openstoa', 'src', 'lib', 'passkeyPrf.ts');

/** `const NAME = false;` — the value, not a mention of the name. */
function switchValue(source: string, name: string): string | null {
  const m = source.match(new RegExp(`const\\s+${name}\\s*=\\s*(true|false)\\s*;`));
  return m ? m[1] : null;
}

describe('passkey recovery, in both clients at once', () => {
  it('finds both files to read', () => {
    expect(fs.existsSync(HOST_BRIDGE)).toBe(true);
    // The web lives in a sibling checkout; skip loudly rather than pass quietly
    // if it is missing, so a partial checkout cannot look like agreement.
    expect(fs.existsSync(WEB_PASSKEY)).toBe(true);
  });

  it('is switched off in the app', () => {
    const source = fs.readFileSync(HOST_BRIDGE, 'utf8');
    expect(switchValue(source, 'PASSKEY_RECOVERY_ENABLED')).toBe('false');
  });

  it('is switched off on the web', () => {
    const source = fs.readFileSync(WEB_PASSKEY, 'utf8');
    expect(switchValue(source, 'PASSKEY_RECOVERY_ENABLED')).toBe('false');
  });

  it('is switched the same way in both, so neither can be turned on alone', () => {
    const app = switchValue(fs.readFileSync(HOST_BRIDGE, 'utf8'), 'PASSKEY_RECOVERY_ENABLED');
    const web = switchValue(fs.readFileSync(WEB_PASSKEY, 'utf8'), 'PASSKEY_RECOVERY_ENABLED');
    expect(app).toBe(web);
  });

  it('leaves the recovery code path alone — that one is verified', () => {
    const source = fs.readFileSync(HOST_BRIDGE, 'utf8');
    // The switch gates the passkey bridge only; nothing about recovery codes
    // should sit inside it.
    expect(source).toMatch(/PASSKEY_RECOVERY_ENABLED\s*\?\s*\{\s*passkeyPrf:/);
  });
});

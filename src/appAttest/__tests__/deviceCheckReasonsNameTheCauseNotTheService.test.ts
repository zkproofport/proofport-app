/**
 * A device-check refusal reaches the requesting dApp as its E-code plus one
 * neutral reason code per cause (src/appAttest/deviceCheckReasons.ts), inside
 * the answer's `error`: `<the code's description> [reason: <reason>]`. The
 * precise English reason stays in the app's log.
 *
 * User decision 2026-10-30: the relay answer must not carry vendor or
 * plumbing words, and must still let us name the exact cause from a dApp's
 * report. The relay keeps only the fields it knows, so the reason travels in
 * `error` (proofport-relay callbackFieldError / ProofResult).
 */
import * as fs from 'fs';
import * as path from 'path';
import {ErrorCodes} from '../../constants/errorCodes';
import {
  DEVICE_CHECK_REASON_PATTERN,
  DEVICE_CHECK_REASONS,
  deviceCheckCode,
  isDeviceCheckReason,
} from '../deviceCheckReasons';
import {AppAttestError, refuseWith} from '../appAttestError';
import {relayErrorText, RELAY_REASON_IN_ERROR} from '../../utils/relayAnswer';
import {namesAService, SERVICE_NAMES} from '../../utils/neutralText';

jest.mock('@react-native-async-storage/async-storage', () => ({__esModule: true, default: {}}));

const REASONS = Object.keys(DEVICE_CHECK_REASONS) as (keyof typeof DEVICE_CHECK_REASONS)[];
const SRC = path.join(__dirname, '..', '..');

function sources(dir: string): string[] {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(d => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === '__tests__' ? [] : sources(p);
    return /\.(ts|tsx)$/.test(d.name) ? [p] : [];
  });
}

describe('the reason table', () => {
  it('has a reason per cause, each a neutral lowercase code', () => {
    expect(REASONS.length).toBeGreaterThan(100);
    for (const r of REASONS) {
      expect([r, DEVICE_CHECK_REASON_PATTERN.test(r)]).toEqual([r, true]);
      expect([r, namesAService(r.replace(/_/g, ' '))]).toEqual([r, false]);
    }
  });

  it('maps every reason to a registered code of a device check or the Coinbase lookups', () => {
    const allowed = ['E2005', 'E2009', 'E2011', 'E2014', 'E2015', 'E2016', 'E2017', 'E2018', 'E2020', 'E3002', 'E3006', 'E3008'];
    for (const r of REASONS) {
      const code = DEVICE_CHECK_REASONS[r];
      expect([r, allowed.includes(code), Object.prototype.hasOwnProperty.call(ErrorCodes, code)]).toEqual([r, true, true]);
    }
  });

  it('every reason is raised somewhere in the app, and nothing raises one outside the table', () => {
    const text = sources(SRC).filter(f => !f.endsWith('deviceCheckReasons.ts')).map(f => fs.readFileSync(f, 'utf8')).join('\n');
    const unused = REASONS.filter(r => !text.includes(`'${r}'`));
    expect(unused).toEqual([]);
    // Any quoted word shaped like a reason next to a refusal must be in the table.
    const raised = [...text.matchAll(/(?:new AppAttestError\(|refuseWith\([^,]+,\s*|\b(?:unavailable|malformed|refuse|integrityNotMet|serviceUnavailable)\()\s*'([a-z0-9_]+)'/g)].map(m => m[1]);
    expect(raised.length).toBeGreaterThan(100);
    expect(raised.filter(r => !isDeviceCheckReason(r))).toEqual([]);
  });

  it.each(['', 'E2014', 'IOS_KEY_DEV_ENVIRONMENT', '__proto__', 'constructor', 'ios key dev environment'])(
    'an unknown reason %j is an error, never a code', r => {
      expect(isDeviceCheckReason(r)).toBe(false);
      expect(() => deviceCheckCode(r)).toThrow(/Unknown device-check reason/);
    });

  it('an AppAttestError takes its code from its reason', () => {
    const e = new AppAttestError('ios_key_dev_environment', 'development (sandbox) key');
    expect([e.code, e.reason]).toEqual(['E2014', 'ios_key_dev_environment']);
  });

  it("a refusal helper handed another code's reason is a mistake, said as such", () => {
    expect(() => refuseWith('E2015', 'android_cert_unparsable', 'x')).toThrow(/is E2016, not E2015/);
    expect(() => refuseWith('E2016', 'android_cert_unparsable', 'x')).toThrow(AppAttestError);
  });
});

describe('the relay answer text', () => {
  const precise = "This build's App Attest key is a development (sandbox) key; Coinbase KYC v2 accepts production keys only (TestFlight and App Store builds use production).";

  it.each(REASONS)('%s: neutral text and a parseable reason, never the precise wording', reason => {
    const code = DEVICE_CHECK_REASONS[reason];
    const text = relayErrorText(code, precise, reason);
    expect(text).toBe(`${ErrorCodes[code].description} [reason: ${reason}]`);
    expect(RELAY_REASON_IN_ERROR.exec(text)?.[1]).toBe(reason);
    expect(namesAService(text)).toBe(false);
  });

  it('a reason that is not the code\'s is refused', () => {
    expect(() => relayErrorText('E2015', 'x', 'ios_key_dev_environment')).toThrow(/is E2014, not E2015/);
  });

  it.each(['E2009', 'E2014', 'E2015', 'E2016', 'E2017', 'E3006', 'E3008'] as const)(
    '%s without a reason: the code\'s own text only', code => {
      expect(relayErrorText(code, precise)).toBe(ErrorCodes[code].description);
    });

  it('another code keeps the app\'s text, unless it names a service', () => {
    expect(relayErrorText('E2008', 'This account is not a Google Workspace account.')).toBe('This account is not a Google Workspace account.');
    expect(relayErrorText('E2001', 'EAS answered with errors')).toBe(ErrorCodes.E2001.description);
    expect(relayErrorText('E2001', '')).toBe(ErrorCodes.E2001.description);
  });

  it('the banned-word pattern catches the wording that used to be sent', () => {
    for (const t of [precise, "Apple's App Attest service could not be reached", 'Play Integrity verdict', 'Android key attestation failed', 'not remotely provisioned (RKP)']) {
      expect([t, SERVICE_NAMES.test(t)]).toEqual([t, true]);
    }
  });
});

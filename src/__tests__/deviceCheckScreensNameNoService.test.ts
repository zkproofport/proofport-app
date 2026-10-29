/**
 * Screens say what happened, never which platform service or build kind is
 * behind a device check (CLAUDE.md, "Disclose As Little As Possible").
 *
 * 2026-10-30: a local iPhone build's Coinbase KYC failed E2014 and the modal
 * read "App Attest 확인에 실패했습니다", "이 기기의 App Attest 데이터를…",
 * with the raw developer reason ("This build's App Attest key is a
 * development (sandbox) key; ...") under it.
 */
import * as fs from 'fs';
import * as path from 'path';
import {createAppError, DETAILS_STAY_IN_LOGS, ErrorCodes} from '../constants/errorCodes';

const SERVICE_NAMES =
  /App Attest|AppAttest|Play Integrity|Integrity API|Key Attestation|Keystore|KeyStore|StrongBox|Secure Enclave|SafetyNet|DeviceCheck|\bKMS\b|RAON|라온|Apple 서비스|Apple's|sandbox|샌드박스/i;

function strings(value: unknown, at: string, out: [string, string][]) {
  if (typeof value === 'string') out.push([at, value]);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) strings(v, at ? `${at}.${k}` : k, out);
  }
  return out;
}

describe('no screen text names a device-check service', () => {
  it.each(['en', 'ko'])('%s.json', locale => {
    const file = path.join(__dirname, '..', 'i18n', 'locales', `${locale}.json`);
    const all = strings(JSON.parse(fs.readFileSync(file, 'utf8')), '', []);
    expect(all.length).toBeGreaterThan(500);
    expect(all.filter(([, text]) => SERVICE_NAMES.test(text))).toEqual([]);
  });

  it('the error registry (the modal\'s English fallback)', () => {
    const offenders = Object.values(ErrorCodes)
      .flatMap(e => [e.title, e.description].map(text => [e.code, text]))
      .filter(([, text]) => SERVICE_NAMES.test(text));
    expect(offenders).toEqual([]);
  });

  it('the store names a person needs to update the app stay (E3009)', () => {
    expect(ErrorCodes.E3009.description).toMatch(/App Store/);
    expect(ErrorCodes.E3009.description).toMatch(/Google Play/);
  });

  it('the pattern itself catches the wording that shipped', () => {
    for (const text of ['App Attest 확인에 실패했습니다', "Apple's App Attest service", 'Android key attestation', 'Play Integrity verdict', 'development (sandbox) key']) {
      expect([text, SERVICE_NAMES.test(text)]).toEqual([text, true]);
    }
  });
});

describe('a device-check detail stays in the logs', () => {
  const reason = "This build's App Attest key is a development (sandbox) key; Coinbase KYC v2 accepts production keys only";

  it('is exactly the device-check codes, each registered', () => {
    expect([...DETAILS_STAY_IN_LOGS].sort()).toEqual(['E2009', 'E2014', 'E2015', 'E2016', 'E2017', 'E3006', 'E3008']);
    for (const code of DETAILS_STAY_IN_LOGS) expect(Object.prototype.hasOwnProperty.call(ErrorCodes, code)).toBe(true);
  });

  it.each([...DETAILS_STAY_IN_LOGS])('%s opens with its own text and no detail', code => {
    const e = createAppError(code, reason);
    expect(e.code).toBe(code);
    expect(e.details).toBeUndefined();
  });

  it.each(['E2001', 'E2008', 'E3001', 'E5001'])('%s still shows its detail', code => {
    expect(createAppError(code, 'what happened').details).toBe('what happened');
  });

  it('an unknown code still carries its code and detail (the E9999 floor)', () => {
    expect(createAppError('E7777', 'x').details).toBe('E7777: x');
  });
});

/**
 * A failed attempt's History record says why it ended: the error code the
 * person was shown, or that they cancelled. On 2026-11-21 two failed Coinbase
 * KYC attempts on Android left records with no code and no log, and the cause
 * could not be read back from the phone.
 */
import fs from 'fs';
import path from 'path';
import {failureText} from '../screens/history/failureText';
import {ErrorCodes} from '../constants/errorCodes';
import ko from '../i18n/locales/ko.json';
import en from '../i18n/locales/en.json';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const t = (key: string) => `<${key}>`;

describe('failureText', () => {
  it('names the code with its title and description', () => {
    expect(failureText({kind: 'error', code: 'E4002'}, t))
      .toBe('[E4002] <host.errors.E4002.title> - <host.errors.E4002.description>');
  });

  it('says the person cancelled', () => {
    expect(failureText({kind: 'cancelled'}, t)).toBe('<host.history.detail.failureCancelled>');
  });

  it('shows a code this build has no row for as the bare code, never another code', () => {
    expect(Object.keys(ErrorCodes)).not.toContain('E7777');
    for (const code of ['E7777', 'e4002', ' E4002', '', 'toString', '__proto__', 'constructor', '<b>E1</b>', '한국어']) {
      expect(failureText({kind: 'error', code}, t)).toBe(code);
    }
  });

  it('every known code resolves through its own row', () => {
    for (const code of Object.keys(ErrorCodes)) {
      expect(failureText({kind: 'error', code}, t)).toContain(`host.errors.${code}.description`);
    }
  });
});

describe('the writers', () => {
  const screen = read('screens/proof/ProofGenerationScreen.tsx');

  it('the detail screen shows it', () => {
    expect(read('screens/history/HistoryDetailScreen.tsx')).toMatch(/proof\.overallStatus === 'failed' && proof\.failure &&/);
  });

  it('every place the generation screen marks a record failed says why', () => {
    expect(screen).not.toMatch(/markHistoryFailed\(\)/);
    expect(screen).toMatch(/markHistoryFailed\(\{kind: 'error', code\}\);\n\s+if \(proofRequest\)/);
    expect(screen).toMatch(/markHistoryFailed\(\{kind: 'cancelled'\}\)/);
    expect(screen).toMatch(/failure,\n\s+\.\.\.attemptLog\(\)/);
  });

  it('a proof interrupted by the app closing is recorded as E2019', () => {
    expect(read('utils/interruptedProof.ts')).toMatch(/failure: \{kind: 'error', code: 'E2019'\}/);
  });
});

describe('the wording', () => {
  it.each([['ko', ko], ['en', en]])('%s has the failure title and the cancelled line', (_l, locale) => {
    const detail = (locale as any).host.history.detail;
    expect(detail.failureTitle.trim()).not.toBe('');
    expect(detail.failureCancelled.trim()).not.toBe('');
  });
});

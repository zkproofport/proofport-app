/**
 * EVERY ERROR THE APP SHOWS WAS IN ENGLISH, ON A KOREAN PHONE.
 *
 * The error modal rendered `error.title` and `error.description` straight out
 * of `errorCodes.ts`, which holds one English string per code and nothing
 * else. So a Korean user who hit any failure — a dead network, an expired
 * proof request, a wallet that would not sign — read it in English, in an app
 * whose every other screen was Korean.
 *
 * ── Why this is checked per CODE and not once ─────────────────────────────
 *
 * The registry grows. A guard that showed one code speaking Korean would
 * stay green while the twenty-fourth was added untranslated, and the twenty-
 * fourth is exactly the one nobody looks at. So the count comes from the
 * registry itself: whatever is in it, all of it, must speak Korean.
 *
 * ── Why it resolves through i18next rather than reading the file ──────────
 *
 * The modal asks for `host.errors.<code>.title` and passes the English as
 * `defaultValue`, which means a MISSING key does not throw — it quietly
 * returns English. Reading the dictionary would miss that; asking the same
 * engine the same question the modal asks does not.
 */
import fs from 'node:fs';
import path from 'node:path';

import i18n from 'i18next';

import en from '../../i18n/locales/en.json';
import ko from '../../i18n/locales/ko.json';
import { ErrorCodes } from '../errorCodes';

/** A fresh engine, so this never depends on what the app happened to set. */
const kr = i18n.createInstance();
beforeAll(async () => {
  await kr.init({
    resources: { en: { translation: en }, ko: { translation: ko } },
    lng: 'ko',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
});

/** Exactly what the modal does, so the test cannot pass by a different route. */
function asTheModalAsks(code: string, field: 'title' | 'description', fallback: string): string {
  return kr.t(`host.errors.${code}.${field}`, { defaultValue: fallback });
}

const hasHangul = (s: string) => /[가-힣]/.test(s);

/**
 * The modal's source with every comment removed.
 *
 * The checks below assert what the modal DOES, and a check that prose can
 * satisfy is not a check — this file's own header discusses the very strings
 * it looks for.
 */
const MODAL = (() => {
  const raw = fs.readFileSync(
    path.join(__dirname, '..', '..', 'components', 'ErrorModal.tsx'),
    'utf8',
  );
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
})();

describe('the modal asks the dictionary, not the registry', () => {
  it('the comment strip is real, or every check here passes on prose alone', () => {
    expect(MODAL.length).toBeLessThan(
      fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'ErrorModal.tsx'), 'utf8')
        .length,
    );
    expect(MODAL).not.toContain('never supplies its own');
  });

  it('looks the message up by code', () => {
    expect(MODAL).toContain('host.errors.${error.code}.title');
    expect(MODAL).toContain('host.errors.${error.code}.description');
  });

  it('does not render the registry English straight onto the screen', () => {
    /*
     * The direction that catches a revert. Translating by code while ALSO
     * printing `error.title` somewhere would leave English on the screen, and
     * the lookup test above would still pass.
     */
    expect(MODAL).not.toMatch(/\{\s*error\.title\s*\}/);
    expect(MODAL).not.toMatch(/\{\s*error\.description\s*\}/);
  });

  it('the code line and the dismiss button are translated too', () => {
    expect(MODAL).toContain("host.errors.codeLine");
    expect(MODAL).not.toContain('>OK<');
    expect(MODAL).not.toContain('Error Code: ');
  });
});

describe('every error speaks Korean', () => {
  const codes = Object.values(ErrorCodes);

  it('the registry is not empty — an empty list would pass every check below', () => {
    expect(codes.length).toBeGreaterThan(15);
  });

  it('no code falls back to its English title', () => {
    const english = codes
      .filter((e) => !hasHangul(asTheModalAsks(e.code, 'title', e.title)))
      .map((e) => `${e.code}  ${e.title}`);
    expect(english).toEqual([]);
  });

  it('no code falls back to its English description', () => {
    const english = codes
      .filter((e) => !hasHangul(asTheModalAsks(e.code, 'description', e.description)))
      .map((e) => `${e.code}  ${e.description.slice(0, 40)}`);
    expect(english).toEqual([]);
  });

  it('the Korean is a translation, not the English pasted across', () => {
    const same = codes
      .filter(
        (e) =>
          asTheModalAsks(e.code, 'title', e.title) === e.title ||
          asTheModalAsks(e.code, 'description', e.description) === e.description,
      )
      .map((e) => e.code);
    expect(same).toEqual([]);
  });

  it('the line under the message names the code', () => {
    // `오류 코드: E3001` — the code is what a person quotes when asking for
    // help, so it has to survive translation.
    expect(kr.t('host.errors.codeLine', { code: 'E3001' })).toContain('E3001');
    expect(hasHangul(kr.t('host.errors.codeLine', { code: 'E3001' }))).toBe(true);
  });
});

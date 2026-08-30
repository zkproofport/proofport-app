/**
 * The error modal falls back to English on purpose — and silently.
 *
 * Every error reaches the screen through a code, and the modal looks that code
 * up in the translation files, keeping the registry's English as a default so a
 * brand-new code still reads as an error rather than as a missing key. That is
 * the right behaviour at runtime and a trap at review time: add a code, forget
 * the Korean, and nothing anywhere says so. The person just gets English at the
 * moment something went wrong.
 *
 * These checks close that gap. They are the only thing standing between a new
 * error code and a Korean user reading English.
 */
import * as fs from 'fs';
import * as path from 'path';

const APP_ROOT = path.resolve(__dirname, '..', '..');
const REGISTRY = path.join(APP_ROOT, 'src', 'constants', 'errorCodes.ts');
const LOCALES = path.join(APP_ROOT, 'src', 'i18n', 'locales');

/** Top-level entries of the registry: two-space indent, then the code. */
const CODE_ENTRY = /^ {2}(E[1-5]\d{3}):\s*\{/gm;

function registryCodes(): string[] {
  const source = fs.readFileSync(REGISTRY, 'utf8');
  return [...source.matchAll(CODE_ENTRY)].map(m => m[1]);
}

function errorsIn(language: string): Record<string, {title?: string; description?: string}> {
  const file = JSON.parse(fs.readFileSync(path.join(LOCALES, `${language}.json`), 'utf8'));
  return file?.host?.errors ?? {};
}

const LANGUAGES = ['en', 'ko'];

describe('the words a person reads when something fails', () => {
  const codes = registryCodes();

  it('found the registry and read codes out of it', () => {
    // Without this, an empty list would make every check below pass vacuously.
    expect(codes.length).toBeGreaterThan(10);
    expect(codes).toContain('E1001');
  });

  it.each(LANGUAGES)('%s has a title and a description for every code', language => {
    const errors = errorsIn(language);
    const incomplete = codes.filter(code => {
      const entry = errors[code];
      return !entry?.title?.trim() || !entry?.description?.trim();
    });
    expect(incomplete).toEqual([]);
  });

  it('has no leftover translation for a code the registry dropped', () => {
    const stale = LANGUAGES.flatMap(language =>
      Object.keys(errorsIn(language))
        .filter(key => /^E[1-5]\d{4}?$/.test(key) && !codes.includes(key))
        .map(key => `${language}: ${key}`),
    );
    expect(stale).toEqual([]);
  });

  it('says something different in Korean than in English', () => {
    const en = errorsIn('en');
    const ko = errorsIn('ko');
    const untranslated = codes.filter(
      code => en[code]?.title && en[code].title === ko[code]?.title,
    );
    expect(untranslated).toEqual([]);
  });
});

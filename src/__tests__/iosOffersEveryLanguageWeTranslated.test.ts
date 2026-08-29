/**
 * iOS is told about every language we have translations for.
 *
 * Nothing on screen shows whether this is right. The app reads the phone's
 * locale correctly (`getDeviceLanguage()` asks `Intl`), but iOS only hands an
 * app a locale drawn from the app's OWN declared language list. Declare only
 * English and a Korean phone is given en-US — the reading is honest, the answer
 * is 'en', and a complete ko.json sits unreachable.
 *
 * That is exactly what shipped. Found 2026-08-30 on TestFlight, on an iPhone,
 * after the same symptom had been chased on Android and declared fixed: Android
 * needs no such declaration, so no amount of testing there could surface it.
 *
 * So the guard is not "is the key present" but "does the key list exactly the
 * languages we actually translated" — a new locale file with no Info.plist
 * entry reproduces the original bug for that language.
 */
import fs from 'node:fs';
import path from 'node:path';

const repo = path.join(__dirname, '..', '..');
const plist = fs.readFileSync(path.join(repo, 'ios', 'ProofportApp', 'Info.plist'), 'utf8');

/** The languages that have a translation file, from the filenames themselves. */
const translated = fs
  .readdirSync(path.join(repo, 'src', 'i18n', 'locales'))
  .filter((n) => n.endsWith('.json'))
  .map((n) => n.replace(/\.json$/, ''))
  .sort();

/** The languages Info.plist declares to iOS, in the order written. */
function declaredLanguages(): string[] {
  const block = plist.match(
    /<key>CFBundleLocalizations<\/key>\s*<array>([\s\S]*?)<\/array>/,
  );
  if (!block) return [];
  return [...block[1].matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
}

describe('iOS is told about every language we translated', () => {
  it('finds translation files to compare against', () => {
    // An empty list would make the comparison below pass against anything.
    expect(translated).toContain('ko');
    expect(translated.length).toBeGreaterThan(1);
  });

  it('declares CFBundleLocalizations at all', () => {
    expect(declaredLanguages().length).toBeGreaterThan(0);
  });

  it('declares exactly the languages that have a translation file', () => {
    expect(declaredLanguages().slice().sort()).toEqual(translated);
  });

  it('is a plist iOS can still read', () => {
    // A hand-edit that unbalances the tags would ship a bundle iOS rejects.
    const opens = (plist.match(/<dict>/g) || []).length;
    const closes = (plist.match(/<\/dict>/g) || []).length;
    expect(opens).toBe(closes);
    expect((plist.match(/<array>/g) || []).length).toBe(
      (plist.match(/<\/array>/g) || []).length,
    );
  });
});

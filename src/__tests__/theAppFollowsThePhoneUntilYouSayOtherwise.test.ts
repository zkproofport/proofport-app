/**
 * The app comes up in the phone's language, and an in-app choice overrides it.
 *
 * English is the fallback for every language we have not translated — which is
 * every country that is neither Korea nor an English-speaking one. Korean is
 * not a default anywhere; it appears because the phone asked for it.
 *
 * Two things made this worth pinning:
 *
 *   iOS was silently ignoring the phone. The app declared only English to iOS,
 *   so a Korean phone was handed en-US and the reading was honest but wrong.
 *   Fixed by declaring both languages (see iosOffersEveryLanguageWeTranslated).
 *
 *   There were two places that looked like "the language setting". The real one
 *   is i18n's own key, `proofport.language`. A second `language` field sat in
 *   the app settings store, written by nobody and read by nobody. It has been
 *   removed, and this test fails if it comes back — anyone wiring the picker to
 *   it would break the setting while appearing to fix it.
 */
import fs from 'node:fs';
import path from 'node:path';

const src = path.join(__dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(src, ...p), 'utf8');

const i18nSetup = read('i18n', 'index.ts');
const picker = read('screens', 'more', 'SettingsLanguageScreen.tsx');
const settingsStore = read('stores', 'settingsStore.ts');

describe('the language follows the phone, then the user', () => {
  it('starts from the phone, not from a hardcoded language', () => {
    expect(i18nSetup).toMatch(/lng:\s*getDeviceLanguage\(\)/);
  });

  it('falls back to English for languages we have not translated', () => {
    expect(i18nSetup).toMatch(/fallbackLng:\s*'en'/);
  });

  it('a language the user picked wins over the phone at the next start', () => {
    // Read after init and applied over the device value.
    const stored = i18nSetup.indexOf("getItem(LANGUAGE_KEY)");
    const init = i18nSetup.indexOf('lng: getDeviceLanguage()');
    expect(init).toBeGreaterThan(-1);
    expect(stored).toBeGreaterThan(init);
    expect(i18nSetup).toContain('changeLanguage(stored)');
  });

  it('the picker writes the key i18n actually reads', () => {
    // Both sides must name the same key. They are declared separately, so a
    // rename in one file alone would leave the picker writing where nothing
    // looks.
    const key = /LANGUAGE_KEY = '([^']+)'/;
    expect(picker.match(key)?.[1]).toBe(i18nSetup.match(key)?.[1]);
  });

  it('the settings store has no second language field to be confused with', () => {
    // A bare `language:` field. The word appears in a comment there explaining
    // its absence, so match the field shape, not the word.
    expect(settingsStore).not.toMatch(/^\s*language[?]?:\s/m);
  });
});

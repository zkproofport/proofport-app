/**
 * The Play listing has to fit Google's limits before an upload is attempted.
 *
 * `supply` refuses text that is too long, and it refuses it at the end of a
 * release run — after the bundle has been built and signed. Checking the files
 * here turns a thirty-minute failure into a one-second one.
 *
 * The short description is the field that catches people out. Play shows it
 * under the app name in search results and allows 80 characters; the App Store
 * has no equivalent (its subtitle allows 30 and is empty for this app), so this
 * text was written for Play alone and has no other copy to check it against. The
 * first draft was 81 characters.
 *
 * This package runs jest, which takes no message argument on `expect`. Each
 * failure has to be readable from the test name alone.
 */
import fs from 'node:fs';
import path from 'node:path';

const metadata = path.join(__dirname, '..', '..', 'android', 'fastlane', 'metadata', 'android');

/** Google's published maxima, in characters. */
const LIMITS = {
  'title.txt': 30,
  'short_description.txt': 80,
  'full_description.txt': 4000,
} as const;

const locales = fs.readdirSync(metadata).filter((name) =>
  fs.statSync(path.join(metadata, name)).isDirectory(),
);

const read = (locale: string, file: string) =>
  fs.readFileSync(path.join(metadata, locale, file), 'utf8');

describe('the Play listing is ready to upload', () => {
  it('both languages are present', () => {
    // Losing one silently would publish a listing in the other language only.
    expect(locales.sort()).toEqual(['en-US', 'ko-KR']);
  });

  const cases = locales.flatMap((locale) =>
    Object.entries(LIMITS).map(([file, limit]) => [locale, file, limit] as const),
  );

  it.each(cases)('%s %s is within %i characters', (locale, file, limit) => {
    expect(read(locale, file).length).toBeLessThanOrEqual(limit);
  });

  it.each(cases)('%s %s is not empty', (locale, file) => {
    expect(read(locale, file).trim().length).toBeGreaterThan(0);
  });

  it.each(locales)('%s says the app name the way the project spells it', (locale) => {
    // The official spelling is ZKProofport. Repository names are historical and
    // the store must not inherit them.
    expect(read(locale, 'title.txt').trim()).toBe('ZKProofport');
  });

  it.each(locales)('%s has no trailing newline that would count against the limit', (locale) => {
    // `supply` sends the file as-is; a stray newline is a character Google counts
    // and is the kind of thing that pushes an 80 into an 81.
    for (const file of Object.keys(LIMITS)) {
      expect(read(locale, file)).not.toMatch(/\n$/);
    }
  });
});

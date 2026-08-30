/**
 * The note testers read must not tell them to ignore what the build changed.
 *
 * Build 3's note opened with "the app comes up in English; that is known, no
 * need to report it". True when it was written. The Korean declaration then
 * shipped, and the same sentence became an instruction to dismiss the exact
 * defect the build existed to fix — sitting in a console where nothing diffs
 * it and no test could see it.
 *
 * So the note lives in the repo now, and these checks hold it to three things:
 * one file per language the app claims to support, no sentence waving the
 * language away, and short enough for Apple to accept.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO = path.resolve(__dirname, '..', '..');
const NOTES = path.join(REPO, 'ios', 'fastlane', 'testflight-notes');
const INFO_PLIST = path.join(REPO, 'ios', 'ProofportApp', 'Info.plist');

/** Apple rejects a whatsNew longer than this. */
const APPLE_LIMIT = 4000;

function declaredLanguages(): string[] {
  const plist = fs.readFileSync(INFO_PLIST, 'utf8');
  const block = plist.match(
    /<key>CFBundleLocalizations<\/key>\s*<array>([\s\S]*?)<\/array>/,
  );
  if (!block) {
    throw new Error(
      'Info.plist declares no CFBundleLocalizations — without it iOS hands the ' +
        'app English on every phone, which is the defect this note is about.',
    );
  }
  return [...block[1].matchAll(/<string>([^<]+)<\/string>/g)].map(m => m[1]);
}

/** "ko" in Info.plist is "ko" in App Store Connect; "en" there is "en-US" here. */
const NOTE_FILE: Record<string, string> = {en: 'en-US.txt', ko: 'ko.txt'};

describe('the note testers read', () => {
  const languages = declaredLanguages();

  it('finds the notes directory at all', () => {
    expect(fs.existsSync(NOTES)).toBe(true);
  });

  it('covers every language the app claims to support', () => {
    expect(languages.length).toBeGreaterThan(1);
    for (const language of languages) {
      const file = NOTE_FILE[language];
      if (!file) {
        // Not an assertion, because the failure needs to name the language —
        // a bare `toBeDefined()` would only say "undefined".
        throw new Error(
          `Info.plist declares "${language}" but no note filename is mapped ` +
            'for it, so testers on that language would get no note at all.',
        );
      }
      expect(fs.existsSync(path.join(NOTES, file))).toBe(true);
    }
  });

  it.each(Object.values(NOTE_FILE))('%s stays inside Apple\'s length limit', file => {
    const text = fs.readFileSync(path.join(NOTES, file), 'utf8').trim();
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(APPLE_LIMIT);
  });

  it.each(Object.values(NOTE_FILE))('%s never waves the language away', file => {
    const text = fs.readFileSync(path.join(NOTES, file), 'utf8');
    // The exact shape that went stale: naming English, then excusing it.
    expect(text).not.toMatch(/comes up in English[\s\S]{0,80}(no need to report|that is known)/i);
    expect(text).not.toMatch(/영어로 (뜹니다|나옵니다)[\s\S]{0,80}(알려주지 않으셔도|알려진 것)/);
  });

  it.each(Object.values(NOTE_FILE))('%s asks the tester to check the language', file => {
    const text = fs.readFileSync(path.join(NOTES, file), 'utf8');
    expect(text).toMatch(/Korean|한국어/);
  });
});

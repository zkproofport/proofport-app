/**
 * One thing, one Korean word for it.
 *
 * The Arc action screen was written with a "범위" field while every other
 * screen in the app calls the same value "스코프". Two names for one thing
 * reads as two different settings, and the person deciding which to fill in
 * has nothing to go on. It is the same failure as one label meaning two
 * things, seen from the other side.
 *
 * This holds the terms that have been wrong at least once. Adding a row is
 * cheap; each one is a word somebody already had to ask about.
 */
import * as fs from 'fs';
import * as path from 'path';

const APP_ROOT = path.resolve(__dirname, '..', '..');

/**
 * The Korean word the app uses, and the words that mean the same thing and
 * must not appear as a label. The English column says what the thing is, so a
 * reader does not have to guess which "scope" is meant.
 */
const ONE_WORD_EACH = [
  {
    thing: 'the nullifier scope string a dapp passes in',
    keep: '스코프',
    banned: ['범위'],
  },
];

function flatten(value: unknown, prefix = '', out: Record<string, string> = {}) {
  if (typeof value === 'string') {
    out[prefix] = value;
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}

describe('one Korean word per thing', () => {
  const ko = flatten(
    JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'src/i18n/locales/ko.json'), 'utf8')),
  );

  it.each(ONE_WORD_EACH)('$thing is always "$keep"', ({keep, banned}) => {
    // Only a label — a heading or a field name — is the problem. Prose may use
    // the ordinary word in its ordinary sense.
    const labels = Object.entries(ko).filter(([k]) => /Label$|Title$|\.title$/.test(k));
    const wrong = labels
      .filter(([, v]) => banned.some((b) => v.includes(b)))
      .map(([k, v]) => `${k} = "${v}"  →  "${keep}"`);
    expect(wrong).toEqual([]);
  });
});

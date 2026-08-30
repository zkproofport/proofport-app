/**
 * Now that a Korean phone actually gets the Korean bundle, a missing Korean
 * string is a defect a user sees rather than a line nobody reaches.
 *
 * Before the app declared Korean, iOS handed every phone English and the state
 * of ko.json did not matter on screen. The declaration flipped that, and the
 * first thing it exposed was the launch screen: "Privacy-Preserving Identity
 * Proofs" sat in ko.json in English, so a Korean user's very first screen would
 * have been in the wrong language.
 *
 * Three things are held here: the two files carry the same keys, no Korean
 * value is blank, and any entry whose Korean equals its English is on the list
 * below with a reason. That last one is the check that would have caught the
 * launch screen.
 */
import * as fs from 'fs';
import * as path from 'path';

const LOCALES = path.resolve(__dirname, '..', 'i18n', 'locales');

/**
 * Entries that are correctly identical in both files. A product name, a chain
 * name, an input format, or a language shown in its own language is not
 * something to translate. Anything NOT here that matches is a missed string.
 */
const SAME_ON_PURPOSE: Record<string, string> = {
  'host.history.detail.dapp': 'product term, used untranslated in Korean too',
  'host.more.networkBase': 'Base is the chain name',
  'host.proof.circuitSelection.network.base': 'Base is the chain name',
  'host.proof.circuitSelection.experimentalBadge': 'shown as an English badge in both',
  'host.proof.domain.googleWorkspace': 'product name',
  'host.proof.domain.microsoft365': 'product name',
  'host.proof.mdlKrInput.ageHint': 'shows the circuit input names verbatim',
  'host.proof.mdlKrInput.placeholderBirth': 'date format, not prose',
  'host.proof.mdlKrInput.placeholderSex': 'field format, not prose',
  'host.proof.mdlKrInput.placeholderTelno': 'number format, not prose',
  'host.settings.english': 'a language is named in its own language',
  'host.settings.korean': 'a language is named in its own language',
  'host.tabs.openstoa': 'product name',
  'host.wallet.title': 'product name',
  'openstoa.members.actionsForMember': 'the whole value is a placeholder',
  'openstoa.tabs.zkproofport': 'product name',
};

type Flat = Record<string, string>;

function flatten(value: unknown, prefix = '', out: Flat = {}): Flat {
  if (typeof value === 'string') {
    out[prefix] = value;
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}

function load(name: string): Flat {
  return flatten(JSON.parse(fs.readFileSync(path.join(LOCALES, name), 'utf8')));
}

describe('what a Korean phone will read', () => {
  const en = load('en.json');
  const ko = load('ko.json');

  it('reads both files and finds something in them', () => {
    expect(Object.keys(en).length).toBeGreaterThan(100);
    expect(Object.keys(ko).length).toBe(Object.keys(en).length);
  });

  it('has a Korean entry for every English one', () => {
    const missing = Object.keys(en).filter(k => !(k in ko));
    expect(missing).toEqual([]);
  });

  it('has no Korean entry the English file lacks', () => {
    const extra = Object.keys(ko).filter(k => !(k in en));
    expect(extra).toEqual([]);
  });

  it('leaves no Korean entry blank', () => {
    const blank = Object.entries(ko).filter(([, v]) => !v.trim()).map(([k]) => k);
    expect(blank).toEqual([]);
  });

  it('has no English sentence sitting in the Korean file', () => {
    const identical = Object.keys(en)
      .filter(k => k in ko && en[k].trim() && en[k].trim() === ko[k].trim())
      .filter(k => !(k in SAME_ON_PURPOSE));
    // The message names the strings, because "expected [] to equal [x]" alone
    // does not tell the reader what to translate.
    expect(identical.map(k => `${k} = ${JSON.stringify(en[k])}`)).toEqual([]);
  });

  it('keeps the exception list honest — every entry on it is really identical', () => {
    const notActuallySame = Object.keys(SAME_ON_PURPOSE)
      .filter(k => !(k in en) || en[k].trim() !== (ko[k] ?? '').trim());
    expect(notActuallySame).toEqual([]);
  });

  it('translated the launch screen, the first thing a Korean user sees', () => {
    expect(ko['host.loading.tagline']).not.toBe(en['host.loading.tagline']);
    expect(ko['host.loading.tagline']).toMatch(/[가-힣]/);
  });
});

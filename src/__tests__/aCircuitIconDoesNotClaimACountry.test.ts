import fs from 'fs';
import path from 'path';

/**
 * A flag on a circuit's icon tells the person holding the phone that the proof
 * is about where they are from. Only one circuit family here is actually scoped
 * to a country, so only that one may carry a flag.
 *
 * This is guarded because the GIWA row got it wrong twice in a row. It shipped
 * as a Japanese castle (reached for because 기와 means roof tile), and the fix
 * for that was a Korean flag — which reads as "this proves you are Korean" for
 * a chain whose attestations are open to anyone on it. Both were caught by a
 * person looking at the screen, not by anything in the repo.
 *
 * What this can and cannot do: it cannot judge whether an emoji is a GOOD
 * choice. It only catches the specific wrong claim — a country asserted by an
 * icon on a circuit that is not about one.
 */

const MODAL_PATH = path.join(
  __dirname,
  '..',
  'components',
  'ProofRequestModal.tsx',
);

/**
 * Regional indicator pairs (🇰🇷 and friends) plus the flag emoji that carry a
 * country without being regional indicators at all — 🏴 with tag sequences, and
 * the plain 🏁/🚩 shapes that read as one anyway.
 */
const FLAG = /[\u{1F1E6}-\u{1F1FF}]{2}|\u{1F3F4}[\u{E0060}-\u{E00FF}]+/u;

/** Circuits whose credential really is issued by one country. */
const COUNTRY_SCOPED = /^mdl_kr_/;

describe('a circuit icon does not claim a country', () => {
  const source = fs.readFileSync(MODAL_PATH, 'utf8');

  /**
   * Read the table by id -> icon. Comments are stripped first: this file
   * explains the GIWA history in prose that names both wrong emoji, and a
   * naive scan would read those as the current value and fail forever.
   */
  const iconsById = (): Record<string, string> => {
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter(line => !line.trim().startsWith('//'))
      .join('\n');

    const table = code.match(/const CIRCUIT_INFO[\s\S]*?\n};/);
    if (!table) {
      throw new Error('CIRCUIT_INFO table not found — was it renamed?');
    }

    // Each row is taken whole and searched INSIDE. Scanning for the next
    // `icon:` after a row name instead reads across the row boundary: a row
    // with no emoji (GIWA carries an image) picked up the emoji of whichever
    // row came next, and reported GIWA as showing the ID-card emoji.
    const rows: Record<string, string> = {};
    const rowPattern = /(\w+):\s*\{([^{}]*)\}/g;
    let match;
    while ((match = rowPattern.exec(table[0])) !== null) {
      const emoji = match[2].match(/(?:^|[\s,{])icon:\s*'([^']+)'/);
      if (emoji) rows[match[1]] = emoji[1];
    }
    return rows;
  };

  it('reads every emoji row, so a renamed table fails loudly instead of passing empty', () => {
    const rows = iconsById();
    // The count is deliberate. A regex that silently matches nothing would make
    // every case below vacuously true, which is the failure mode this whole
    // file exists to avoid. Six rows carry an emoji; GIWA carries a real mark
    // and so appears in the case below this one instead.
    expect(Object.keys(rows).length).toBeGreaterThanOrEqual(6);
    expect(rows).toHaveProperty('coinbase_attestation');
  });

  it('only a circuit issued by one country may carry a flag', () => {
    const offenders = Object.entries(iconsById())
      .filter(([id, icon]) => FLAG.test(icon) && !COUNTRY_SCOPED.test(id))
      .map(([id, icon]) => `${id} -> ${icon}`);

    expect(offenders).toEqual([]);
  });

  it('GIWA shows its own mark and no emoji at all', () => {
    // Named on its own because it is the row that got this wrong twice — a
    // Japanese castle, then a Korean flag — and a reader of a failure should
    // not have to work out which circuit broke a general rule.
    //
    // The mark is the fix, not a third emoji, so this asserts BOTH halves: the
    // image is wired, and no emoji sits next to it waiting to be rendered.
    expect(source).toMatch(
      /giwa_attestation:\s*\{[\s\S]*?iconImage:\s*require\('\.\.\/\.\.\/assets\/giwa-mark\.png'\)/,
    );
    expect(iconsById().giwa_attestation).toBeUndefined();
  });

  it('the mark file the code requires is actually on disk, at all three densities', () => {
    // `require` of a missing image is a Metro bundling error, not a test
    // failure, so a rename would surface as a red build with no hint that the
    // icon was the cause. The @2x/@3x pair matters because every current iPhone
    // picks @3x — shipping only the base file gives a blurry mark on hardware
    // while looking correct in a simulator set to @1x.
    const assets = path.join(__dirname, '..', '..', 'assets');
    for (const name of ['giwa-mark.png', 'giwa-mark@2x.png', 'giwa-mark@3x.png']) {
      const file = path.join(assets, name);
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.statSync(file).size).toBeGreaterThan(100);
    }
  });

  it('the country circuit stays generic, since any country can be proved', () => {
    // Coinbase Country takes the country as an input. A specific flag here
    // would be wrong for every user who is not from that country.
    const country = iconsById().coinbase_country_attestation;
    expect(FLAG.test(country)).toBe(false);
  });
});

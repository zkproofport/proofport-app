/**
 * THE HOST APP HAD ENGLISH ON KOREAN SCREENS TOO.
 *
 * The mini-app was swept first; this is the app around it, and a person moves
 * between the two without noticing a boundary. Found on 2026-08-27:
 * `Disconnect` on the wallet card, `Status / Date / Network / Proof Hash /
 * Delete` on every proof-history row, `Circuit wallets` and its whole
 * explanatory paragraph, and the wallet status badges reading `Connected` /
 * `Inactive` / `Not bound`.
 *
 * ── Why the pattern names no characters ───────────────────────────────────
 *
 * Three sweeps in a row missed things because the pattern listed which
 * characters a sentence may contain, and the sentence contained one more: a
 * newline, then an apostrophe, then a semicolon. Each time the scan came back
 * clean and the screen was not.
 *
 * So it stopped listing characters. It matches anything between `<Text>` and
 * `</Text>` that contains NO braces — braces mean an expression, and an
 * expression is where `t(...)` lives. What is left is a literal a person
 * reads, whatever is in it.
 *
 * ── Prose cannot satisfy this ─────────────────────────────────────────────
 *
 * Every position is one only code occupies. The English sentences in this
 * very comment match nothing below, which was checked by running it.
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(__dirname, '..');

/**
 * Files nothing renders. Each is reachable only from a barrel `index.ts` and
 * from itself — the wallet TAB mounts `screens/wallet/WalletMainScreen`, not
 * `screens/WalletScreen`. Translating dead screens would be work with no
 * reader, so they are named here instead, where the naming is the report.
 */
const NOT_RENDERED = new Set([
  'screens/WalletScreen.tsx',
  'components/LogViewer.tsx',
  'components/ActionButtons.tsx',
  'components/ProofRequestModal.tsx',
]);

/** Behind the developer-mode toggle; a person never sees these by accident. */
const DEVELOPER_ONLY = new Set(['screens/more/MlsPocScreen.tsx']);

/** English that is right where it stands, each named rather than pattern-waved. */
const ENGLISH_ON_PURPOSE = new Set([
  'ZKProofport', // the product's name — translating it is the defect
  'Powered by Masse Labs', // the company's name and a fixed credit line
  'MLS PoC (ts-mls 0x0001)', // a developer-mode entry, labelled as such beside it
  'Phase 0 PoC (dev)', // the heading over that developer-mode entry
]);

/** Every source file, not only the ones that can hold a `<Text>`. */
function walkAll(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walkAll(p);
    return /\.tsx?$/.test(p) ? [p] : [];
  });
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(p);
    return p.endsWith('.tsx') ? [p] : [];
  });
}

const FILES = walk(SRC).filter((f) => {
  const rel = path.relative(SRC, f);
  return !NOT_RENDERED.has(rel) && !DEVELOPER_ONLY.has(rel);
});

/** No braces between the tags means no expression, which means a literal. */
const LITERAL_TEXT = /<Text\b[^>]*>([^<>{}]+)<\/Text>/g;
const BARE_DIALOG = /Alert\.alert\(\s*'([A-Za-z][^']{3,})'/g;
const BARE_LABEL = /accessibilityLabel=["{]'?([A-Z][^"'}]{3,}?)['}"]/g;

/*
 * THE FOURTH PLACE, found on the phone after the third was fixed: the wallet
 * card's buttons read `Connect` / `Reconnect` / `Clear` / `Disconnect` on a
 * Korean screen. They are not `<Text>` children — they ride in on a `label`
 * prop, which no check above looks at.
 *
 * The pattern takes both quote styles. Writing it for one and not the other is
 * how `label="Clear"` survived a sweep that caught `label={'Connect'}` on the
 * line above it.
 */
const PROPS_THAT_CARRY_WORDS =
  /\b(?:label|buttonText|emptyText|heading|subtitle|caption|actionLabel|confirmText|cancelText|primaryLabel|secondaryLabel)=[^\n]*/g;
const QUOTED = /(['"])([A-Za-z][^'"]{2,})\1/g;

/** A translation key or a web address, not a sentence a person reads. */
function notASentence(s: string): boolean {
  return /^[a-z][\w]*(\.[\w]+)+$/.test(s) || /^(www\.|https?:\/\/)/.test(s);
}

function offendersIn(text: string, re: RegExp): Array<{line: number; word: string}> {
  const out: Array<{line: number; word: string}> = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const word = m[1].replace(/\s+/g, ' ').trim();
    if (!/[A-Za-z]{3}/.test(word)) continue; // punctuation, a number, an arrow
    if (/[가-힣]/.test(word)) continue; // already Korean
    if (ENGLISH_ON_PURPOSE.has(word)) continue;
    out.push({line: text.slice(0, m.index).split('\n').length, word});
  }
  return out;
}

describe('the host app does not fall back to English', () => {
  it('the sweep is not empty — a broken path looks exactly like a clean app', () => {
    expect(FILES.length).toBeGreaterThan(30);
  });

  it('no screen writes an English sentence straight into a Text element', () => {
    const found: string[] = [];
    for (const f of FILES) {
      const text = fs.readFileSync(f, 'utf8');
      for (const o of offendersIn(text, LITERAL_TEXT)) {
        found.push(`${path.relative(SRC, f)}:${o.line}  ${o.word}`);
      }
    }
    expect(found.sort()).toEqual([]);
  });

  it('no dialog and no screen-reader name is English', () => {
    const found: string[] = [];
    for (const f of FILES) {
      const text = fs.readFileSync(f, 'utf8');
      for (const re of [BARE_DIALOG, BARE_LABEL]) {
        for (const o of offendersIn(text, re)) {
          found.push(`${path.relative(SRC, f)}:${o.line}  ${o.word}`);
        }
      }
    }
    expect(found.sort()).toEqual([]);
  });

  it('no button carries English in on a prop', () => {
    const found: string[] = [];
    for (const f of FILES) {
      const text = fs.readFileSync(f, 'utf8');
      text.split('\n').forEach((line, i) => {
        PROPS_THAT_CARRY_WORDS.lastIndex = 0;
        for (let p = PROPS_THAT_CARRY_WORDS.exec(line); p !== null; p = PROPS_THAT_CARRY_WORDS.exec(line)) {
          QUOTED.lastIndex = 0;
          for (let q = QUOTED.exec(p[0]); q !== null; q = QUOTED.exec(p[0])) {
            const word = q[2];
            if (!/[A-Za-z]{3}/.test(word) || /[가-힣]/.test(word)) continue;
            if (notASentence(word) || ENGLISH_ON_PURPOSE.has(word)) continue;
            found.push(`${path.relative(SRC, f)}:${i + 1}  ${word}`);
          }
        }
      });
    }
    expect([...new Set(found)].sort()).toEqual([]);
  });

  it('the files named as unrendered really are unrendered', () => {
    /*
     * The exemption above is only honest while it stays true. If something
     * starts rendering one of these, its English is back on a screen and the
     * list has to shrink rather than quietly excuse a live file.
     *
     * A barrel `index.ts` re-exports everything whether or not anything uses
     * it, and one dead file importing another proves nothing — the wallet
     * screen that pulls in the log viewer is itself unreachable. Neither
     * counts as a reader.
     */
    const everySource = walkAll(SRC);
    for (const rel of NOT_RENDERED) {
      const base = path.basename(rel, '.tsx');
      const readers = everySource
        .map((f) => path.relative(SRC, f))
        .filter((r) => r !== rel)
        .filter((r) => !/(^|\/)index\.tsx?$/.test(r))
        .filter((r) => !NOT_RENDERED.has(r))
        .filter((r) => new RegExp(`\\b${base}\\b`).test(fs.readFileSync(path.join(SRC, r), 'utf8')));
      expect({file: rel, readers}).toEqual({file: rel, readers: []});
    }
  });
});

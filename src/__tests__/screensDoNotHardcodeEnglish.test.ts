/**
 * A sentence typed straight into a screen never reaches the Korean bundle.
 *
 * The translation-file guard next door compares en.json against ko.json, and by
 * construction it cannot see a string that is in neither. The proof request
 * modal — the screen where somebody decides whether to hand over a proof — had
 * fourteen of those, including both buttons. On a Korean phone the app would
 * have been Korean everywhere except the one screen that matters most.
 *
 * So this reads the screens themselves and fails on an English sentence sitting
 * inside a <Text>. Product names and single words are left alone; the target is
 * prose, which is what a person notices in the wrong language.
 */
import * as fs from 'fs';
import * as path from 'path';

const APP_ROOT = path.resolve(__dirname, '..', '..');
const SEARCH_ROOTS = ['src/screens', 'src/components'];
const EXTRA_FILES = ['App.tsx'];

/** `<Text ...>plain words</Text>` — braces mean it is already an expression. */
const TEXT_ELEMENT = /<Text\b[^>]*>\s*([^<>{}\n][^<>{}]*?)\s*<\/Text>/gs;
/** Two or more English words in a row: prose, not a product name. */
const ENGLISH_PROSE = /^[A-Za-z]{2,}(\s+[A-Za-z][A-Za-z'.,!?-]*){1,}$/;

/**
 * Lines that are correctly English, with the reason. A company name is not
 * translated, and a screen behind a developer-only switch never reaches a user.
 */
const ALLOWED: Record<string, string> = {
  'src/screens/LoadingScreen.tsx | Powered by Masse Labs':
    'the company name, which stays as it is in every language',
  'src/screens/more/MlsPocScreen.tsx | Run round-trip':
    'developer-only screen, registered behind __DEV__ in the More stack',
  'src/screens/more/MlsPocScreen.tsx | Run passkey PRF':
    'developer-only screen, registered behind __DEV__ in the More stack',
  'src/components/LogViewer.tsx | Copy All':
    'the only screen holding this component is not reachable from navigation',
  'src/components/ActionButtons.tsx | Run All Steps':
    'nothing imports this component',
};

function screenFiles(): string[] {
  const found = [...EXTRA_FILES];
  for (const root of SEARCH_ROOTS) {
    const stack = [path.join(APP_ROOT, root)];
    while (stack.length) {
      const dir = stack.pop()!;
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') stack.push(full);
        } else if (entry.name.endsWith('.tsx')) {
          found.push(path.relative(APP_ROOT, full));
        }
      }
    }
  }
  return found.sort();
}

function hardcodedProse(): string[] {
  const hits: string[] = [];
  for (const file of screenFiles()) {
    const full = path.join(APP_ROOT, file);
    if (!fs.existsSync(full)) continue;
    const source = fs.readFileSync(full, 'utf8');
    for (const match of source.matchAll(TEXT_ELEMENT)) {
      const text = match[1].trim();
      if (ENGLISH_PROSE.test(text)) hits.push(`${file} | ${text}`);
    }
  }
  return hits;
}

describe('what a screen says out loud', () => {
  it('found screens to read in the first place', () => {
    const files = screenFiles();
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain('src/components/ProofRequestModal.tsx');
  });

  it('has no English sentence typed straight into a screen', () => {
    const unexplained = hardcodedProse().filter(hit => !(hit in ALLOWED));
    expect(unexplained).toEqual([]);
  });

  it('keeps the exception list honest — nothing on it has been fixed or moved', () => {
    const current = new Set(hardcodedProse());
    const stale = Object.keys(ALLOWED).filter(hit => !current.has(hit));
    expect(stale).toEqual([]);
  });

  it('leaves nothing hardcoded in the proof request modal', () => {
    const inModal = hardcodedProse().filter(hit =>
      hit.startsWith('src/components/ProofRequestModal.tsx'),
    );
    expect(inModal).toEqual([]);
  });
});

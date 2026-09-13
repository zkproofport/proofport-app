/**
 * A screen that asks for a string nobody wrote shows the KEY to the user.
 *
 * The Arc action screen shipped to the simulator with its heading, its hints,
 * its summary and its button all rendering as `host.proof.arcAction.*` — the
 * screen was written and the words were never added to either bundle. It is
 * invisible to every other guard here: the translation-file comparison passes
 * because the key is missing from BOTH files equally, the typecheck passes
 * because `t()` takes any string, and the English-prose sweep passes because
 * there is no English prose to find.
 *
 * So this walks the screens, collects every key they pass to `t()`, and fails
 * when a key has no words behind it in either language.
 */
import * as fs from 'fs';
import * as path from 'path';

const APP_ROOT = path.resolve(__dirname, '..', '..');
const SEARCH_ROOTS = ['src/screens', 'src/components', 'src/hooks', 'src/utils', 'src/navigation'];

/** `t('a.b.c')` with a literal key. A computed key is skipped — see below. */
const LITERAL_KEY = /\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g;

/**
 * Keys built at run time from a list, which the regex above cannot see.
 * Each entry names where the list lives, so a new one is added here rather
 * than silently escaping the check.
 */
const COMPUTED_KEYS: Record<string, string> = {
  'host.proof.arcAction.field.to': 'ArcActionInputScreen — the fields of the chosen action',
  'host.proof.arcAction.field.amount': 'ArcActionInputScreen — the fields of the chosen action',
  'host.proof.arcAction.field.nonce': 'ArcActionInputScreen — the fields of the chosen action',
};

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') walk(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function resolve(bundle: unknown, key: string): string | undefined {
  let cur: unknown = bundle;
  for (const part of key.split('.')) {
    if (typeof cur !== 'object' || cur === null || !(part in cur)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

describe('every label a screen asks for has words behind it', () => {
  const en = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'src/i18n/locales/en.json'), 'utf8'));
  const ko = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'src/i18n/locales/ko.json'), 'utf8'));

  const keys = new Map<string, string>();
  for (const root of SEARCH_ROOTS) {
    for (const file of walk(path.join(APP_ROOT, root))) {
      const source = fs.readFileSync(file, 'utf8');
      for (const m of source.matchAll(LITERAL_KEY)) {
        // Only keys shaped like a translation path; `t(variable)` never matches.
        if (m[1].includes('.')) keys.set(m[1], path.relative(APP_ROOT, file));
      }
    }
  }
  for (const [key, where] of Object.entries(COMPUTED_KEYS)) keys.set(key, where);

  it('finds keys to check', () => {
    expect(keys.size).toBeGreaterThan(100);
  });

  it('has English words for all of them', () => {
    const missing = [...keys].filter(([k]) => !resolve(en, k));
    expect(missing.map(([k, f]) => `${k}  (${f})`)).toEqual([]);
  });

  it('has Korean words for all of them', () => {
    const missing = [...keys].filter(([k]) => !resolve(ko, k));
    expect(missing.map(([k, f]) => `${k}  (${f})`)).toEqual([]);
  });
});

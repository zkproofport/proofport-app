/**
 * The host app keeps its own copy of the mini-app's translations, and the copy
 * is what ships.
 *
 * On 2026-08-29 the topic-delete warning was rewritten in the mini-app to say
 * that everyone else's posts and messages go too. The new wording was committed,
 * the mini-app pin was bumped, the app was rebuilt twice — once with the bundler
 * cache cleared — and the phone still showed the old sentence. The bundle was
 * not stale: the string on screen comes from THIS package's `openstoa` block,
 * which had drifted from the mini-app's and wins.
 *
 * Nine strings had drifted by then, not one. Beside the delete warning: the
 * "show more" affordance on a post, and three strings about joining by invite,
 * where the host copy still described pasting a CODE while the mini-app had
 * moved to a LINK. Anyone reading the host copy would have described a flow the
 * app no longer has.
 *
 * This test compares the two and fails on any difference, so the next drift is
 * caught here rather than on a phone after two builds. It only checks keys the
 * host actually carries — the mini-app is free to add strings the host has not
 * copied.
 */
import fs from 'node:fs';
import path from 'node:path';

const repo = path.join(__dirname, '..', '..');
const LOCALES = ['en', 'ko'] as const;

type Tree = { [k: string]: string | Tree };

function read(rel: string): Tree {
  return JSON.parse(fs.readFileSync(path.join(repo, rel), 'utf8'));
}

/** Every leaf the host carries that the mini-app spells differently. */
function drift(host: Tree, mini: Tree, at = ''): string[] {
  const out: string[] = [];
  for (const key of Object.keys(host)) {
    const here = at ? `${at}.${key}` : key;
    const h = host[key];
    const m = (mini as Tree)?.[key];
    if (m === undefined) continue; // the host may carry strings of its own
    if (typeof h === 'object' && typeof m === 'object') {
      out.push(...drift(h, m, here));
    } else if (h !== m) {
      out.push(`${here}\n    host: ${String(h)}\n    mini: ${String(m)}`);
    }
  }
  return out;
}

describe('the mini-app wording is not forked into this package', () => {
  it.each(LOCALES)('%s: every shared string matches the mini-app', (loc) => {
    const host = read(`src/i18n/locales/${loc}.json`).openstoa as Tree;
    const mini = read(`node_modules/openstoa-mobile/src/i18n/locales/${loc}.json`)
      .openstoa as Tree;

    expect(host).toBeTruthy();
    expect(mini).toBeTruthy();

    const differences = drift(host, mini);
    // Printed rather than asserted through a message argument, because jest
    // takes no second argument on expect and a bare "expected 9 to be 0" says
    // nothing about which sentence a reader is about to ship.
    if (differences.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `\n[${loc}] ${differences.length} string(s) drifted from the mini-app:\n  ` +
          differences.join('\n  ') +
          '\n\nThe host copy is the one that ships. Copy the mini-app value here.\n',
      );
    }
    expect(differences).toEqual([]);
  });

  it('the delete warning says whose posts are going, in both languages', () => {
    // The specific sentence this test was written for. Keeping it named means a
    // future sync that silently reverts it fails with a readable reason.
    const en = read('src/i18n/locales/en.json') as Tree;
    const ko = read('src/i18n/locales/ko.json') as Tree;
    const at = (t: Tree) =>
      ((t.openstoa as Tree).topicEdit as Tree).deleteConfirm as string;

    expect(at(en)).toMatch(/for everyone/i);
    expect(at(ko)).toContain('모든 참여자');
  });
});

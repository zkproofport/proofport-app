/**
 * The region proof compares the hash of the name picked in the app with the
 * hash of the first word of the mobile ID's address. A name that has since
 * been changed can never match, so the list must carry the current names.
 *
 * 전라북도 became 전북특별자치도 on 2024-01-18; 강원도 became 강원특별자치도 on
 * 2023-06-11.
 */
import * as fs from 'fs';
import * as path from 'path';

jest.mock('ethers', () => ({utils: {}}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {KR_SI_DO} = require('../mdlKr') as typeof import('../mdlKr');

const SRC = path.resolve(__dirname, '..', '..');
const RETIRED = ['전라북도', '강원도'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx|json)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('the si/do list', () => {
  it('has the 17 first-level divisions, each once', () => {
    expect(KR_SI_DO).toHaveLength(17);
    expect(new Set(KR_SI_DO).size).toBe(17);
  });

  it('uses the current names', () => {
    expect(KR_SI_DO).toContain('전북특별자치도');
    expect(KR_SI_DO).toContain('강원특별자치도');
    for (const old of RETIRED) expect(KR_SI_DO).not.toContain(old);
  });

  it('has no whitespace around any name', () => {
    for (const name of KR_SI_DO) expect(name).toBe(name.trim());
  });

  it('is the one list: no source file spells a retired name, and the screen reads KR_SI_DO', () => {
    const hits = sourceFiles(SRC).filter(file => {
      const text = fs.readFileSync(file, 'utf8');
      // 강원도 is a prefix of nothing current; 전라북도 likewise.
      return RETIRED.some(old => text.includes(`'${old}'`) || text.includes(`"${old}"`));
    });
    expect(hits).toEqual([]);
    const screen = fs.readFileSync(path.join(SRC, 'screens', 'proof', 'MdlKrInputScreen.tsx'), 'utf8');
    expect(screen).toContain('KR_SI_DO.map(');
    expect(screen).not.toMatch(/특별시'|광역시'/);
  });
});

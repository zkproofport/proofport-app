/**
 * Developer Mode is for developer tools — live logs, the kept proof log and
 * the OpenStoa switch —
 * and decides nothing about circuits. It used to hide the Laboratory
 * networks, their wallet rows and their startup download while the
 * Laboratory offered the same proofs to everyone. Only the files below may read
 * the flag; a circuit screen that starts reading it again fails here.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..');
const ALLOWED = [
  'stores/settingsStore.ts',
  'screens/more/AboutScreen.tsx',
  'screens/more/MoreMainScreen.tsx',
  // The live panel and the kept proof log read it through this module's two
  // gates (proofLogEnabled, storedLogsVisible), not the flag directly.
  'utils/proofLog.ts',
  'screens/openstoa/OpenStoaRootScreen.tsx',
  'openstoa-host/zkProofportHostApi.ts',
];

function sources(dir: string): string[] {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('Developer Mode gates no circuit', () => {
  it('is read only by settings, developer tools and OpenStoa', () => {
    const readers = sources(SRC)
      .filter(file => /developerMode|DeveloperMode/.test(fs.readFileSync(file, 'utf8')))
      .map(file => path.relative(SRC, file).split(path.sep).join('/'))
      .sort();
    expect(readers).toEqual([...ALLOWED].sort());
  });

  it('leaves the proof log module reading it in its two gates only', () => {
    const lines = fs.readFileSync(path.join(SRC, 'utils/proofLog.ts'), 'utf8')
      .split('\n').filter(line => line.includes('developerMode'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('settings.developerMode === true && settings.showLiveLogs === true');
    expect(lines[1]).toContain('settings.developerMode === true;');
  });

  it('leaves the proof screen with no developerMode check of its own', () => {
    const screen = fs.readFileSync(path.join(SRC, 'screens/proof/ProofGenerationScreen.tsx'), 'utf8');
    expect(screen).not.toContain('developerMode');
    expect(screen).toContain('proofLogEnabled(settings)');
  });

  it('leaves the More screen reading it for the developer section only', () => {
    const lines = fs.readFileSync(path.join(SRC, 'screens/more/MoreMainScreen.tsx'), 'utf8')
      .split('\n').filter(line => line.includes('developerMode'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('sectionDeveloper');
  });
});

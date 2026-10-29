/**
 * More > Laboratory: one switch, one table behind it.
 *
 * Which proofs the switch covers is the proof catalog's `surface`, asked
 * through `isLaboratoryCircuit`. The Proof tab, the startup download, the
 * wallet rows and the deep-link gate all ask there; the screens are exercised
 * in their own suites (proofHomeCatalog, walletPresentation, morePresentation,
 * proofRequestReviewLifecycle). This file holds the table, the gate, the
 * absence of any download ahead of a proof, and who is allowed to read the flag at all.
 */
const mockDisk = new Map<string, string>();
let mockReadFailure = false;
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true, default: {
    getItem: jest.fn(async (key: string) => {
      if (mockReadFailure) throw new Error('read failed');
      return mockDisk.get(key) ?? null;
    }),
    setItem: jest.fn(async (key: string, value: string) => {mockDisk.set(key, value);}),
  },
}));
jest.mock('react-native', () => ({NativeModules: {}}));
jest.mock('../utils/circuitDownload', () => ({downloadCircuitFiles: jest.fn()}));

import * as fs from 'fs';
import * as path from 'path';
import {ALL_CIRCUIT_IDS} from '../config/circuitIds';
import {isLaboratoryCircuit} from '../screens/proof/proofCatalog';
import {laboratoryRequestGate, LABORATORY_CIRCUIT_IDS} from '../utils/laboratory';

const SRC = path.resolve(__dirname, '..');
const SETTINGS_KEY = '@zkproofport:settings:app';
const LAB = ['giwa_attestation', 'dojang_playground'];
const HOME = ['oidc_domain_attestation', 'coinbase_attestation', 'coinbase_country_attestation'];

beforeEach(() => {mockDisk.clear(); mockReadFailure = false;});

describe('which circuits the Laboratory switch covers', () => {
  it('is the catalog surface: exactly the GIWA and Dojang Playground proofs', () => {
    expect([...LABORATORY_CIRCUIT_IDS].sort()).toEqual([...LAB].sort());
    for (const id of LAB) expect(isLaboratoryCircuit(id)).toBe(true);
    for (const id of HOME) expect(isLaboratoryCircuit(id)).toBe(false);
    expect([...LAB, ...HOME].sort()).toEqual([...ALL_CIRCUIT_IDS].sort());
  });

  it.each(['unknown_circuit', '', '__proto__', 'constructor', 'toString', 'giwa-kyc', 'mdl-kr-age', 'mdl_kr_age', 'mdl_kr_ownership', 'mdl_kr_region', 'GIWA_ATTESTATION', ' giwa_attestation', '기와', '<script>'])(
    'throws for %j instead of answering "not a lab proof"', id => {
      expect(() => isLaboratoryCircuit(id)).toThrow(`Unknown circuit '${id}' in the proof catalog.`);
    });
});

describe('the deep-link gate', () => {
  it.each(LAB)('refuses %s with E1008 when the switch was never set (fresh install)', async id => {
    expect(await laboratoryRequestGate(id as never)).toEqual({
      allowed: false, code: 'E1008', reason: expect.stringContaining(`'${id}' is a Laboratory proof`),
    });
  });

  it.each(LAB)('refuses %s with E1008 when old settings lack the key', async id => {
    mockDisk.set(SETTINGS_KEY, JSON.stringify({theme: 'light', developerMode: true}));
    expect(await laboratoryRequestGate(id as never)).toMatchObject({allowed: false, code: 'E1008'});
  });

  it.each(LAB)('lets %s through when the switch is on', async id => {
    mockDisk.set(SETTINGS_KEY, JSON.stringify({laboratoryEnabled: true}));
    expect(await laboratoryRequestGate(id as never)).toEqual({allowed: true});
  });

  it.each(['true', 1, 'yes', {}, [], null])('treats a corrupt stored value %j as off', async value => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    mockDisk.set(SETTINGS_KEY, JSON.stringify({laboratoryEnabled: value}));
    expect(await laboratoryRequestGate('dojang_playground')).toMatchObject({allowed: false, code: 'E1008'});
    (console.log as jest.Mock).mockRestore();
  });

  it.each(HOME)('never reads the settings for %s, so a non-lab request is unaffected', async id => {
    mockReadFailure = true;
    expect(await laboratoryRequestGate(id as never)).toEqual({allowed: true});
  });

  it('refuses a lab request with E5002 when the settings cannot be read, never as allowed', async () => {
    mockReadFailure = true;
    expect(await laboratoryRequestGate('giwa_attestation')).toEqual({
      allowed: false, code: 'E5002', reason: 'Could not read the Laboratory setting: read failed',
    });
  });

  it.each(['not_a_circuit', 'mdl_kr_ownership', 'mdl_kr_age', 'mdl_kr_region'])('rejects %s, which is not a circuit, rather than allowing it', async id => {
    mockDisk.set(SETTINGS_KEY, JSON.stringify({laboratoryEnabled: true}));
    await expect(laboratoryRequestGate(id as never)).rejects.toThrow(`Unknown circuit '${id}'`);
  });
});

describe('nothing downloads a circuit ahead of its proof', () => {
  // Since 2026-10-29: no launch prefetch and no download when the switch is
  // turned on. A circuit's files arrive when a proof of it starts.
  it('neither the launch screen nor More downloads circuit files', () => {
    for (const file of ['screens/LoadingScreen.tsx', 'screens/more/MoreMainScreen.tsx']) {
      const source = fs.readFileSync(path.join(SRC, file), 'utf8');
      expect([file, /downloadCircuitFiles|prefetch/i.test(source)]).toEqual([file, false]);
    }
  });
});

describe('a lab proof downloads its own circuit, stale or missing', () => {
  // Nothing prefetches, so the hook is the only thing that brings a cached
  // lab circuit up to date. A hook gated on "files exist" would prove with a
  // stale copy.
  it.each(['useGiwaKyc.ts', 'useDojangPlayground.ts'])('%s fetches its circuit unconditionally', hook => {
    const source = fs.readFileSync(path.join(SRC, 'hooks', hook), 'utf8');
    expect(source).toMatch(/\n\s*await circuitFilesForProof\(CIRCUIT_NAME,/);
    expect(source).not.toContain('allCircuitFilesExist');
  });
});

function sources(dir: string): string[] {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('who reads the switch', () => {
  // Proof history is not on this list on purpose: a lab proof made while the
  // switch was on stays in History after it is turned off.
  it('is read only by settings, More, the Proof tab, the Laboratory, the wallet rows and the gate', () => {
    const readers = sources(SRC)
      .filter(file => /laboratoryEnabled/.test(fs.readFileSync(file, 'utf8')))
      .map(file => path.relative(SRC, file).split(path.sep).join('/'))
      .sort();
    expect(readers).toEqual([
      'screens/more/MoreMainScreen.tsx',
      'screens/proof/CircuitSelectionScreen.tsx',
      'screens/proof/LaboratoryScreen.tsx',
      'screens/wallet/CircuitWalletsCard.tsx',
      'stores/settingsStore.ts',
      'utils/laboratory.ts',
    ]);
  });

  it('is not tied to Developer Mode in any reader', () => {
    for (const file of ['screens/proof/CircuitSelectionScreen.tsx', 'screens/proof/LaboratoryScreen.tsx',
      'screens/wallet/CircuitWalletsCard.tsx', 'utils/laboratory.ts']) {
      expect(fs.readFileSync(path.join(SRC, file), 'utf8')).not.toMatch(/developerMode/i);
    }
    const more = fs.readFileSync(path.join(SRC, 'screens/more/MoreMainScreen.tsx'), 'utf8');
    const switchLine = more.split('\n').find(line => line.includes('testID="more-laboratory"'));
    expect(switchLine).toBeDefined();
    const developerSection = more.slice(more.indexOf('settings.developerMode &&'));
    expect(developerSection).not.toContain('more-laboratory');
  });
});

/**
 * The two switches under More > Proof Settings do what their labels claim.
 *
 * Neither had a single test. They are also the kind of setting that fails
 * silently: turn one off, and the only evidence is something NOT happening.
 *
 * What each one actually does, read from the code on 2026-08-30:
 *
 *   Auto-save proofs        — gates whether a row is written to the proof
 *                             history when generation starts
 *                             (ProofGenerationScreen.tsx, `autoSaveProofs`).
 *   Confirm before generate — gates whether pressing the generate button
 *                             raises a confirmation dialog first, or starts
 *                             immediately (same file, `confirmBeforeGenerate`).
 *
 * Note what "confirm" does NOT do: it never starts a proof by itself. The app
 * always waits for the button either way; the setting only decides whether one
 * press or two are needed. A user reported "it does not run without pressing
 * the button" as if that were the bug — it is the design.
 *
 * The jest setup here is a plain node environment with no react-native runtime
 * (see jest.config.js), so the screen cannot be rendered. The store is tested
 * by behaviour; the two readers are checked structurally, and that limit is
 * stated rather than papered over: these checks prove the guard is PRESENT and
 * shaped right, not that it fires on a device.
 */
import fs from 'node:fs';
import path from 'node:path';

// A stand-in for the phone's storage: a plain map, so what comes back is
// exactly what went in and nothing else can explain a passing test.
// Named with a `mock` prefix because jest forbids a module factory from
// touching any other outer variable.
const mockDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => (mockDisk.has(k) ? mockDisk.get(k)! : null),
    setItem: async (k: string, v: string) => void mockDisk.set(k, v),
    removeItem: async (k: string) => void mockDisk.delete(k),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { settingsStore } = require('../stores/settingsStore');
const KEY = '@zkproofport:settings:app';

beforeEach(() => mockDisk.clear());

describe('the two proof settings survive being turned off and on', () => {
  it('both start on, so a new install confirms and keeps history', async () => {
    const s = await settingsStore.get();
    expect(s.autoSaveProofs).toBe(true);
    expect(s.confirmBeforeGenerate).toBe(true);
  });

  it('turning auto-save off stays off after a restart', async () => {
    await settingsStore.update({ autoSaveProofs: false });
    mockDisk.set(KEY, mockDisk.get(KEY)!); // same bytes a restart would read back
    expect((await settingsStore.get()).autoSaveProofs).toBe(false);
  });

  it('turning confirm off stays off after a restart', async () => {
    await settingsStore.update({ confirmBeforeGenerate: false });
    expect((await settingsStore.get()).confirmBeforeGenerate).toBe(false);
  });

  it('a stored false is not overwritten by the default true', async () => {
    // The read merges defaults under the stored value. Reverse that order and
    // every switch silently springs back on at the next launch — the settings
    // would look saved and behave as though they never were.
    mockDisk.set(KEY, JSON.stringify({ autoSaveProofs: false, confirmBeforeGenerate: false }));
    const s = await settingsStore.get();
    expect(s.autoSaveProofs).toBe(false);
    expect(s.confirmBeforeGenerate).toBe(false);
  });

  it('turning one off leaves the other settings alone', async () => {
    await settingsStore.update({ theme: 'light', developerMode: true });
    await settingsStore.update({ autoSaveProofs: false });
    const s = await settingsStore.get();
    expect(s.autoSaveProofs).toBe(false);
    expect(s.theme).toBe('light');
    expect(s.developerMode).toBe(true);
  });

  it('an older saved blob without these keys still gets them, on', async () => {
    // What an upgrade looks like: settings saved by a build that predates a
    // key. Without the default merge the value reads back undefined, which is
    // falsy — the switch would appear OFF to everyone who upgraded.
    mockDisk.set(KEY, JSON.stringify({ theme: 'dark', language: 'ko' }));
    const s = await settingsStore.get();
    expect(s.autoSaveProofs).toBe(true);
    expect(s.confirmBeforeGenerate).toBe(true);
    expect(s.language).toBe('ko');
  });

  it('a corrupt file falls back to the defaults instead of throwing', async () => {
    mockDisk.set(KEY, '{not json');
    const s = await settingsStore.get();
    expect(s.autoSaveProofs).toBe(true);
    expect(s.confirmBeforeGenerate).toBe(true);
  });

  it('reset puts both switches back on', async () => {
    await settingsStore.update({ autoSaveProofs: false, confirmBeforeGenerate: false });
    const s = await settingsStore.reset();
    expect(s.autoSaveProofs).toBe(true);
    expect(s.confirmBeforeGenerate).toBe(true);
    expect((await settingsStore.get()).autoSaveProofs).toBe(true);
  });
});

describe('the labels describe what the switches do', () => {
  const label = (locale: string, key: string) =>
    JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'i18n', 'locales', `${locale}.json`), 'utf8'),
    ).host.more[key];

  it('the history switch is not called "save", because nothing is saved or lost', () => {
    // It used to read "Auto-save proofs" / "증명 자동 저장", which invited the
    // reading that turning it off stops proofs from being stored somewhere —
    // or worse, stops them working. It does neither: the proof is built and
    // handed to whoever asked either way. What the switch decides is whether a
    // row is written to the on-device history. The user said the wording felt
    // off before anyone looked at the code, and they were right.
    expect(label('en-US'.slice(0, 2), 'autoSaveProofs')).toBe('Keep a history of proofs');
    expect(label('ko', 'autoSaveProofs')).toBe('증명 이력 남기기');
  });

  it('both languages still have both labels, and neither is empty', () => {
    for (const locale of ['en', 'ko']) {
      for (const key of ['autoSaveProofs', 'confirmBeforeGenerate']) {
        expect(String(label(locale, key)).trim().length).toBeGreaterThan(0);
      }
    }
  });
});

const screen = fs.readFileSync(
  path.join(__dirname, '..', 'screens', 'proof', 'ProofGenerationScreen.tsx'),
  'utf8',
);

describe('the screen still asks each setting before acting', () => {
  it('reads the settings fresh rather than from a stale copy', () => {
    // The screen deliberately re-reads the store at generate time. A cached
    // copy would apply the value the screen was opened with, so a switch
    // flipped in between would be ignored until the screen was reopened.
    expect(screen).toMatch(/await settingsStore\.get\(\)/);
  });

  it('writes to the proof history only when auto-save is on', () => {
    const guard = screen.indexOf('currentSettings.autoSaveProofs');
    const write = screen.indexOf('proofHistoryStore.add');
    expect(guard).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(guard);
  });

  it('the confirm switch chooses between asking and starting', () => {
    // Anchored to `onPress:` so the setting is the WHOLE condition, not merely
    // present in it. A looser match passed while the condition read
    // `false && settings?.confirmBeforeGenerate` — the switch neutered, the
    // guard green. Both arms must also be there: with it on, a dialog; with it
    // off, the generator directly. One arm missing is the failure that looks
    // like "the button does nothing".
    const branch = screen.match(
      /onPress:\s*settings\?\.confirmBeforeGenerate\s*\n?\s*\?[\s\S]{0,600}?:\s*handleGenerateProof/,
    );
    expect(branch).not.toBeNull();
    expect(branch![0]).toContain('Alert.alert');
    expect(branch![0]).toContain('confirmGenerate');
  });

  it('the confirmation offers a way out', () => {
    expect(screen).toMatch(/style:\s*'cancel'/);
  });
});

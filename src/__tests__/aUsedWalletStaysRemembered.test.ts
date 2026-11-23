/**
 * The wallet remembered for a proof stays remembered while it is used.
 *
 * Until 2026-11-23 the 7-day limit counted from the day the wallet was first
 * chosen: proving with it every day did not move it, and a week later the gate
 * dropped the connected wallet and opened the picker for the same wallet.
 */
import fs from 'fs';
import path from 'path';

const gate = fs.readFileSync(path.join(__dirname, '..', 'hooks', 'useCircuitWalletGate.ts'), 'utf8');

describe('the wallet gate', () => {
  const matchBranch = (() => {
    const start = gate.indexOf('if (C && W && M) {');
    const end = gate.indexOf('return {address: W};', start);
    return start >= 0 && end > start ? gate.slice(start, end) : '';
  })();

  it('refreshes the remembered wallet when the connected one matches it', () => {
    expect(matchBranch).not.toBe('');
    expect(matchBranch).toMatch(/await setCircuitWallet\(key, W\);/);
  });

  it('a failed refresh is logged and does not stop the proof', () => {
    expect(matchBranch).toMatch(/try \{\s*await setCircuitWallet\(key, W\);\s*\} catch \(e\) \{\s*log\(/);
  });
});

describe('the store', () => {
  const store = fs.readFileSync(path.join(__dirname, '..', 'stores', 'circuitWalletStore.ts'), 'utf8');

  it('writing a wallet stamps it with the current time', () => {
    expect(store).toMatch(/map\[circuit\] = \{address, savedAt: Date\.now\(\)\};/);
  });
});

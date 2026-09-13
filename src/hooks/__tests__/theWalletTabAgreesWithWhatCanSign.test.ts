/**
 * One answer to "is a wallet connected", and a disconnect that says when it
 * fails.
 *
 * The app had two answers. The proof flow signs through the PROVIDER; the
 * Wallet tab read the ACCOUNT. A person could produce a proof — the wallet
 * prompted, the signature came back, the proof ran — while the Wallet tab
 * showed nothing connected and offered no way to disconnect. Reported from a
 * simulator on 2026-09-12.
 *
 * The disconnect was dead three ways at once: skipped when the account state
 * said not connected (the state that was already wrong), `await`ed on a
 * function that returns `void`, and every failure written to a value no screen
 * renders.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

describe('the wallet tab agrees with what can sign', () => {
  const hook = read('hooks', 'useWallet.ts');

  it('counts a provider as connected, not only the account state', () => {
    expect(hook).toContain('isConnected || walletProvider');
  });

  it('asks the provider for the address when the account has none', () => {
    expect(hook).toContain("method: 'eth_accounts'");
    expect(hook).toContain('address || providerAddress || null');
  });

  it('parses a CAIP chain id instead of turning it into NaN', () => {
    // AppKit types chainId as `string | number`. `Number('eip155:8453')` is
    // NaN, which rendered as "Chain NaN".
    expect(hook).toMatch(/raw\.includes\(':'\)/);
    expect(hook).toContain('Number.isFinite(n) ? n : null');
  });
});

describe('disconnect tells you when it fails', () => {
  const hook = read('hooks', 'useWallet.ts');

  it('never skips the request because the account state says disconnected', () => {
    expect(hook).not.toMatch(/if \(isConnected\) \{\s*await appKitDisconnect/);
  });

  it('throws on failure instead of only setting a value nobody renders', () => {
    expect(hook).toMatch(/setError\(message\);\s*throw new Error\(message\)/);
  });

  it.each([
    ['the whole session', 'screens/wallet/WalletMainScreen.tsx'],
    ['one circuit row', 'screens/wallet/CircuitWalletsCard.tsx'],
  ])('shows the person an error when %s fails to disconnect', (_what, file) => {
    const screen = read(...file.split('/'));
    expect(screen).toContain("showError('E4004'");
    expect(screen).not.toMatch(/catch[\s\S]{0,80}console\.error\([^)]*disconnect/i);
  });

  it('has words for that error in both languages', () => {
    for (const lang of ['en', 'ko']) {
      const words = JSON.parse(read('i18n', 'locales', `${lang}.json`));
      const node = words.host?.errors ?? words.errors;
      expect(node.E4004?.title?.length).toBeGreaterThan(0);
      expect(node.E4004?.description?.length).toBeGreaterThan(0);
    }
  });
});

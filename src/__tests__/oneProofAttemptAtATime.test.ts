/**
 * One relay request, one attempt. On 2026-11-23 a demo Coinbase KYC request
 * started two attempts on the proof screen: the second failed on the wallet's
 * "Signing already in progress" (E4002) and answered the dApp with an error,
 * while the first proved a request that had already been answered.
 */
import fs from 'fs';
import path from 'path';
import {runOnce} from '../utils/runOnce';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
};

describe('runOnce', () => {
  it('a second start while the first runs is refused and reported', async () => {
    const lock = {current: false};
    const gate = deferred();
    const run = jest.fn(() => gate.promise);
    const busy = jest.fn();
    const first = runOnce(lock, run, busy);
    const second = runOnce(lock, run, busy);
    await second;
    expect(run).toHaveBeenCalledTimes(1);
    expect(busy).toHaveBeenCalledTimes(1);
    gate.resolve();
    await first;
  });

  it('two starts in the same tick, three, or ten still run once', async () => {
    for (const n of [2, 3, 10]) {
      const lock = {current: false};
      const gate = deferred();
      const run = jest.fn(() => gate.promise);
      const calls = Array.from({length: n}, () => runOnce(lock, run, () => {}));
      expect(run).toHaveBeenCalledTimes(1);
      gate.resolve();
      await Promise.all(calls);
    }
  });

  it('a start after the attempt finished runs again', async () => {
    const lock = {current: false};
    const run = jest.fn(async () => {});
    await runOnce(lock, run, () => {});
    await runOnce(lock, run, () => {});
    expect(run).toHaveBeenCalledTimes(2);
    expect(lock.current).toBe(false);
  });

  it('a retry after a failed attempt runs, and the failure still reaches the caller', async () => {
    const lock = {current: false};
    const run = jest.fn(async () => {
      throw new Error('wallet refused');
    });
    await expect(runOnce(lock, run, () => {})).rejects.toThrow('wallet refused');
    expect(lock.current).toBe(false);
    await expect(runOnce(lock, run, () => {})).rejects.toThrow('wallet refused');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('an attempt that throws before its first await releases the lock', async () => {
    const lock = {current: false};
    const run = jest.fn((): Promise<void> => {
      throw new Error('sync');
    });
    await expect(runOnce(lock, run, () => {})).rejects.toThrow('sync');
    expect(lock.current).toBe(false);
  });

  it('a refused start does not touch the running attempt\'s lock', async () => {
    const lock = {current: false};
    const gate = deferred();
    const first = runOnce(lock, () => gate.promise, () => {});
    await runOnce(lock, async () => {}, () => {});
    expect(lock.current).toBe(true);
    gate.resolve();
    await first;
    expect(lock.current).toBe(false);
  });
});

describe('the proof screen', () => {
  const screen = fs.readFileSync(path.join(__dirname, '..', 'screens', 'proof', 'ProofGenerationScreen.tsx'), 'utf8');

  it('every start goes through the lock', () => {
    expect(screen).toMatch(/const handleGenerateProof = useCallback\(\s*\(\) => runOnce\(attemptLockRef, runGenerateProof,/);
    expect(screen.match(/runGenerateProof\(/g) ?? []).toHaveLength(0);
    expect(screen.match(/const attemptLockRef = useRef\(false\)/g) ?? []).toHaveLength(1);
  });

  it('any start for a dApp request marks it started, so the auto-start does not start it again', () => {
    // The 2026-11-23 path: no wallet connected, Connect wallet tapped, and on
    // connect the post-picker retry and the request auto-start both fired.
    expect(screen).toMatch(/const runGenerateProof = useCallback\(async \(\) => \{\n(?:\s*\/\/.*\n)*\s*if \(proofRequest\) hasAutoStarted\.current = true;/);
    const autoStarts = screen.match(/!hasAutoStarted\.current\) \{\n\s*hasAutoStarted\.current = true;/g) ?? [];
    expect(autoStarts).toHaveLength(2);
  });

  it('Connect wallet is not offered until the stored wallet for this circuit has been read', () => {
    // 2026-11-23: on a cold start the stored wallet took about a second to
    // read, and the screen offered Connect wallet to a person whose right
    // wallet was already connected.
    const checking = screen.indexOf("if (!isOidc && !walletChecked && !walletGate.isPostPicker)");
    const connect = screen.indexOf("if (!isOidc && !circuitReady && !walletGate.isPostPicker)");
    expect(checking).toBeGreaterThan(0);
    expect(connect).toBeGreaterThan(checking);
    expect(screen.slice(checking, connect)).toMatch(/checkingWallet'\), onPress: \(\) => \{\}, disabled: true/);
    // The flag drops when the account or circuit changes and rises only once the read has answered.
    expect(screen).toMatch(/setWalletChecked\(false\);\n\s+\(async \(\) => \{[\s\S]*?setCircuitReady\([\s\S]*?\);\n\s+setWalletChecked\(true\);/);
  });

  it('the attempt body is not called anywhere but through the lock', () => {
    const uses = screen.match(/\brunGenerateProof\b/g) ?? [];
    // its declaration, the runOnce call, and the dependency list
    expect(uses).toHaveLength(3);
  });
});

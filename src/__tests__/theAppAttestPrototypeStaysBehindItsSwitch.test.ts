/**
 * The App Attest prototype changes nothing until a developer turns it on, and
 * never answers a dApp.
 *
 * The shipped Coinbase KYC flow (coinbase_attestation from the release) must
 * be what every other path gets: the prototype has no verifier contract, so a
 * dApp that received one of its proofs could only reject it. These read the
 * screen's source because the rule is about WHERE the switch is consulted, the
 * same way developerModeGatesNoCircuit.test.ts holds its rule.
 */
const mockDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => (mockDisk.has(k) ? mockDisk.get(k)! : null),
    setItem: async (k: string, v: string) => void mockDisk.set(k, v),
  },
}));

import * as fs from 'fs';
import * as path from 'path';
import {ethers} from 'ethers';
import {settingsStore} from '../stores/settingsStore';
import {computeScope, computeWalletNullifier, nullifierForCircuit} from '../utils/circuitHelpers';
import {APP_ATTEST_ERROR_CODE} from '../appAttest/appAttestError';
import {ErrorCodes} from '../constants/errorCodes';
import en from '../i18n/locales/en.json';
import ko from '../i18n/locales/ko.json';

const SCREEN = fs.readFileSync(path.join(__dirname, '../screens/proof/ProofGenerationScreen.tsx'), 'utf8');

beforeEach(() => mockDisk.clear());

describe('the switch', () => {
  it('is off by default', async () => {
    expect((await settingsStore.get()).coinbaseAppAttestPrototype).toBe(false);
  });

  it.each([['true'], [1], [null], [{}]])('reads a saved %p that is not a real boolean as off', async value => {
    mockDisk.set('@zkproofport:settings:app', JSON.stringify({coinbaseAppAttestPrototype: value}));
    expect((await settingsStore.get()).coinbaseAppAttestPrototype).toBe(false);
  });

  it('is read only for an in-app proof, never for a dApp request', () => {
    const read = SCREEN.indexOf('coinbaseAppAttestPrototype');
    expect(read).toBeGreaterThan(-1);
    // The one read sits inside `if (!proofRequest) {`.
    const guard = SCREEN.lastIndexOf('if (!proofRequest) {', read);
    expect(guard).toBeGreaterThan(-1);
    const between = SCREEN.slice(guard, read);
    expect((between.match(/{/g) ?? []).length - (between.match(/}/g) ?? []).length).toBeGreaterThan(0);
    expect(SCREEN.split('coinbaseAppAttestPrototype').length - 1).toBe(1);
  });

  it('reports an App Attest failure with the code for its cause, not the generic one', () => {
    expect(SCREEN).toMatch(/error instanceof AppAttestError \? error\.code : 'E2001'/);
  });
});

describe('the codes it raises', () => {
  it.each(Object.entries(APP_ATTEST_ERROR_CODE))('%s -> %s is registered and translated', (_cause, code) => {
    expect(ErrorCodes[code as keyof typeof ErrorCodes]).toBeDefined();
    const e = (en as any).host.errors[code];
    const k = (ko as any).host.errors[code];
    expect(e?.title && e?.description).toBeTruthy();
    expect(k?.title && k?.description).toBeTruthy();
    expect(k.description).not.toBe(e.description);
  });
});

describe('the prototype nullifier', () => {
  const wallet = '0x5a7D0f4ecc8bBFDE105ab34c1a5d1A2f4372580F';
  const scope = computeScope('proofport');

  it('is the wallet + keccak256("coinbase_attestation") + scope rule, not the package name', () => {
    const n = nullifierForCircuit('coinbase_app_attest_poc', wallet, new Uint8Array(32), scope);
    expect(ethers.utils.hexlify(n)).toBe(ethers.utils.hexlify(computeWalletNullifier(wallet, 'coinbase_attestation', scope)));
    expect(ethers.utils.hexlify(n)).not.toBe(ethers.utils.hexlify(computeWalletNullifier(wallet, 'coinbase_app_attest_poc', scope)));
  });

  it('does not depend on signal_hash (two signals, one nullifier)', () => {
    const a = nullifierForCircuit('coinbase_app_attest_poc', wallet, new Uint8Array(32).fill(1), scope);
    const b = nullifierForCircuit('coinbase_app_attest_poc', wallet, new Uint8Array(32).fill(2), scope);
    expect(ethers.utils.hexlify(a)).toBe(ethers.utils.hexlify(b));
  });

  it('leaves the shipped circuit on its signal_hash rule', () => {
    const a = nullifierForCircuit('coinbase_attestation', wallet, new Uint8Array(32).fill(1), scope);
    const b = nullifierForCircuit('coinbase_attestation', wallet, new Uint8Array(32).fill(2), scope);
    expect(ethers.utils.hexlify(a)).not.toBe(ethers.utils.hexlify(b));
  });

  it.each(['__proto__', 'constructor', 'unknown_circuit'])('refuses %s instead of picking a rule', id => {
    expect(() => nullifierForCircuit(id, wallet, new Uint8Array(32), scope)).toThrow(/No nullifier rule/);
  });
});

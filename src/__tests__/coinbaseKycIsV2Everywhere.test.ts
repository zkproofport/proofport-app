/**
 * Coinbase KYC is v2 in this build, everywhere: every Coinbase KYC proof --
 * from the Proof tab or from a dApp's request -- goes through App Attest and
 * the v2 circuit under the id `coinbase_attestation`, with v2's verifier, v2's
 * nullifier rule and v2's optional EIP-712 action. Nothing switches it, and no
 * "prototype" survives in the app's own wording.
 */
const mockDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => (mockDisk.has(k) ? mockDisk.get(k)! : null),
    setItem: async (k: string, v: string) => void mockDisk.set(k, v),
  },
}));

/* eslint-disable @typescript-eslint/no-var-requires */
// Required, not imported. With these as static imports the project's type
// check picks react-native's AbortSignal over the one DOM fetch expects, and
// reports errors in unrelated files (deployments.ts, fetchWithDeadline.ts).
const fs = require('fs');
const path = require('path');
const {ethers} = require('ethers');
const {settingsStore} = require('../stores/settingsStore');
const {computeScope, computeWalletNullifier, nullifierForCircuit} = require('../utils/circuitHelpers');
const {APP_ATTEST_ERROR_CODE} = require('../appAttest/appAttestError');
const {ErrorCodes} = require('../constants/errorCodes');
const {BROADCAST_PATHS, FALLBACK_VERIFIERS} = require('../config/contracts');
const {CIRCUIT_ACTION_BINDING, circuitActionBinding} = require('../config/circuitIds');
const {CIRCUIT_ACTION_BINDING: CORE_BINDING} = require('@zkproofport-app/core/circuits');
const {validateProofRequest} = require('../utils/deeplink');
const en = require('../i18n/locales/en.json');
const ko = require('../i18n/locales/ko.json');
/* eslint-enable @typescript-eslint/no-var-requires */

const SRC = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const SCREEN = read('screens/proof/ProofGenerationScreen.tsx');

beforeEach(() => mockDisk.clear());

describe('no switch', () => {
  it('has no App Attest setting', async () => {
    expect(Object.keys(await settingsStore.get())).not.toContain('coinbaseAppAttestPrototype');
  });

  it('makes the App Attest statement for every Coinbase KYC request, dApp requests included', () => {
    const call = SCREEN.indexOf('prepareCoinbaseKycStatement({');
    expect(call).toBeGreaterThan(-1);
    // Not inside an `if (!proofRequest)` (or any settings read) before it in
    // the Coinbase branch.
    const branch = SCREEN.lastIndexOf('} else {', call);
    expect(SCREEN.slice(branch, call)).not.toMatch(/proofRequest\)\s*\{|settingsStore/);
    expect(SCREEN).toMatch(/appAttest: \{witness: appAttestWitness, action\}/);
  });

  it('says "prototype" nowhere in the Coinbase KYC v2 code or the app\'s words', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== '__tests__') walk(full);
        } else if (/\.(tsx?|json)$/.test(e.name)) {
          // `Object.prototype` / `getPrototypeOf` are JavaScript, not wording.
          const text = fs.readFileSync(full, 'utf8').replace(/Object\.prototype|getPrototypeOf|\.prototype\b/g, '');
          if (/prototype/i.test(text)) offenders.push(path.relative(SRC, full));
        }
      }
    };
    for (const dir of ['appAttest', 'config', 'hooks', 'screens/proof', 'i18n', 'constants/errorCodes.ts']) {
      const full = path.join(SRC, dir);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (!/prototype/i.test(fs.readFileSync(full, 'utf8'))) continue;
      else offenders.push(dir);
    }
    for (const f of ['utils/coinbaseAppAttestInputs.ts', 'utils/coinbaseSignal.ts', 'utils/circuitDownload.ts']) {
      if (/prototype/i.test(fs.readFileSync(path.join(SRC, f), 'utf8').replace(/Object\.prototype/g, ''))) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it('reports an App Attest failure with the code for its cause, not the generic one', () => {
    expect(SCREEN).toMatch(/error instanceof AppAttestError\s*\?\s*\{code: error\.code, error: msg, deviceCheckReason: error\.reason\}\s*:\s*\{code: 'E2001', error: msg\}/);
  });
});

describe('the verifier', () => {
  it('is the Base Sepolia v2 deploy for development and staging, and none for production', () => {
    expect(FALLBACK_VERIFIERS.development.coinbase_attestation).toBe('0x1885aA2283DB21ad0fc63A2Df98efe92F31908E6');
    expect(FALLBACK_VERIFIERS.staging.coinbase_attestation).toBe('0x1885aA2283DB21ad0fc63A2Df98efe92F31908E6');
    // circuits 1d41d85, broadcast/DeployCoinbaseAttestationV2.s.sol/8453; never v1's 0xF7dED73E...5382.
    expect(FALLBACK_VERIFIERS.production.coinbase_attestation).toBe('0x6FC22d3576FB70457d1529B3F70f711A3cBA7A7F');
  });

  it('is not refreshed from a broadcast on main, which names the v1 contract', () => {
    expect(BROADCAST_PATHS.coinbase_attestation).toBeNull();
  });
});

describe('the action', () => {
  it("is optional for coinbase_attestation, and the app reads core's row unchanged", () => {
    expect(CORE_BINDING.coinbase_attestation).toBe('optional');
    expect(circuitActionBinding('coinbase_attestation')).toBe('optional');
    expect(CIRCUIT_ACTION_BINDING.coinbase_attestation).toBe(CORE_BINDING.coinbase_attestation);
    // Coinbase Country v2 is the app's one override (coinbaseCountryIsV2Everywhere.test.ts).
    expect(CIRCUIT_ACTION_BINDING.coinbase_country_attestation).toBe('optional');
  });

  it.each(['__proto__', 'constructor', 'arc_eligibility'])('refuses %s instead of picking a binding', id => {
    expect(() => circuitActionBinding(id)).toThrow(/Unknown circuit/);
  });

  const request = (inputs: Record<string, unknown>) => ({
    requestId: 'r1', circuit: 'coinbase_attestation', callbackUrl: 'https://relay.zkproofport.app/api/v1/proof/callback',
    createdAt: Date.now(), inputs,
  });
  const action = {
    domain: {name: 'Forum', version: '1', chainId: 84532, verifyingContract: '0x1111111111111111111111111111111111111111'},
    types: {Join: [{name: 'topicId', type: 'string'}]},
    primaryType: 'Join',
    message: {topicId: '한국어 topic'},
  };

  it('is accepted on a dApp request for coinbase_attestation, and still checked', () => {
    expect(validateProofRequest(request({scope: 's', action}) as never)).toEqual({valid: true});
    expect(validateProofRequest(request({scope: 's'}) as never)).toEqual({valid: true});
    const bad = validateProofRequest(request({scope: 's', action: {...action, primaryType: ''}}) as never);
    expect(bad.valid).toBe(false);
  });

  it('opens from the Coinbase KYC card on the action screen, limited to the same surface', () => {
    expect(read('screens/proof/proofCatalog.ts')).toMatch(/navigate\('ActionInput', \{circuit: 'coinbase_attestation'\}\)/);
    expect(read('screens/proof/ActionInputScreen.tsx')).toMatch(/actionCircuitsFor\(route\.params\.circuit\)/);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {actionCircuitsFor} = require('../screens/proof/actionCircuits');
    expect(actionCircuitsFor('coinbase_attestation')).toEqual(['coinbase_attestation']);
    expect(actionCircuitsFor('giwa_attestation').sort()).toEqual(['dojang_playground', 'giwa_attestation']);
  });
});

describe('the codes it raises', () => {
  it.each(Object.entries(APP_ATTEST_ERROR_CODE) as [string, string][])('%s -> %s is registered and translated', (_cause, code) => {
    expect(ErrorCodes[code]).toBeDefined();
    const e = (en as any).host.errors[code];
    const k = (ko as any).host.errors[code];
    expect(e?.title && e?.description).toBeTruthy();
    expect(k?.title && k?.description).toBeTruthy();
    expect(k.description).not.toBe(e.description);
  });
});

describe('the nullifier', () => {
  const wallet = '0x5a7D0f4ecc8bBFDE105ab34c1a5d1A2f4372580F';
  const scope = computeScope('proofport');

  it('is the wallet + keccak256("coinbase_attestation") + scope rule', () => {
    const n = nullifierForCircuit('coinbase_attestation', wallet, new Uint8Array(32), scope);
    expect(ethers.utils.hexlify(n)).toBe(ethers.utils.hexlify(computeWalletNullifier(wallet, 'coinbase_attestation', scope)));
  });

  it('does not depend on signal_hash (an action proof and a signal proof share it)', () => {
    const a = nullifierForCircuit('coinbase_attestation', wallet, new Uint8Array(32).fill(1), scope);
    const b = nullifierForCircuit('coinbase_attestation', wallet, new Uint8Array(32), scope);
    expect(ethers.utils.hexlify(a)).toBe(ethers.utils.hexlify(b));
  });

  it('gives Coinbase Country v2 its own tag, so the two circuits never share a nullifier', () => {
    const a = nullifierForCircuit('coinbase_country_attestation', wallet, new Uint8Array(32).fill(1), scope);
    const b = nullifierForCircuit('coinbase_country_attestation', wallet, new Uint8Array(32).fill(2), scope);
    expect(ethers.utils.hexlify(a)).toBe(ethers.utils.hexlify(b));
    expect(ethers.utils.hexlify(a)).toBe(ethers.utils.hexlify(computeWalletNullifier(wallet, 'coinbase_country_attestation', scope)));
    expect(ethers.utils.hexlify(a)).not.toBe(ethers.utils.hexlify(nullifierForCircuit('coinbase_attestation', wallet, new Uint8Array(32), scope)));
  });

  it.each(['__proto__', 'constructor', 'coinbase_app_attest_poc'])('refuses %s instead of picking a rule', id => {
    expect(() => nullifierForCircuit(id, wallet, new Uint8Array(32), scope)).toThrow(/No nullifier rule/);
  });
});

export {};

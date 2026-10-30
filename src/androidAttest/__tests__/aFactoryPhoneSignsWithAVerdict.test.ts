/**
 * A factory-provisioned phone end to end, with a fake native module and a
 * fake relay: one key signs the statement, the chain is classified
 * `android_factory`, a Play Integrity token is requested for exactly
 * SHA256(SHA256(statement) || r || s) (low s, base64url, no padding), the
 * relay's answer is checked, and the circuit's inputs come out as the
 * circuits' own generators make them (fixtures/androidFactoryVectors.json:
 * chain.js factoryChainInputs, android.js playIntegrityNonce / playToken).
 * Also: the chain kind is learned once and kept, a change of kind is
 * refused, and the proof callback names the variant.
 */
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'android'}}));
const mockDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => (mockDisk.has(k) ? mockDisk.get(k)! : null),
    setItem: async (k: string, v: string) => void mockDisk.set(k, v),
  },
}));

import {AppAttestError} from '../../appAttest/appAttestError';
import {COINBASE_ATTESTER, COINBASE_KYC_SCHEMA_UID} from '../../appAttest/clientData';
import {prepareCoinbaseKycStatement} from '../../appAttest/coinbaseKycStatement';
import {__setAndroidChainKindForTests, knownAndroidChainKind} from '../../config/signerPlatform';
import {GOOGLE_KEY_ATTESTATION_CA1} from '../../utils/androidKeyAttestation';
import {proofSignerVariant, requireVerifierForVariant, verifierForProof} from '../../utils/proofSignerVariant';
import factory from '../../utils/__tests__/fixtures/androidFactoryVectors.json';
import {ZKPROOFPORT_ANDROID_APP} from '../androidChainChecks';
import {CHAIN_KIND_PROBE, ensureAndroidChainKind, signStatementOnAndroid} from '../androidSigner';
import {isAndroidFactorySignerInputs} from '../androidSignerInputs';
import {ANDROID_NATIVE_CODE} from '../nativeAndroidKeyAttestation';
import rkp from '../../utils/__tests__/fixtures/androidChainVectors.json';

const s = factory.synthetic;
const tokens = s.tokens as unknown as Record<string, {relay: {protectedHeader: string; payload: string; signature: string}; payloadB64Padded: string; payloadB64Len: number; signatureLow: string}>;
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const bytes = (h: string) => Uint8Array.from(Buffer.from(h, 'hex'));
const STATEMENT = bytes(s.statement);
const NOW = Date.UTC(2026, 2, 1) / 1000;
const TRUST = {
  app: ZKPROOFPORT_ANDROID_APP,
  rootKey: GOOGLE_KEY_ATTESTATION_CA1,
  rsaRootModulusHex: s.rsaRootModulusHex,
  playIntegrityKey: bytes(s.playKey),
};
const TEGU = (rkp.cases as unknown as Record<string, {chain: string[]}>)['tegu-sdk36-tee-ec-2026-root'].chain;

function fakePhone(opts: {chain?: string[]; integrity?: () => Promise<string>} = {}) {
  const statements: string[] = [];
  const nonces: string[] = [];
  return {
    statements,
    nonces,
    native: {
      attestAndSign: jest.fn(async (b64: string) => {
        statements.push(b64);
        return {chain: opts.chain ?? s.chain, signature: Buffer.from(s.statementSigDer, 'hex').toString('base64'), strongBox: false, sdkInt: 31};
      }),
      requestIntegrityToken: jest.fn(async (nonce: string) => {
        nonces.push(nonce);
        return opts.integrity ? opts.integrity() : 'jwe.compact.token.from.play.integrity';
      }),
    },
  };
}
const relay = (name = 'good') => ({decrypt: jest.fn(async (_token: string) => tokens[name].relay)});

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof AppAttestError ? e.code : `not ours: ${String(e)}`;
  }
  return 'ok';
}

beforeEach(() => {
  __setAndroidChainKindForTests(null);
  mockDisk.clear();
});

describe('a factory-provisioned phone signs a statement', () => {
  it("produces exactly the circuits' own inputs", async () => {
    const phone = fakePhone();
    const integrity = relay();
    const logs: string[] = [];
    const out = await signStatementOnAndroid(STATEMENT, {now: NOW, log: m => logs.push(m), native: phone.native as never, trust: TRUST, integrity});
    expect(isAndroidFactorySignerInputs(out)).toBe(true);
    if (!isAndroidFactorySignerInputs(out)) return;

    // One key, over exactly the statement; one verdict, for exactly the nonce.
    expect(phone.statements).toEqual([Buffer.from(STATEMENT).toString('base64')]);
    expect(phone.nonces).toEqual([s.nonceBase64Url]);
    expect(integrity.decrypt).toHaveBeenCalledWith('jwe.compact.token.from.play.integrity');

    const chain = (s.expectedChain as {inputs: Record<string, string | number | string[]>}).inputs;
    expect(hex(out.statement_sig)).toBe(s.statementSigLow);
    expect(hex(out.ik_tbs)).toBe(chain.ik_tbs);
    expect(out.ik_tbs_len).toBe(chain.ik_tbs_len);
    expect(out.ik_sig.map(String)).toEqual(chain.ik_sig);
    expect(hex(out.batch_tbs)).toBe(chain.batch_tbs);
    expect(hex(out.batch_sig)).toBe(chain.batch_sig);
    expect(hex(out.leaf_tbs)).toBe(chain.leaf_tbs);
    expect(hex(out.leaf_sig)).toBe(chain.leaf_sig);
    expect(hex(out.integrity_payload_b64)).toBe(tokens.good.payloadB64Padded);
    expect(out.integrity_payload_b64_len).toBe(tokens.good.payloadB64Len);
    expect(hex(out.integrity_signature)).toBe(tokens.good.signatureLow);
    expect(out.rsa_root_modulus.map(String)).toEqual(s.rsaRootParams.modulus);
    expect(out.rsa_root_redc.map(String)).toEqual(s.rsaRootParams.redc);
    expect(hex(out.play_integrity_key)).toBe(s.playKey);

    expect(knownAndroidChainKind()).toBe('android_factory');
    expect(logs.join('\n')).not.toContain('jwe.compact.token');
  });

  it.each([
    ['a verdict without device integrity', 'basicIntegrityOnly', 'E2017'],
    ['a verdict for an unrecognized app', 'unrecognizedApp', 'E2017'],
    ["a verdict for another statement's nonce", 'otherNonce', 'E2016'],
  ])('refuses %s (%s) before proving', async (_l, name, code) => {
    const phone = fakePhone();
    expect(await codeOf(signStatementOnAndroid(STATEMENT, {now: NOW, log: () => {}, native: phone.native as never, trust: TRUST, integrity: relay(name)}))).toBe(code);
  });

  it('refuses an unlocked phone before asking for a verdict', async () => {
    const phone = fakePhone({chain: s.unlockedChain});
    const integrity = relay();
    expect(await codeOf(signStatementOnAndroid(STATEMENT, {now: NOW, log: () => {}, native: phone.native as never, trust: TRUST, integrity}))).toBe('E2015');
    expect(phone.nonces).toEqual([]);
    expect(integrity.decrypt).not.toHaveBeenCalled();
  });

  it.each([
    [ANDROID_NATIVE_CODE.integrityTransient, 'E3008'],
    [ANDROID_NATIVE_CODE.integrityUnavailable, 'E2015'],
    [ANDROID_NATIVE_CODE.invalidInput, 'E2016'],
  ])('a Play Integrity failure %s -> %s, and nothing is sent to the relay', async (nativeCode, code) => {
    const phone = fakePhone({integrity: async () => {
      throw Object.assign(new Error('Play Integrity failed (errorCode -3)'), {code: nativeCode});
    }});
    const integrity = relay();
    expect(await codeOf(signStatementOnAndroid(STATEMENT, {now: NOW, log: () => {}, native: phone.native as never, trust: TRUST, integrity}))).toBe(code);
    expect(integrity.decrypt).not.toHaveBeenCalled();
  });

  it("passes the relay's refusal through with its code", async () => {
    const phone = fakePhone();
    const integrity = {decrypt: jest.fn(async () => {
      throw new AppAttestError('integrity_service_unavailable', 'The device check service answered HTTP 503 (not_configured)');
    })};
    expect(await codeOf(signStatementOnAndroid(STATEMENT, {now: NOW, log: () => {}, native: phone.native as never, trust: TRUST, integrity}))).toBe('E3008');
  });
});

describe('the chain kind', () => {
  it('is learned with one probe key, kept on the phone, and not probed again', async () => {
    const phone = fakePhone();
    expect(await ensureAndroidChainKind(phone.native as never, () => {}, TRUST)).toBe('android_factory');
    expect(await ensureAndroidChainKind(phone.native as never, () => {}, TRUST)).toBe('android_factory');
    expect(phone.statements).toEqual([Buffer.from(CHAIN_KIND_PROBE).toString('base64')]);
    expect(phone.nonces).toEqual([]);
    expect(mockDisk.get('@zkproofport:androidChainKind:v1')).toBe('android_factory');
  });

  it('a change of kind since the files were chosen is refused (E2016), and the new kind kept', async () => {
    __setAndroidChainKindForTests('android');
    const phone = fakePhone();
    expect(await codeOf(signStatementOnAndroid(STATEMENT, {now: NOW, log: () => {}, native: phone.native as never, trust: TRUST, integrity: relay()}))).toBe('E2016');
    expect(knownAndroidChainKind()).toBe('android_factory');
    expect(phone.nonces).toEqual([]);
  });

  it('an RKP phone never asks for a verdict', async () => {
    const phone = fakePhone({chain: TEGU});
    const integrity = relay();
    // Tegu's leaf is Google's test app: refused by name after classification, before any verdict.
    expect(await codeOf(signStatementOnAndroid(STATEMENT, {now: NOW, log: () => {}, native: phone.native as never, trust: TRUST, integrity}))).toBe('E2015');
    expect(knownAndroidChainKind()).toBe('android');
    expect(phone.nonces).toEqual([]);
    expect(integrity.decrypt).not.toHaveBeenCalled();
  });
});

describe('Coinbase KYC v2 on a factory phone', () => {
  it('makes an android_factory statement over the 225-byte clientData', async () => {
    const wallet = '0x' + 'ab'.repeat(20);
    const phone = fakePhone();
    const integrity = relay();
    // The signature in the fixture is over the fixture's statement, not this
    // clientData: the app does not verify it (the circuit does), so the flow
    // runs; the nonce is then this clientData's, which the verdict does not
    // carry -- refused as E2016, after exactly one verdict request.
    const code = await codeOf(prepareCoinbaseKycStatement(
      {walletAddress: wallet, attestationUid: '0x' + 'cd'.repeat(32), scopeString: 'scope', log: () => {}},
      {
        android: {native: phone.native as never, trust: TRUST, integrity},
        revocation: {
          fetchStatus: async uid => ({uid, schemaId: COINBASE_KYC_SCHEMA_UID, attester: COINBASE_ATTESTER, recipient: wallet, revoked: false}),
          now: () => NOW,
        },
      },
    ));
    expect(code).toBe('E2016');
    expect(phone.statements).toHaveLength(1);
    expect(Buffer.from(phone.statements[0], 'base64')).toHaveLength(225);
    expect(phone.nonces).toHaveLength(1);
    expect(knownAndroidChainKind()).toBe('android_factory');
  });
});

describe("the proof callback's signerVariant", () => {
  it.each([
    ['coinbase_attestation', 'android_factory'],
    ['coinbase_attestation', 'android'],
    ['oidc_domain_attestation', 'standard'],
  ])('%s proved as %s says so', (circuit, v) => {
    expect(proofSignerVariant(circuit, {signerVariant: v})).toBe(v);
  });

  it('every other circuit is standard', () => {
    expect(proofSignerVariant('giwa_attestation', {signerVariant: 'android'})).toBe('standard');
    expect(proofSignerVariant('dojang_playground', {})).toBe('standard');
  });

  it('Coinbase Country v2 is per-signer too: its proof says which package made it, or is an error', () => {
    for (const v of ['standard', 'android', 'android_factory']) {
      expect(proofSignerVariant('coinbase_country_attestation', {signerVariant: v})).toBe(v);
    }
    expect(() => proofSignerVariant('coinbase_country_attestation', {})).toThrow(/does not say which package/);
  });

  it('a per-signer proof that does not say is an error, never "standard"', () => {
    expect(() => proofSignerVariant('oidc_domain_attestation', {})).toThrow(/does not say which package made it \(signerVariant null\)/);
    expect(() => proofSignerVariant('coinbase_attestation', {signerVariant: 'app_attest'})).toThrow(/"app_attest"/);
  });
});

describe("the verifier an Android proof names", () => {
  it('is its package\'s own contract in development and staging, null for standard', () => {
    expect(verifierForProof('coinbase_attestation', 'standard', 'staging')).toBeNull();
    expect(verifierForProof('coinbase_attestation', 'android_factory', 'staging')).toEqual({address: '0xBFAf9390c36d14D596556e42eb52d984De040Aa1', chainId: 84532});
    expect(verifierForProof('oidc_domain_attestation', 'android', 'development')).toEqual({address: '0x64866bf6734ed43d34799C7949f5eCb35B7e7e44', chainId: 84532});
  });

  it('is its package\'s Base mainnet contract in production', () => {
    expect(verifierForProof('coinbase_attestation', 'android_factory', 'production')).toEqual({address: '0x87d9a66CAcaC95b2Bc43bAc8E610c59ACB67c5E0', chainId: 8453});
    expect(verifierForProof('oidc_domain_attestation', 'android', 'production')).toEqual({address: '0x3D99a36B39231Bc35f6E840f18AC443bf5D229de', chainId: 8453});
  });

  it.each(['android', 'android_factory'] as const)('a circuit with no %s package: E2018 before proving, never the standard address', variant => {
    for (const env of ['staging', 'production'] as const) {
      let code = '';
      try {
        requireVerifierForVariant('giwa_attestation', variant, env);
      } catch (e) {
        code = e instanceof AppAttestError ? e.code : String(e);
      }
      expect([env, code]).toEqual([env, 'E2018']);
    }
  });

  it('an iPhone proof is never refused for want of an Android verifier', () => {
    expect(() => requireVerifierForVariant('coinbase_attestation', 'app_attest', 'production')).not.toThrow();
  });
});

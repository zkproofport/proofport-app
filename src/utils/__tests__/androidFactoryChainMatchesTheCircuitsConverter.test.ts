/**
 * The app's factory-chain converter (androidFactoryChainInputs) against
 * circuits' chain.js factoryChainInputs, byte for byte, and the chain-kind
 * classifier that decides which Android circuit a phone proves with.
 *
 * fixtures/androidFactoryVectors.json is written by
 * scripts/export-android-signer-fixtures.js: Google's real factory chains
 * (Sony Xperia 10 III, Android 13; Pixel 3 "blueline", Android 9, with an
 * UNLOCKED bootloader), chains derived from them, and a SYNTHETIC factory
 * device under the synthetic RSA root. Public certificates, no personal data.
 */
import {AppAttestError} from '../../appAttest/appAttestError';
import {N_P256, N_P384} from '../../appAttest/constants';
import {
  ANDROID_FACTORY_TBS_LIMITS,
  androidFactoryChainInputs,
  classifyAndroidChain,
  GOOGLE_KEY_ATTESTATION_CA1,
  GOOGLE_RSA_ROOT_MODULUS_HEX,
  limbs120,
  rsa4096Params,
  rsaModulusOf,
  type AndroidFactoryChainInputs,
} from '../androidKeyAttestation';
import factory from './fixtures/androidFactoryVectors.json';
import rkp from './fixtures/androidChainVectors.json';

type Expected = {ok: true; inputs: Record<string, string | number | string[]>} | {ok: false; error: string};
const real = factory.real as unknown as Record<string, {chain: string[]; expected: Expected}>;
const der = (chain: string[]) => chain.map(b => Uint8Array.from(Buffer.from(b, 'base64')));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const ROOTS = {rootKey: GOOGLE_KEY_ATTESTATION_CA1, rsaRootModulusHex: GOOGLE_RSA_ROOT_MODULUS_HEX};

function asText(i: AndroidFactoryChainInputs): Record<string, string | number | string[]> {
  const out: Record<string, string | number | string[]> = {};
  for (const [k, v] of Object.entries(i)) {
    out[k] = v instanceof Uint8Array ? hex(v) : Array.isArray(v) ? v.map(x => x.toString()) : v;
  }
  return out;
}

function refusal(f: () => unknown): {code: string; message: string} {
  try {
    f();
  } catch (e) {
    if (e instanceof AppAttestError) return {code: e.code, message: e.message};
    return {code: `not ours: ${String(e)}`, message: String(e)};
  }
  return {code: 'accepted', message: ''};
}

describe('the pinned RSA root', () => {
  it("is chain.js's modulus, and its limbs are chain.js's rsa4096Params", () => {
    expect(GOOGLE_RSA_ROOT_MODULUS_HEX).toBe(factory.googleRsaRootModulusHex);
    const p = rsa4096Params(GOOGLE_RSA_ROOT_MODULUS_HEX);
    expect(p.modulus.map(String)).toEqual(factory.googleRsaRootParams.modulus);
    expect(p.redc.map(String)).toEqual(factory.googleRsaRootParams.redc);
    expect(ANDROID_FACTORY_TBS_LIMITS).toEqual(factory.limits);
  });

  it('is the key in the real Sony root certificate', () => {
    expect(rsaModulusOf(der(real['sony-xperia10iii-sdk33-factory'].chain)[3], 'root')).toBe(GOOGLE_RSA_ROOT_MODULUS_HEX);
  });

  it('limbs120 refuses a value that does not fit, and rsa4096Params a short modulus', () => {
    expect(() => limbs120(1n << 4200n, 35)).toThrow(/does not fit 35 limbs/);
    expect(() => rsa4096Params('ff'.repeat(256))).toThrow(/not a 4096-bit modulus/);
  });
});

describe('every factory chain chain.js accepts converts to identical inputs', () => {
  const accepted = Object.entries(real).filter(([, c]) => c.expected.ok);

  it('covers Sony, blueline, no root, and the 2022 root certificate of the same key', () => {
    expect(accepted.map(([n]) => n).sort()).toEqual([
      'blueline-sdk28-tee-ec-factory',
      'sony-under-the-2022-root-certificate',
      'sony-without-root',
      'sony-xperia10iii-sdk33-factory',
    ]);
  });

  it.each(accepted)('%s', (_name, c) => {
    const out = androidFactoryChainInputs(der(c.chain), GOOGLE_RSA_ROOT_MODULUS_HEX);
    expect(asText(out)).toEqual((c.expected as {inputs: unknown}).inputs);
    expect(out.ik_tbs).toHaveLength(512);
    expect(out.batch_tbs).toHaveLength(512);
    expect(out.leaf_tbs).toHaveLength(1024);
    expect(out.ik_sig).toHaveLength(35);
    expect(BigInt('0x' + hex(out.batch_sig.slice(48))) <= N_P384 / 2n).toBe(true);
    expect(BigInt('0x' + hex(out.leaf_sig.slice(32))) <= N_P256 / 2n).toBe(true);
  });

  it('the synthetic device converts the same as chain.js under the synthetic root', () => {
    const s = factory.synthetic;
    expect(s.expectedChain.ok).toBe(true);
    expect(asText(androidFactoryChainInputs(der(s.chain), s.rsaRootModulusHex))).toEqual((s.expectedChain as {inputs: unknown}).inputs);
  });
});

describe('every factory chain chain.js refuses is refused, by name', () => {
  it.each([
    ['sony-five-certificates', /got 5 in all/],
    ['sony-two-certificates', /got 2 in all/],
    ['sony-under-ca1', /does not end at the pinned RSA root/],
  ])('%s (E2015)', (name, message) => {
    expect(real[name].expected.ok).toBe(false);
    const r = refusal(() => androidFactoryChainInputs(der(real[name].chain), GOOGLE_RSA_ROOT_MODULUS_HEX));
    expect(r.code).toBe('E2015');
    expect(r.message).toMatch(message);
  });

  it('a chain under another RSA root (the synthetic one) is refused against Google\'s', () => {
    expect(refusal(() => androidFactoryChainInputs(der(factory.synthetic.chain), GOOGLE_RSA_ROOT_MODULUS_HEX)).message)
      .toMatch(/does not end at the pinned RSA root/);
  });

  it('refuses a modulus argument that is not 4096 bits of hex', () => {
    expect(() => androidFactoryChainInputs(der(real['sony-without-root'].chain), 'abcd')).toThrow(/1024 hex characters/);
  });
});

describe('which circuit a chain belongs to', () => {
  const cases = rkp.cases as unknown as Record<string, {chain: string[]}>;

  it.each([
    ['tegu-sdk36-tee-ec-2026-root (RKP, CA1)', () => cases['tegu-sdk36-tee-ec-2026-root'].chain, 'android'],
    ['tegu-sdk36-sb-ec-2026-root (RKP, CA1)', () => cases['tegu-sdk36-sb-ec-2026-root'].chain, 'android'],
    ['sony (factory, RSA root)', () => real['sony-xperia10iii-sdk33-factory'].chain, 'android_factory'],
    ['blueline (factory, RSA root)', () => real['blueline-sdk28-tee-ec-factory'].chain, 'android_factory'],
  ])('%s -> %s', (_l, chain, kind) => {
    expect(classifyAndroidChain(der(chain()), ROOTS)).toBe(kind);
  });

  it.each([
    ['akita: RKP intermediates under the old RSA root (5 certificates)', () => cases['akita-sdk34-tee-ec-rsa-root'].chain, /must end at Key Attestation CA1/],
    ['an RKP chain without its root (4 certificates)', () => cases['tegu-tee-without-root'].chain, /must be factory-provisioned under Google's RSA root/],
    ['a factory chain without its root (3)', () => real['sony-without-root'].chain, /got 3/],
    ['six certificates', () => cases['six-certificates'].chain, /got 6/],
    ['a 5-certificate chain ending at CA2', () => cases['root-is-ca2-not-ca1'].chain, /must end at Key Attestation CA1/],
    ['a factory chain under CA1', () => real['sony-under-ca1'].chain, /must be factory-provisioned/],
    ['the synthetic factory chain against the real roots', () => factory.synthetic.chain, /must be factory-provisioned/],
    ['no certificates', () => [], /got 0/],
  ])('refuses %s (E2015)', (_l, chain, message) => {
    const r = refusal(() => classifyAndroidChain(der(chain()), ROOTS));
    expect(r.code).toBe('E2015');
    expect(r.message).toMatch(message);
  });

  it('takes the roots it is given: the synthetic chain is factory under the synthetic root', () => {
    expect(classifyAndroidChain(der(factory.synthetic.chain), {...ROOTS, rsaRootModulusHex: factory.synthetic.rsaRootModulusHex}))
      .toBe('android_factory');
  });
});

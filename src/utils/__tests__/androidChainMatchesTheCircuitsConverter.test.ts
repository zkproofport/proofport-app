/**
 * The app's Android chain converter (src/utils/androidKeyAttestation.ts)
 * against circuits' own reference, scripts/android-key-attestation/chain.js,
 * byte for byte.
 *
 * fixtures/androidChainVectors.json is written by
 * scripts/export-android-signer-fixtures.js: Google's real key attestation
 * test chains (circuits android-key-attestation/test-vectors -- Pixel "tegu"
 * TEE and StrongBox chains under Key Attestation CA1, an "akita" chain under
 * the old RSA root, a factory-provisioned Sony chain) and chains derived from
 * them, each with what chain.js returned. Regenerate it whenever chain.js or
 * the test vectors change.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {AppAttestError} from '../../appAttest/appAttestError';
import {N_P256, N_P384} from '../../appAttest/constants';
import {
  ANDROID_TBS_LIMITS,
  androidChainInputs,
  GOOGLE_KEY_ATTESTATION_CA1,
  pemChain,
  type AndroidChainInputs,
} from '../androidKeyAttestation';
import vectors from './fixtures/androidChainVectors.json';

type Case = {chain: string[]; expected: {ok: true; inputs: Record<string, string | number>} | {ok: false; error: string}};
const cases = vectors.cases as unknown as Record<string, Case>;
const ders = (name: string) => cases[name].chain.map(b => Uint8Array.from(Buffer.from(b, 'base64')));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

function asHex(i: AndroidChainInputs): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(i)) out[k] = v instanceof Uint8Array ? hex(v) : v;
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

describe('the fixture', () => {
  it('names the root chain.js pins, and the same limits', () => {
    expect(hex(GOOGLE_KEY_ATTESTATION_CA1)).toBe(vectors.googleKeyAttestationCa1);
    expect(ANDROID_TBS_LIMITS).toEqual(vectors.limits);
  });

  it('came from the chain.js in the circuits checkout, when there is one beside this app', () => {
    const chainJs = path.join(__dirname, '..', '..', '..', '..', 'circuits', 'scripts', 'android-key-attestation', 'chain.js');
    if (!fs.existsSync(chainJs)) return; // CI checks out this app alone.
    const actual = crypto.createHash('sha256').update(fs.readFileSync(chainJs)).digest('hex');
    // A different hash means chain.js changed: rerun scripts/export-android-signer-fixtures.js.
    expect(vectors.source.chainJsSha256).toBe(actual);
  });

  it('holds the cases this test is about', () => {
    expect(Object.keys(cases).sort()).toEqual([
      'akita-sdk34-tee-ec-rsa-root',
      'leaf-tbs-over-1024',
      'root-is-ca2-not-ca1',
      'six-certificates',
      'sony-xperia10iii-sdk33-factory',
      'tegu-sdk36-sb-ec-2026-root',
      'tegu-sdk36-tee-ec-2026-root',
      'tegu-tee-flipped-s-att-and-ca3',
      'tegu-tee-flipped-s-leaf-and-ca2',
      'tegu-tee-without-root',
      'three-certificates',
    ]);
  });
});

describe('every chain chain.js accepts converts to identical inputs', () => {
  const accepted = Object.entries(cases).filter(([, c]) => c.expected.ok);

  it('covers TEE, StrongBox, no root, and high-s signatures', () => {
    expect(accepted.map(([n]) => n).sort()).toEqual([
      'tegu-sdk36-sb-ec-2026-root',
      'tegu-sdk36-tee-ec-2026-root',
      'tegu-tee-flipped-s-att-and-ca3',
      'tegu-tee-flipped-s-leaf-and-ca2',
      'tegu-tee-without-root',
    ]);
  });

  it.each(accepted)('%s', (name, c) => {
    const out = androidChainInputs(ders(name), GOOGLE_KEY_ATTESTATION_CA1);
    expect(asHex(out)).toEqual((c.expected as {inputs: Record<string, string | number>}).inputs);
    // The shapes the circuit takes.
    expect(out.ca2_tbs).toHaveLength(600);
    expect(out.ca3_tbs).toHaveLength(768);
    expect(out.att_tbs).toHaveLength(512);
    expect(out.leaf_tbs).toHaveLength(1024);
    expect(out.ca2_sig).toHaveLength(96);
    expect(out.ca3_sig).toHaveLength(96);
    expect(out.att_sig).toHaveLength(64);
    expect(out.leaf_sig).toHaveLength(64);
    expect(out.leaf_key).toHaveLength(64);
    // Zero padding after each TBS.
    for (const [tbs, len] of [[out.ca2_tbs, out.ca2_tbs_len], [out.ca3_tbs, out.ca3_tbs_len], [out.att_tbs, out.att_tbs_len], [out.leaf_tbs, out.leaf_tbs_len]] as const) {
      expect(tbs.slice(len).every(b => b === 0)).toBe(true);
      expect(tbs[0]).toBe(0x30);
    }
  });

  it('puts every s in low form for its own curve', () => {
    for (const [name] of accepted) {
      const out = androidChainInputs(ders(name), GOOGLE_KEY_ATTESTATION_CA1);
      const s = (sig: Uint8Array, size: number) => BigInt('0x' + hex(sig.slice(size)));
      expect(s(out.ca2_sig, 48) <= N_P384 / 2n).toBe(true);
      expect(s(out.ca3_sig, 48) <= N_P384 / 2n).toBe(true);
      expect(s(out.att_sig, 32) <= N_P256 / 2n).toBe(true);
      expect(s(out.leaf_sig, 32) <= N_P256 / 2n).toBe(true);
    }
  });

  it("a chain with every signature's s in its other form gives the same inputs as the original", () => {
    const original = ders('tegu-sdk36-tee-ec-2026-root');
    const expected = asHex(androidChainInputs(original, GOOGLE_KEY_ATTESTATION_CA1));
    for (const [name, flipped] of [['tegu-tee-flipped-s-leaf-and-ca2', [0, 3]], ['tegu-tee-flipped-s-att-and-ca3', [1, 2]]] as const) {
      const chain = ders(name);
      // The flipped certificates really differ from the originals (else this proves nothing)...
      for (const i of flipped) expect(hex(chain[i])).not.toBe(hex(original[i]));
      // ...and the others are untouched.
      for (const i of [0, 1, 2, 3, 4].filter(i => !(flipped as readonly number[]).includes(i))) expect(hex(chain[i])).toBe(hex(original[i]));
      expect(asHex(androidChainInputs(chain, GOOGLE_KEY_ATTESTATION_CA1))).toEqual(expected);
    }
  });

  it('the root may be left off; the inputs are the same', () => {
    expect(asHex(androidChainInputs(ders('tegu-tee-without-root'), GOOGLE_KEY_ATTESTATION_CA1)))
      .toEqual(asHex(androidChainInputs(ders('tegu-sdk36-tee-ec-2026-root'), GOOGLE_KEY_ATTESTATION_CA1)));
  });
});

describe('every chain chain.js refuses is refused, by name', () => {
  it.each([
    ['akita-sdk34-tee-ec-rsa-root', 'E2015', /The root certificate uses RSA: this is a factory-provisioned chain/],
    ['three-certificates', 'E2015', /got 3 in all\. Factory-provisioned chains are not accepted/],
    ['six-certificates', 'E2015', /got 6 in all/],
    ['root-is-ca2-not-ca1', 'E2015', /does not end at the pinned Google root \(Key Attestation CA1\)/],
    ['leaf-tbs-over-1024', 'E2016', /Leaf TBS is 1672 bytes; the circuit takes at most 1024/],
    // Four certificates, so it is read as [leaf, attestation key, CA3, CA2];
    // chain.js refuses it by CA2's size, the app by name: the certificate in
    // CA3's place is signed by the RSA root.
    ['sony-xperia10iii-sdk33-factory', 'E2015', /Droid CA3 uses RSA: this is a factory-provisioned chain/],
  ])('%s -> %s', (name, code, message) => {
    expect(cases[name].expected.ok).toBe(false);
    const r = refusal(() => androidChainInputs(ders(name), GOOGLE_KEY_ATTESTATION_CA1));
    expect(r.code).toBe(code);
    expect(r.message).toMatch(message);
  });

  it('refuses a root key that is not 96 bytes, before reading the chain', () => {
    expect(() => androidChainInputs(ders('tegu-sdk36-tee-ec-2026-root'), new Uint8Array(65))).toThrow(/pinned root key \(96 bytes/);
  });

  it('refuses certificates that are not DER as malformed (E2016), never a crash', () => {
    const chain = ders('tegu-sdk36-tee-ec-2026-root');
    expect(refusal(() => androidChainInputs([new Uint8Array([0x30, 0x05, 1]), ...chain.slice(1)], GOOGLE_KEY_ATTESTATION_CA1)).code).toBe('E2016');
    expect(refusal(() => androidChainInputs([chain[0].slice(0, 100), ...chain.slice(1)], GOOGLE_KEY_ATTESTATION_CA1)).code).toBe('E2016');
    expect(refusal(() => androidChainInputs([new Uint8Array(0), ...chain.slice(1)], GOOGLE_KEY_ATTESTATION_CA1)).code).toBe('E2016');
  });
});

describe('pemChain', () => {
  it('reads the same DER chain.js read', () => {
    const pem = (d: Uint8Array) => `-----BEGIN CERTIFICATE-----\n${Buffer.from(d).toString('base64').replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----\n`;
    const chain = ders('tegu-sdk36-sb-ec-2026-root');
    expect(pemChain(chain.map(pem).join('')).map(hex)).toEqual(chain.map(hex));
    expect(pemChain('no certificates here')).toEqual([]);
  });
});

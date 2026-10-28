/**
 * The checks the app makes on an Android key attestation chain before
 * proving (androidChainChecks.ts) -- each one a refusal the circuit
 * (android-key-attestation lib.nr / cert.nr / key_description.nr) would
 * otherwise make after a 2^21 prove, with nothing on screen naming it.
 *
 * Real chains: Google's Pixel "tegu" test chains (TEE and StrongBox, Android
 * 16, Key Attestation CA1), made by Google's own attestation test app, so
 * they are ACCEPTED for that app's identity and REFUSED for ours -- the same
 * way the circuit's tests use them. Field mutations are made in place on the
 * real leaf (same length), so only the field under test changes; signatures
 * are not checked here (the circuit does that).
 */
import {AppAttestError} from '../../appAttest/appAttestError';
import {readTlv} from '../../appAttest/der';
import {GOOGLE_KEY_ATTESTATION_CA1} from '../../utils/androidKeyAttestation';
import vectors from '../../utils/__tests__/fixtures/androidChainVectors.json';
import {
  certificateValidity,
  requireAcceptableAndroidChain,
  ZKPROOFPORT_ANDROID_APP,
  type AndroidAppIdentity,
} from '../androidChainChecks';
import {ANDROID_APP_PACKAGE, ANDROID_PLAY_SIGNING_CERT_SHA256} from '../constants';

type Case = {chain: string[]};
const cases = vectors.cases as unknown as Record<string, Case>;
const ders = (name: string) => cases[name].chain.map(b => Uint8Array.from(Buffer.from(b, 'base64')));

/** Google's attestation test app, which made the tegu chains (its [709] entry). */
const GOOGLE_TEST_APP: AndroidAppIdentity = {
  packageName: 'com.google.android.attestation',
  signingCertSha256: '103938ee4537e59e8ee792f654504fb8346fc6b346d0bbc4415fc339fcfc8ec1',
};
/** 2026-03-01: inside every tegu certificate's validity (the attestation keys run to 03-06 / 03-08). */
const NOW = Date.UTC(2026, 2, 1) / 1000;
const opts = (over: Partial<{now: number; app: AndroidAppIdentity; rootKey: Uint8Array}> = {}) => ({
  now: NOW,
  app: GOOGLE_TEST_APP,
  rootKey: GOOGLE_KEY_ATTESTATION_CA1,
  ...over,
});

function refusal(f: () => unknown): {code: string; message: string} {
  try {
    f();
  } catch (e) {
    if (e instanceof AppAttestError) return {code: e.code, message: e.message};
    return {code: `not ours: ${String(e)}`, message: String(e)};
  }
  return {code: 'accepted', message: ''};
}

const indexOf = (hay: Uint8Array, needle: number[], from = 0) => Buffer.from(hay).indexOf(Buffer.from(needle), from);

/** A copy of the chain with the leaf's bytes changed by `edit` (same length). */
function withLeaf(name: string, edit: (leaf: Uint8Array) => void): Uint8Array[] {
  const chain = ders(name);
  const leaf = Uint8Array.from(chain[0]);
  edit(leaf);
  return [leaf, ...chain.slice(1)];
}

/** Offsets inside the leaf's KeyDescription, found by walking it. */
function keyDescriptionOffsets(leaf: Uint8Array) {
  const oid = indexOf(leaf, [0x2b, 0x06, 0x01, 0x04, 0x01, 0xd6, 0x79, 0x02, 0x01, 0x11]);
  expect(oid).toBeGreaterThan(0);
  const oct = readTlv(leaf, oid + 10, leaf.length, 0x04);
  const kd = readTlv(leaf, oct.contentStart, oct.end, 0x30);
  const version = readTlv(leaf, kd.contentStart, kd.end, 0x02);
  const attLevel = version.end + 2; // 0a 01 <level>
  const kmVersion = readTlv(leaf, version.end + 3, kd.end, 0x02);
  const kmLevel = kmVersion.end + 2;
  // [704] RootOfTrust: BF 85 40 <len> 30 <len> 04 <len> key, 01 01 locked, 0a 01 state
  const rot = indexOf(leaf, [0xbf, 0x85, 0x40], kd.contentStart);
  const rotSeq = readTlv(leaf, rot + 4, leaf.length, 0x30);
  const bootKey = readTlv(leaf, rotSeq.contentStart, rotSeq.end, 0x04);
  const locked = bootKey.end + 2;
  const state = bootKey.end + 5;
  // [702] origin: BF 85 3E 03 02 01 <origin>
  const origin = indexOf(leaf, [0xbf, 0x85, 0x3e, 0x03, 0x02, 0x01], kd.contentStart) + 6;
  // [709] package name: first OCTET STRING after the package SET's SEQUENCE
  const pkg = indexOf(leaf, Array.from(Buffer.from('com.google.android.attestation')));
  return {attLevel, kmLevel, locked, state, origin, pkg};
}

describe('the real tegu chains', () => {
  it.each([
    ['tegu-sdk36-tee-ec-2026-root', 'TrustedEnvironment'],
    ['tegu-sdk36-sb-ec-2026-root', 'StrongBox'],
    ['tegu-tee-without-root', 'TrustedEnvironment'],
  ])('%s is accepted for the app that made it (%s)', (name, level) => {
    expect(requireAcceptableAndroidChain(ders(name), opts()).securityLevel).toBe(level);
  });

  it('the offsets this file mutates hold what the circuit reads', () => {
    const leaf = ders('tegu-sdk36-tee-ec-2026-root')[0];
    const o = keyDescriptionOffsets(leaf);
    expect([leaf[o.attLevel], leaf[o.kmLevel], leaf[o.locked], leaf[o.state], leaf[o.origin]]).toEqual([1, 1, 0xff, 0, 0]);
    const sb = keyDescriptionOffsets(ders('tegu-sdk36-sb-ec-2026-root')[0]);
    expect([ders('tegu-sdk36-sb-ec-2026-root')[0][sb.attLevel]]).toEqual([2]);
  });

  it('is refused for ZKProofport: the key belongs to another app (E2015)', () => {
    expect(ZKPROOFPORT_ANDROID_APP).toEqual({packageName: ANDROID_APP_PACKAGE, signingCertSha256: ANDROID_PLAY_SIGNING_CERT_SHA256});
    const r = refusal(() => requireAcceptableAndroidChain(ders('tegu-sdk36-tee-ec-2026-root'), opts({app: ZKPROOFPORT_ANDROID_APP})));
    expect(r).toEqual({code: 'E2015', message: expect.stringMatching(/belongs to another app \(com\.google\.android\.attestation\), not com\.masselabs\.zkproofport/)});
  });

  it('is refused for the right package signed with another certificate (a debug or sideloaded build)', () => {
    const r = refusal(() => requireAcceptableAndroidChain(
      ders('tegu-sdk36-tee-ec-2026-root'),
      opts({app: {...GOOGLE_TEST_APP, signingCertSha256: ANDROID_PLAY_SIGNING_CERT_SHA256}}),
    ));
    expect(r.code).toBe('E2015');
    expect(r.message).toMatch(/signed with certificate 103938ee.*not the store signing certificate c39b4071/);
  });
});

describe('time: CA2, CA3 and the attestation key must be valid at the statement time', () => {
  const chain = ders('tegu-sdk36-tee-ec-2026-root');
  const att = certificateValidity(
    // the attestation-key certificate's TBS
    (() => {
      const outer = readTlv(chain[1], 0, chain[1].length, 0x30);
      const tbs = readTlv(chain[1], outer.contentStart, outer.end, 0x30);
      return chain[1].slice(tbs.start, tbs.end);
    })(),
    'Attestation key',
  );

  it('reads the attestation key validity the fixture shows (2026-02-22 .. 2026-03-08)', () => {
    expect(new Date(att.notBefore * 1000).toISOString()).toBe('2026-02-22T00:06:17.000Z');
    expect(new Date(att.notAfter * 1000).toISOString()).toBe('2026-03-08T00:26:00.000Z');
  });

  it.each([
    ['at notBefore', 'accepted', () => att.notBefore],
    ['at notAfter', 'accepted', () => att.notAfter],
    ['one second before notBefore', 'E2015', () => att.notBefore - 1],
    ['one second after notAfter', 'E2015', () => att.notAfter + 1],
    ['years later', 'E2015', () => Date.UTC(2030, 0, 1) / 1000],
  ])('%s -> %s', (_l, code, now) => {
    expect(refusal(() => requireAcceptableAndroidChain(chain, opts({now: now()}))).code).toBe(code);
  });

  it('names the certificate and the reason', () => {
    expect(refusal(() => requireAcceptableAndroidChain(chain, opts({now: att.notAfter + 1}))).message).toMatch(/Attestation key expired at 2026-03-08T00:26:00\.000Z/);
    expect(refusal(() => requireAcceptableAndroidChain(chain, opts({now: att.notBefore - 1}))).message).toMatch(/not valid until .*Check the phone's clock/);
  });
});

describe('shape', () => {
  it.each([
    // Droid CA2 there is signed by the old RSA root: refused at the first RSA certificate.
    ['akita-sdk34-tee-ec-rsa-root', /Droid CA2 \(certificate 3\) uses RSA: this is a factory-provisioned chain/],
    ['sony-xperia10iii-sdk33-factory', /uses RSA: this is a factory-provisioned chain/],
    ['three-certificates', /got 3 in all/],
    ['six-certificates', /got 6 in all/],
    ['root-is-ca2-not-ca1', /does not end at the pinned root \(Key Attestation CA1\)/],
  ])('%s is refused (E2015)', (name, message) => {
    const r = refusal(() => requireAcceptableAndroidChain(ders(name), opts()));
    expect(r.code).toBe('E2015');
    expect(r.message).toMatch(message);
  });

  it('refuses an attestation key without the provisioning-information extension (not RKP)', () => {
    const chain = ders('tegu-sdk36-tee-ec-2026-root');
    const att = Uint8Array.from(chain[1]);
    const at = indexOf(att, [0x2b, 0x06, 0x01, 0x04, 0x01, 0xd6, 0x79, 0x02, 0x01, 0x1e]);
    expect(at).toBeGreaterThan(0);
    att[at + 9] = 0x1f; // 1.3.6.1.4.1.11129.2.1.31: some other extension
    const r = refusal(() => requireAcceptableAndroidChain([chain[0], att, ...chain.slice(2)], opts()));
    expect(r).toEqual({code: 'E2015', message: expect.stringMatching(/not remotely provisioned/)});
  });

  it('refuses a leaf without a key description', () => {
    const r = refusal(() => requireAcceptableAndroidChain(
      withLeaf('tegu-sdk36-tee-ec-2026-root', leaf => {
        leaf[indexOf(leaf, [0x2b, 0x06, 0x01, 0x04, 0x01, 0xd6, 0x79, 0x02, 0x01, 0x11]) + 9] = 0x12;
      }),
      opts(),
    ));
    expect(r).toEqual({code: 'E2015', message: expect.stringMatching(/leaf certificate has no key description/)});
  });

  it('refuses certificates in the wrong positions (the attestation key where the leaf belongs)', () => {
    const chain = ders('tegu-sdk36-tee-ec-2026-root');
    const r = refusal(() => requireAcceptableAndroidChain([chain[1], chain[0], ...chain.slice(2)], opts()));
    expect(r.code).toBe('E2015');
  });

  it('refuses CA2 in CA3 position by algorithm and curve', () => {
    const chain = ders('tegu-sdk36-tee-ec-2026-root');
    const r = refusal(() => requireAcceptableAndroidChain([chain[0], chain[1], chain[3], chain[3], chain[4]], opts()));
    expect(r).toEqual({code: 'E2015', message: expect.stringMatching(/Droid CA3's key is on curve 2b81040022, not P-256/)});
  });

  it('refuses bytes that are not a certificate as malformed (E2016), never a crash', () => {
    const chain = ders('tegu-sdk36-tee-ec-2026-root');
    for (const bad of [new Uint8Array(0), new Uint8Array([0x30, 0x80]), chain[0].slice(0, 200), Uint8Array.from([...chain[0], 0])]) {
      expect(refusal(() => requireAcceptableAndroidChain([bad, ...chain.slice(1)], opts())).code).toBe('E2016');
    }
  });
});

describe('the key description', () => {
  const name = 'tegu-sdk36-tee-ec-2026-root';
  const mutated = (field: 'attLevel' | 'kmLevel' | 'locked' | 'state' | 'origin', value: number) =>
    withLeaf(name, leaf => {
      leaf[keyDescriptionOffsets(leaf)[field]] = value;
    });

  it.each([
    ['a software key (attestation and KeyMint level 0)', () => withLeaf(name, l => {
      const o = keyDescriptionOffsets(l);
      l[o.attLevel] = 0;
      l[o.kmLevel] = 0;
    }), /not in secure hardware/],
    ['KeyMint level differing from the attestation level', () => mutated('kmLevel', 2), /KeyMint security level 2 differs from attestation security level 1/],
    ['an unlocked bootloader', () => mutated('locked', 0), /bootloader is unlocked/],
    ['boot state SelfSigned', () => mutated('state', 1), /boot state is not Verified \(verifiedBootState 1\)/],
    ['boot state Unverified', () => mutated('state', 2), /boot state is not Verified \(verifiedBootState 2\)/],
    ['an imported key (origin 2)', () => mutated('origin', 2), /not generated in secure hardware/],
    ['another package of the same length', () => withLeaf(name, l => {
      l[keyDescriptionOffsets(l).pkg] = 'x'.charCodeAt(0);
    }), /belongs to another app \(xom\.google\.android\.attestation\)/],
  ])('refuses %s (E2015)', (_l, chain, message) => {
    const r = refusal(() => requireAcceptableAndroidChain(chain(), opts()));
    expect(r.code).toBe('E2015');
    expect(r.message).toMatch(message);
  });

  it('accepts a BER-style non-FF TRUE for deviceLocked, as the circuit does', () => {
    expect(refusal(() => requireAcceptableAndroidChain(mutated('locked', 0x01), opts())).code).toBe('accepted');
  });
});

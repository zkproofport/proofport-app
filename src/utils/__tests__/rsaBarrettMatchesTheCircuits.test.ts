/**
 * The Barrett parameter the app hands the RSA circuits is the one the circuits
 * pin: floor(2^(2*bits + 6) / n), noir-bignum >= 0.9.
 *
 * The 4096-bit case is checked against the circuits' own constant,
 * `GOOGLE_RSA_ROOT_REDC_LIMBS` in circuits statement-signer/src/android_root.nr,
 * which is computed by that library's `print_anchor_hashes` test. A copy of the
 * old shift (+4) gives different limbs, and the circuit then refuses an honest
 * proof ("Failed to solve brillig function").
 */
import {GOOGLE_RSA_ROOT_MODULUS_HEX, rsa4096Params} from '../androidKeyAttestation';
import {RSA_BARRETT_OVERFLOW_BITS, rsaBarrettParam} from '../rsaBarrett';

// circuits statement-signer/src/android_root.nr GOOGLE_RSA_ROOT_REDC_LIMBS, 120-bit limbs, least significant first.
const CIRCUITS_GOOGLE_RSA_ROOT_REDC_LIMBS = [
  0xe823a1bf7c9bfe8f418d9ae1b0814an, 0x2178c52cdc590e3f81663afc69783fn, 0xe403846565548723f053cff81181dcn,
  0xe5c79c54bc1f82fb29ae68ea42f2e6n, 0x9fdcf1edc647b98c8a8a53176116adn, 0x68e44df4ff638ede9dbdbfdb5e14c5n,
  0xdb5c4911c2bab4f5c550fbb4e3a322n, 0xc912e5a6b606b07ef93c02954d700an, 0x585a6d6e04647f8652752dc14c7bc6n,
  0xf24a0d6e245008797ceca1c42741cbn, 0x4fc1af75e3b692fccb5446620be6e2n, 0xeb4d3ac9d09d03b242868cacd37186n,
  0x9aa3d598f30b6137dbf6cc0105d38en, 0x15557c4c59dcd06f6f69f14577f009n, 0x1ca9ce7b5ff0388725c9016ac6135cn,
  0xa967d618a72a2ceee8f57552c09084n, 0x7959e31ae8f982cddd00aeadea1b75n, 0xbad6ea63849228516272f0dba1483en,
  0x295e38087c082d43b5639ea4da7029n, 0xa8342245a15c70039d461c6f5363e5n, 0x938d38eca4826828559678a1c9fa4an,
  0x167aa2ad8314c1d73fcf84914c11bn, 0x52eb6e91cb3741e7c9bb052fba3fe4n, 0x83638ce1c11d7457f2563e7652c1f4n,
  0x250fb8673e8308df15050e5f25aaaan, 0x94a55fbf2597fb339c59ac699e7b8bn, 0xfdd783bf91c9ccb33e81a442dff1ecn,
  0x4d2667643b28ecc013afb36e17987an, 0xaac5cc2968d45df1441f91ebf8ff4dn, 0x33504c8a0141e9873dc762d85768a6n,
  0xfdd5321386b06d8d47664aa834cd0an, 0xff4a2b2b0d4e5549e978a42c640aa9n, 0xf468dd028eef1a6f69a493454f19b1n,
  0x65f06b5718ba57f11bb5b94b0cecb3n, 0x5d3e10n,
];

describe('the RSA Barrett parameter', () => {
  it('uses 6 overflow bits', () => {
    expect(RSA_BARRETT_OVERFLOW_BITS).toBe(6n);
  });

  it("gives the circuits' Google root limbs for the 4096-bit root", () => {
    expect(rsa4096Params(GOOGLE_RSA_ROOT_MODULUS_HEX).redc).toEqual(CIRCUITS_GOOGLE_RSA_ROOT_REDC_LIMBS);
  });

  it('is floor(2^(2*bits+6) / n), and not the old +4 value', () => {
    const n = BigInt('0x' + GOOGLE_RSA_ROOT_MODULUS_HEX);
    const p = rsaBarrettParam(n, 4096n);
    const top = 1n << (2n * 4096n + 6n);
    expect(p * n <= top).toBe(true);
    expect((p + 1n) * n > top).toBe(true);
    expect(p).not.toBe((1n << (2n * 4096n + 4n)) / n);
  });

  it('works for a 2048-bit modulus the way the OIDC builder uses it', () => {
    const n = (1n << 2047n) | 0x1234567890abcdefn | 1n;
    const p = rsaBarrettParam(n, 2048n);
    const top = 1n << (2n * 2048n + 6n);
    expect(p * n <= top && (p + 1n) * n > top).toBe(true);
  });
});

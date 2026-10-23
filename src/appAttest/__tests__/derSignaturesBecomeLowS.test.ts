/**
 * Apple's DER signatures become the r || s the circuit takes, with s low.
 *
 * Both circuit verifiers refuse a high s: noir-ecdsa for the P-384
 * certificate signature ("Signature s value is not in canonical form", the
 * circuit's `cert_high_s` case) and Barretenberg's P-256 black box for the
 * assertion (`assertion_high_s`). Apple does not normalise, so roughly half
 * of all real signatures arrive high and must be sent as n - s -- the same
 * signature, which still verifies.
 */
import * as crypto from 'crypto';
import {ecdsaDerToLowS, toHex} from '../der';
import {N_P256, N_P384} from '../constants';
import {forceHighS, tlv} from './syntheticAppAttest';

const curves = [
  {name: 'P-256', curve: 'prime256v1', n: N_P256, size: 32},
  {name: 'P-384', curve: 'secp384r1', n: N_P384, size: 48},
] as const;

const sOf = (rs: Uint8Array, size: number) => BigInt('0x' + toHex(rs.slice(size)));

describe.each(curves)('$name', ({curve, n, size}) => {
  const {privateKey, publicKey} = crypto.generateKeyPairSync('ec', {namedCurve: curve});
  const msg = Buffer.from('ZKProofport/AA/1 test message');
  const der = () => new Uint8Array(crypto.sign('sha256', msg, {key: privateKey, dsaEncoding: 'der'}));
  const verifies = (rs: Uint8Array) => crypto.verify('sha256', msg, {key: publicKey, dsaEncoding: 'ieee-p1363'}, rs);

  it('turns a HIGH s into n - s, and the result still verifies', () => {
    const high = forceHighS(der(), n);
    const rs = ecdsaDerToLowS(high, size, n);
    expect(sOf(rs, size) <= n / 2n).toBe(true);
    expect(verifies(rs)).toBe(true);
  });

  it('keeps a low s as it is', () => {
    for (let i = 0; i < 8; i++) {
      const rs = ecdsaDerToLowS(der(), size, n);
      expect(sOf(rs, size) <= n / 2n).toBe(true);
      expect(verifies(rs)).toBe(true);
    }
  });

  it('pads short integers to the fixed width', () => {
    const rs = ecdsaDerToLowS(der(), size, n);
    expect(rs.length).toBe(size * 2);
  });

  it('refuses a component that is zero, negative, non-minimal or not below n', () => {
    const int = (b: number[]) => tlv(0x02, new Uint8Array(b));
    const seq = (...p: Uint8Array[]) => tlv(0x30, ...p);
    const one = int([1]);
    expect(() => ecdsaDerToLowS(seq(int([0]), one), size, n)).toThrow(/out of range/);
    expect(() => ecdsaDerToLowS(seq(int([0x80]), one), size, n)).toThrow(/negative/);
    expect(() => ecdsaDerToLowS(seq(int([0, 1]), one), size, n)).toThrow(/non-minimal/);
    const nBytes = Array.from(Buffer.from(n.toString(16), 'hex'));
    expect(() => ecdsaDerToLowS(seq(one, int([0, ...nBytes])), size, n)).toThrow(/out of range/);
  });

  it('refuses trailing bytes and a third component', () => {
    const sig = der();
    expect(() => ecdsaDerToLowS(new Uint8Array([...sig, 0]), size, n)).toThrow(/bytes after/);
    const int = tlv(0x02, new Uint8Array([1]));
    expect(() => ecdsaDerToLowS(tlv(0x30, int, int, int), size, n)).toThrow();
  });
});

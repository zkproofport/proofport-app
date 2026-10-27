/**
 * Real Apple bytes, parsed the way the circuit reads them.
 *
 * Two real sources, because no device sample of OUR app exists yet:
 *   - Apple's own production attestation object from the attestation-object
 *     validation guide (fixtures/appleAttestationSample.json): the full CBOR
 *     envelope, a real credential certificate with CBOR extensions in its
 *     authData, and the intermediate "Apple App Attestation CA 1".
 *   - zkPassport's development chain that the circuit's library tests use
 *     (circuits scripts/coinbase-app-attest-poc/apple-vector.json, copied to
 *     fixtures/zkpassportAppleChain.json): TBS bytes and r || s only, no CBOR.
 */
import * as crypto from 'crypto';
import {decodeAttestationObject, toCircuitCredential} from '../appAttestObjects';
import {appleAppId, appleNonce, parseTbs, toHex} from '../der';
import {AppAttestError} from '../appAttestError';
import {APP_ATTEST_APP_ID, APPLE_APP_ATTEST_CA1_KEY_HASH, N_P384} from '../constants';
import {verifyP1363} from './syntheticAppAttest';
import sample from './fixtures/appleAttestationSample.json';
import zkp from './fixtures/zkpassportAppleChain.json';

const b64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
const hex = (s: string) => new Uint8Array(Buffer.from(s, 'hex'));
const challenge = new Uint8Array(Buffer.from(sample.challenge));

describe("Apple's published attestation object", () => {
  const decoded = () => decodeAttestationObject(b64(sample.attestationObjectBase64), sample.keyId, challenge, sample.appId);

  it('passes every step Apple lists, with the guide\'s own app id and challenge', () => {
    const d = decoded();
    expect(d.production).toBe(true);
    expect(d.certificateAppId).toBe('1234567890.com.example.myapp');
    expect(d.authData.length).toBe(226); // 164 fixed + CBOR extensions
  });

  it('takes out exactly the leaf certificate\'s TBS, and the intermediate signed it', () => {
    const d = decoded();
    const leaf = new crypto.X509Certificate(Buffer.from(sample.expectedLeafCertificateBase64, 'base64'));
    const inter = new crypto.X509Certificate(Buffer.from(sample.expectedIntermediateCertificateBase64, 'base64'));
    expect(leaf.verify(inter.publicKey)).toBe(true);
    // The TBS our parser returns is a prefix-free slice of the leaf DER...
    expect(Buffer.from(sample.expectedLeafCertificateBase64, 'base64').includes(Buffer.from(d.credentialTbs))).toBe(true);
    expect(d.credentialTbs.length).toBe(935); // under the circuit's 1000
    // ...and the r || s we hand the circuit verifies over it with the CA key.
    expect(verifyP1363({x: d.caKey.slice(0, 48), y: d.caKey.slice(48), crv: 'P-384'}, d.credentialTbs, d.credentialSig)).toBe(true);
  });

  it('hands the circuit a low s', () => {
    const s = BigInt('0x' + toHex(decoded().credentialSig.slice(48)));
    expect(s <= N_P384 / 2n).toBe(true);
  });

  it('finds Apple CA 1 as the intermediate: the hash the verifier pins', () => {
    expect(decoded().caKeyHash).toBe(APPLE_APP_ATTEST_CA1_KEY_HASH);
  });

  it('reads the nonce the guide publishes', () => {
    const fields = parseTbs(decoded().credentialTbs);
    expect(Buffer.from(appleNonce(fields)).toString('base64')).toBe(sample.expectedNonceBase64);
  });

  it('refuses it for our circuit: another app, and a challenge that is not 32 bytes', () => {
    const att = b64(sample.attestationObjectBase64);
    expect(() => toCircuitCredential(att, sample.keyId, challenge, APP_ATTEST_APP_ID, APPLE_APP_ATTEST_CA1_KEY_HASH))
      .toThrow(/the circuit takes exactly 32/);
    // With a 32-byte value the nonce no longer matches; the RP ID hash is
    // checked against OUR app id and refused before that matters.
    const err = (() => {
      try {
        toCircuitCredential(att, sample.keyId, new Uint8Array(32), APP_ATTEST_APP_ID, APPLE_APP_ATTEST_CA1_KEY_HASH);
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(AppAttestError);
    expect((err as AppAttestError).code).toBe('E2014');
  });

  it('refuses a key id that is not the certificate key', () => {
    const other = Buffer.alloc(32, 7).toString('base64');
    expect(() => decodeAttestationObject(b64(sample.attestationObjectBase64), other, challenge, sample.appId))
      .toThrow(/does not hash to the key id/);
  });

  it('refuses a challenge other than the one attested', () => {
    expect(() => decodeAttestationObject(b64(sample.attestationObjectBase64), sample.keyId, new Uint8Array(Buffer.from('another')), sample.appId))
      .toThrow(/do not hash to the certificate nonce/);
  });

  it('refuses one changed byte anywhere in the envelope', () => {
    const att = b64(sample.attestationObjectBase64);
    // A byte inside the credential certificate's subject key.
    const at = Buffer.from(att).indexOf(Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107', 'hex')) + 30;
    const bad = att.slice();
    bad[at] ^= 1;
    expect(() => decodeAttestationObject(bad, sample.keyId, challenge, sample.appId)).toThrow(AppAttestError);
  });
});

describe("zkPassport's development chain (the circuit's real-certificate vector)", () => {
  it('parses to its P-256 key and a nonce, and names an app that is not ours', () => {
    const fields = parseTbs(hex(zkp.credential_tbs));
    expect(fields.publicKey.length).toBe(64);
    expect(appleNonce(fields).length).toBe(32);
    expect(appleAppId(fields)).not.toBe(APP_ATTEST_APP_ID);
  });

  it('has the same intermediate as Apple\'s production sample: one pin covers both environments', () => {
    const inter = parseTbs(hex(zkp.intermediate_tbs));
    expect(toHex(inter.publicKey)).toBe(zkp.intermediate_key_xy);
    expect('0x' + crypto.createHash('sha256').update(inter.publicKey).digest('hex')).toBe(APPLE_APP_ATTEST_CA1_KEY_HASH);
  });

  it('is signed by that intermediate with ecdsa-with-SHA256, as the circuit verifies', () => {
    const k = hex(zkp.intermediate_key_xy);
    expect(verifyP1363({x: k.slice(0, 48), y: k.slice(48), crv: 'P-384'}, hex(zkp.credential_tbs), hex(zkp.credential_sig))).toBe(true);
  });
});

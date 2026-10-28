/**
 * A fake DCAppAttestService around one synthetic device (syntheticAppAttest.ts,
 * ported from the circuits' fixture generator), for the OIDC provider-key
 * signer. Records every hash it was asked to sign and the raw parts it built,
 * so a test can (a) assert the app asked for SHA256(statement) and nothing
 * else, and (b) build the circuits reference builder's signer inputs from the
 * device's own bytes rather than from the app's parse of them.
 *
 * Not a test file itself (no `.test.ts`).
 */
import * as crypto from 'crypto';
import {APP_ATTEST_APP_ID} from '../../appAttest/constants';
import type {KeyStorage} from '../../appAttest/appAttestKey';
import type {AppAttestNative} from '../../appAttest/nativeAppAttest';
import {
  AAGUID,
  cbor,
  derToLowSP1363,
  ecKey,
  forceHighS,
  N_P256,
  N_P384,
  sha256,
  syntheticDevice,
} from '../../appAttest/__tests__/syntheticAppAttest';

export interface FakeAppAttestOptions {
  supported?: boolean;
  development?: boolean;
  /** Sign assertions with s in the upper half (DER as the device returns it). */
  highS?: boolean;
  /** Pin a different intermediate than the one that certifies the key. */
  pinOtherCa?: boolean;
}

export function fakeAppAttest(opts: FakeAppAttestOptions = {}) {
  const ca = ecKey('secp384r1');
  const device = syntheticDevice(APP_ATTEST_APP_ID, ca);
  const pinCa = opts.pinOtherCa ? ecKey('secp384r1') : ca;
  const pinnedCaKeyHash = '0x' + Buffer.from(sha256(pinCa.x, pinCa.y)).toString('hex');
  const calls = {isSupported: 0, generateKey: 0, attestKey: 0, assertionHashes: [] as string[]};
  let lastAssertion: {authData: Uint8Array; sigDer: Uint8Array} | undefined;

  const native: AppAttestNative = {
    isSupported: async () => {
      calls.isSupported++;
      return opts.supported ?? true;
    },
    generateKey: async () => {
      calls.generateKey++;
      return device.keyId;
    },
    attestKey: async (_keyId, cdhB64) => {
      calls.attestKey++;
      const att = device.attestation(new Uint8Array(Buffer.from(cdhB64, 'base64')), opts.development ? {aaguid: AAGUID.development} : undefined);
      return Buffer.from(att).toString('base64');
    },
    generateAssertion: async (_keyId, hashB64) => {
      calls.assertionHashes.push(hashB64);
      const c = Buffer.alloc(4);
      c.writeUInt32BE(calls.assertionHashes.length);
      const authData = new Uint8Array([...sha256(new Uint8Array(Buffer.from(APP_ATTEST_APP_ID))), 0, ...c]);
      // The Secure Enclave signs authData || the hash it is given.
      const nonce = sha256(authData, new Uint8Array(Buffer.from(hashB64, 'base64')));
      let sigDer: Uint8Array = new Uint8Array(crypto.sign('sha256', nonce, {key: device.cred.privateKey, dsaEncoding: 'der'}));
      if (opts.highS) sigDer = forceHighS(sigDer, N_P256);
      lastAssertion = {authData, sigDer};
      return Buffer.from(cbor(new Map<string, unknown>([['signature', sigDer], ['authenticatorData', authData]]))).toString('base64');
    },
  };

  const storage: KeyStorage = (() => {
    const m = new Map<string, string>();
    return {getItem: async k => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v), removeItem: async k => void m.delete(k)};
  })();

  /**
   * The parts the circuits' `appSigner` takes, from the device's own bytes:
   * r || s (low s) converted here, never by the app's DER reader.
   */
  const rawSignerParts = () => {
    const att = device.lastAttestation;
    if (!att || !lastAssertion) throw new Error('nothing signed yet');
    return {
      assertionSig: derToLowSP1363(lastAssertion.sigDer, 32, N_P256),
      credentialTbs: att.credentialTbs,
      credentialSig: derToLowSP1363(att.credentialSigDer, 48, N_P384),
      attAuthData: att.authData,
      attClientDataHash: att.clientDataHash,
      assertionAuthData: lastAssertion.authData,
    };
  };

  return {native, storage, pinnedCaKeyHash, keyDeps: {storage, pinnedCaKeyHash}, calls, device, rawSignerParts};
}

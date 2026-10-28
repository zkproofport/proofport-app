#!/usr/bin/env node
/**
 * Helpers for scripts/capture-android-attestation.sh (Node built-ins only).
 *
 *   node capture-android-attestation.js nonce <attest.json> <statement-file>
 *     -> prints base64url(SHA256(SHA256(statement) || r || s)), r || s low-s
 *        (statement-signer play_integrity_nonce; android.js playIntegrityNonce)
 *   node capture-android-attestation.js decrypt <integrity.json> <out.json>
 *     -> decrypts the JWE (A256KW / A256GCM) with PLAY_INTEGRITY_DECRYPTION_KEY
 *        from the environment (base64, 32 bytes; never printed), checks the
 *        ES256 signature with PLAY_INTEGRITY_VERIFICATION_KEY (base64 DER
 *        SPKI) and writes {protectedHeader, payload, signature, verdict} --
 *        the JWS segments as the relay returns them, plus the parsed verdict.
 */
const crypto = require('crypto');
const fs = require('fs');

const N_P256 = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

function derToLowS(der) {
  if (der[0] !== 0x30) throw new Error('signature is not DER');
  let p = 2;
  if (der[1] & 0x80) p = 2 + (der[1] & 0x7f);
  const int = () => {
    if (der[p] !== 0x02) throw new Error('signature is not two INTEGERs');
    const len = der[p + 1];
    const v = BigInt('0x' + der.subarray(p + 2, p + 2 + len).toString('hex'));
    p += 2 + len;
    return v;
  };
  const r = int();
  let s = int();
  if (s > N_P256 / 2n) s = N_P256 - s;
  const f = v => Buffer.from(v.toString(16).padStart(64, '0'), 'hex');
  return Buffer.concat([f(r), f(s)]);
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'nonce') {
  const att = JSON.parse(fs.readFileSync(a, 'utf8'));
  const statement = fs.readFileSync(b);
  const sig = derToLowS(Buffer.from(att.signature, 'base64'));
  const h = crypto.createHash('sha256').update(statement).digest();
  process.stdout.write(crypto.createHash('sha256').update(Buffer.concat([h, sig])).digest().toString('base64url'));
} else if (cmd === 'decrypt') {
  const keyB64 = process.env.PLAY_INTEGRITY_DECRYPTION_KEY;
  const verB64 = process.env.PLAY_INTEGRITY_VERIFICATION_KEY;
  if (!keyB64 || !verB64) throw new Error('PLAY_INTEGRITY_DECRYPTION_KEY and PLAY_INTEGRITY_VERIFICATION_KEY are required');
  const key = Buffer.from(keyB64.trim(), 'base64');
  if (key.length !== 32) throw new Error(`the decryption key is ${key.length} bytes, not 32`);
  const { token } = JSON.parse(fs.readFileSync(a, 'utf8'));
  const [h, ek, iv, ct, tag] = token.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
  if (header.alg !== 'A256KW' || header.enc !== 'A256GCM') throw new Error(`JWE is ${header.alg}/${header.enc}, not A256KW/A256GCM`);
  const unwrap = crypto.createDecipheriv('id-aes256-wrap', key, Buffer.from('A6A6A6A6A6A6A6A6', 'hex'));
  const cek = Buffer.concat([unwrap.update(Buffer.from(ek, 'base64url')), unwrap.final()]);
  const gcm = crypto.createDecipheriv('aes-256-gcm', cek, Buffer.from(iv, 'base64url'));
  gcm.setAAD(Buffer.from(h, 'ascii'));
  gcm.setAuthTag(Buffer.from(tag, 'base64url'));
  const jws = Buffer.concat([gcm.update(Buffer.from(ct, 'base64url')), gcm.final()]).toString('ascii');
  const [ph, pl, sg] = jws.split('.');
  const verification = crypto.createPublicKey({ key: Buffer.from(verB64.trim(), 'base64'), format: 'der', type: 'spki' });
  const ok = crypto.verify('sha256', Buffer.from(`${ph}.${pl}`), { key: verification, dsaEncoding: 'ieee-p1363' }, Buffer.from(sg, 'base64url'));
  if (!ok) throw new Error('the JWS does not verify with the Play verification key');
  const verdict = JSON.parse(Buffer.from(pl, 'base64url').toString('utf8'));
  fs.writeFileSync(b, JSON.stringify({ protectedHeader: ph, payload: pl, signature: sg, verdict }, null, 1));
  console.log(`decrypted: header ${Buffer.from(ph, 'base64url').toString()}, payload ${pl.length} characters, signature verifies`);
} else {
  throw new Error(`Unknown command '${cmd}'. Known: nonce, decrypt.`);
}

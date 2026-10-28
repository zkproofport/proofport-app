#!/usr/bin/env node
/**
 * Write the fixtures the app's Android signer tests compare against, from the
 * circuits repository's own reference code:
 *
 *   src/utils/__tests__/fixtures/androidChainVectors.json
 *     Google's real key attestation test chains (circuits
 *     android-key-attestation/test-vectors/*.pem, public certificates from
 *     Google's android/keyattestation test data -- no personal data), plus
 *     chains derived from them (root left off, each signature's s flipped to its other form, too few or
 *     too many certificates, an oversized TBS), each with what
 *     scripts/android-key-attestation/chain.js returns for it: the AndroidChain
 *     inputs as hex, or the error it throws.
 *
 *   src/utils/__tests__/fixtures/androidFactoryVectors.json
 *     Factory-provisioned chains (Sony, and blueline with an UNLOCKED
 *     bootloader; derived ones) through chain.js factoryChainInputs, and a
 *     SYNTHETIC factory device (android.js factoryDevice under the synthetic
 *     RSA root) with a statement, its signature, the Play Integrity nonce
 *     (android.js playIntegrityNonce) and verdicts signed with the INSECURE
 *     test Play key (anchors.js testPlayKey, android.js playToken).
 *
 *   src/utils/__tests__/fixtures/androidCircuitAbis.json
 *     The `fn main` parameters (name, visibility, flattened size) of the two
 *     Android packages' compiled circuits.
 *
 * Usage (from anywhere inside the app or the parent repository):
 *   env -u NODE_OPTIONS node scripts/export-android-signer-fixtures.js
 *   CIRCUITS_DIR=<circuits checkout> env -u NODE_OPTIONS node scripts/export-android-signer-fixtures.js
 *
 * Prerequisites: a circuits checkout carrying scripts/android-key-attestation/
 * chain.js, the test vectors, and the compiled
 * oidc-domain-attestation-android / coinbase-attestation-v2-android
 * target/*.json (`nargo compile` in each package). The circuits commit, and
 * whether its working tree had changes, is recorded in each fixture.
 */
const {execFileSync} = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8'}).trim();

const APP = git(process.cwd(), 'rev-parse', '--show-toplevel');
const SUPER = git(APP, 'rev-parse', '--show-superproject-working-tree');
const CIRCUITS = process.env.CIRCUITS_DIR || (SUPER ? path.join(SUPER, 'circuits') : '');
if (!CIRCUITS || !fs.existsSync(path.join(CIRCUITS, 'scripts/android-key-attestation/chain.js'))) {
  throw new Error(`No circuits checkout with scripts/android-key-attestation/chain.js at '${CIRCUITS}'. Set CIRCUITS_DIR.`);
}

const CHAIN_JS = path.join(CIRCUITS, 'scripts/android-key-attestation/chain.js');
const c = require(CHAIN_JS);
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

const source = {
  circuitsCommit: git(CIRCUITS, 'rev-parse', 'HEAD'),
  circuitsWorkingTreeChanged: git(CIRCUITS, 'status', '--porcelain', '--',
    'scripts/android-key-attestation', 'android-key-attestation', 'statement-signer',
    'oidc-domain-attestation-android', 'coinbase-attestation-v2-android',
    'oidc-domain-attestation-android-factory', 'coinbase-attestation-v2-android-factory', 'play-integrity') !== '',
  chainJsSha256: sha256(fs.readFileSync(CHAIN_JS)),
};

// ── DER helpers for the derived chains (built here, then fed to chain.js) ──

function derLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  if (n < 0x100) return Buffer.from([0x81, n]);
  return Buffer.from([0x82, n >> 8, n & 0xff]);
}
const tlv = (tag, content) => Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
function derInt(v) {
  let h = v.toString(16);
  if (h.length % 2) h = '0' + h;
  let b = Buffer.from(h, 'hex');
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}

/**
 * The certificate with its signature's s replaced by n - s: the same
 * signature in the other form (Google's own certificates carry both forms, so
 * flipping tests a high s wherever the original was low and vice versa).
 */
function withFlippedS(certDer, n) {
  const outer = c.der(certDer, 0);
  const tbs = c.der(certDer, outer.hl);
  const alg = c.der(certDer, tbs.end);
  const sig = c.der(certDer, alg.end);
  const sigDer = certDer.subarray(alg.end + sig.hl + 1, sig.end);
  const seq = c.der(sigDer, 0);
  const r = c.der(sigDer, seq.hl);
  const s = c.der(sigDer, r.end);
  const int = e => BigInt('0x' + Buffer.from(sigDer.subarray(e.end - e.len, e.end)).toString('hex'));
  const sv = int(s);
  const flipped = n - sv;
  const newSig = tlv(0x30, Buffer.concat([derInt(int(r)), derInt(flipped)]));
  const body = Buffer.concat([
    certDer.subarray(outer.hl, alg.end),
    tlv(0x03, Buffer.concat([Buffer.from([0]), newSig])),
  ]);
  return tlv(0x30, body);
}

/** The certificate with `extra` zero bytes appended inside its TBS (no longer valid X.509; only its size matters). */
function withLongerTbs(certDer, extra) {
  const outer = c.der(certDer, 0);
  const tbs = c.der(certDer, outer.hl);
  const tbsContent = certDer.subarray(outer.hl + tbs.hl, tbs.end);
  const grown = tlv(0x30, Buffer.concat([tbsContent, tlv(0x04, Buffer.alloc(extra))]));
  return tlv(0x30, Buffer.concat([grown, certDer.subarray(tbs.end)]));
}

const hex = b => Buffer.from(b).toString('hex');

function run(ders) {
  try {
    const r = c.chainInputs(ders, c.GOOGLE_KEY_ATTESTATION_CA1);
    const out = {};
    for (const [k, v] of Object.entries(r)) out[k] = Buffer.isBuffer(v) ? hex(v) : v;
    return {ok: true, inputs: out};
  } catch (e) {
    return {ok: false, error: e.message};
  }
}

const VECTOR_DIR = path.join(CIRCUITS, 'android-key-attestation/test-vectors');
const pems = Object.fromEntries(
  fs.readdirSync(VECTOR_DIR).filter(f => f.endsWith('.pem')).sort()
    .map(f => [f.replace(/\.pem$/, ''), c.pemChain(fs.readFileSync(path.join(VECTOR_DIR, f), 'utf8'))]),
);

const tee = pems['tegu-sdk36-tee-ec-2026-root'];
const sb = pems['tegu-sdk36-sb-ec-2026-root'];
if (!tee || !sb) throw new Error(`Expected the tegu TEE and StrongBox vectors in ${VECTOR_DIR}`);

const cases = {};
for (const [name, ders] of Object.entries(pems)) cases[name] = ders;
cases['tegu-tee-without-root'] = tee.slice(0, 4);
cases['tegu-tee-flipped-s-leaf-and-ca2'] = [withFlippedS(tee[0], c.N_P256), tee[1], tee[2], withFlippedS(tee[3], c.N_P384), tee[4]];
cases['tegu-tee-flipped-s-att-and-ca3'] = [tee[0], withFlippedS(tee[1], c.N_P256), withFlippedS(tee[2], c.N_P384), tee[3], tee[4]];
cases['three-certificates'] = tee.slice(0, 3);
cases['six-certificates'] = [...tee, tee[4]];
cases['leaf-tbs-over-1024'] = [withLongerTbs(tee[0], 1024), ...tee.slice(1)];
cases['root-is-ca2-not-ca1'] = [tee[0], tee[1], tee[2], tee[3], tee[3]];

const vectors = {
  source,
  googleKeyAttestationCa1: hex(c.GOOGLE_KEY_ATTESTATION_CA1),
  limits: c.LIMITS,
  cases: Object.fromEntries(Object.entries(cases).map(([name, ders]) => [
    name,
    {chain: ders.map(d => Buffer.from(d).toString('base64')), expected: run(ders)},
  ])),
};

function abiOf(dir, pkg) {
  const file = path.join(CIRCUITS, dir, 'target', `${pkg}.json`);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const size = t => (t.kind === 'array' ? t.length * size(t.type)
    : t.kind === 'struct' ? t.fields.reduce((n, f) => n + size(f.type), 0) : 1);
  return {
    package: pkg,
    noirVersion: j.noir_version,
    jsonSha256: sha256(fs.readFileSync(file)),
    parameters: j.abi.parameters.map(p => ({name: p.name, visibility: p.visibility, size: size(p.type)})),
  };
}

const abis = {
  source,
  oidc_domain_attestation: abiOf('oidc-domain-attestation-android', 'oidc_domain_attestation_android'),
  coinbase_attestation: abiOf('coinbase-attestation-v2-android', 'coinbase_attestation_v2_android'),
  oidc_domain_attestation_factory: abiOf('oidc-domain-attestation-android-factory', 'oidc_domain_attestation_android_factory'),
  coinbase_attestation_factory: abiOf('coinbase-attestation-v2-android-factory', 'coinbase_attestation_v2_android_factory'),
};

// ── Factory-provisioned chains and the Play Integrity verdict ──────────────

const ANDROID_JS = path.join(CIRCUITS, 'scripts/statement-signer/android.js');
const ANCHORS_JS = path.join(CIRCUITS, 'scripts/statement-signer/anchors.js');
const A = require(ANDROID_JS);
const anchors = require(ANCHORS_JS);
const factorySource = {
  ...source,
  androidJsSha256: sha256(fs.readFileSync(ANDROID_JS)),
  anchorsJsSha256: sha256(fs.readFileSync(ANCHORS_JS)),
};

const limbsText = l => l.map(v => v.toString());
function runFactory(ders, modulusHex) {
  try {
    const r = c.factoryChainInputs(ders, modulusHex);
    const out = {};
    for (const [k, v] of Object.entries(r)) out[k] = Buffer.isBuffer(v) ? hex(v) : Array.isArray(v) ? limbsText(v) : v;
    return {ok: true, inputs: out};
  } catch (e) {
    return {ok: false, error: e.message};
  }
}

const sony = pems['sony-xperia10iii-sdk33-factory'];
const blueline = pems['blueline-sdk28-tee-ec-factory'];
const akita = pems['akita-sdk34-tee-ec-rsa-root'];
if (!sony || !blueline || !akita) throw new Error(`Expected the sony, blueline and akita vectors in ${VECTOR_DIR}`);
const realFactory = {
  'sony-xperia10iii-sdk33-factory': sony,
  'blueline-sdk28-tee-ec-factory': blueline,
  'sony-without-root': sony.slice(0, 3),
  'sony-under-the-2022-root-certificate': [...sony.slice(0, 3), akita[4]],
  'sony-five-certificates': [...sony, sony[3]],
  'sony-two-certificates': sony.slice(0, 2),
  'sony-under-ca1': [...sony.slice(0, 3), tee[4]],
};

/** A self-signed RSA root certificate for the synthetic root key (only its SPKI is read). */
function rsaRootCertificate(root) {
  const alg = tlv(0x30, Buffer.concat([tlv(0x06, Buffer.from('2a864886f70d01010b', 'hex')), Buffer.from([5, 0])]));
  const name = tlv(0x30, tlv(0x31, tlv(0x30, Buffer.concat([tlv(0x06, Buffer.from('550405', 'hex')), tlv(0x13, Buffer.from('synthetic'))]))));
  const validity = tlv(0x30, Buffer.concat([tlv(0x17, Buffer.from('200101000000Z')), tlv(0x17, Buffer.from('400101000000Z'))]));
  const spki = root.publicKey.export({type: 'spki', format: 'der'});
  const tbs = tlv(0x30, Buffer.concat([Buffer.from('a003020102', 'hex'), derInt(1n), alg, name, validity, name, spki]));
  const sig = crypto.sign('sha256', tbs, root.privateKey);
  return tlv(0x30, Buffer.concat([tbs, alg, tlv(0x03, Buffer.concat([Buffer.from([0]), sig]))]));
}

/** A JWS answer as the relay returns it, with the signature's s in its HIGH form (the app must lower it). */
function relayAnswer(token) {
  const payload = token.payload_b64.subarray(0, token.payload_b64_len).toString();
  const s = BigInt('0x' + token.signature.subarray(32).toString('hex'));
  const high = Buffer.concat([token.signature.subarray(0, 32), Buffer.from((c.N_P256 - s).toString(16).padStart(64, '0'), 'hex')]);
  return {protectedHeader: 'eyJhbGciOiJFUzI1NiJ9', payload, signature: high.toString('base64url')};
}

const rsaRoot = anchors.syntheticAndroidRsaRoot();
const playKey = anchors.testPlayKey();
const device = A.factoryDevice({});
const unlocked = A.factoryDevice({lockedByte: 0x00});
const rootCert = rsaRootCertificate(rsaRoot);
const statement = Buffer.from(Array.from({length: 225}, (_v, i) => (i * 13 + 7) & 0xff));
const sigDer = crypto.sign('sha256', statement, device.leaf.privateKey);
const statementSig = c.rawLowS(sigDer, 32, c.N_P256);
const nonce = A.playIntegrityNonce(statement, statementSig);
const nonceB64 = Buffer.from(nonce).toString('base64url');
const tokens = {
  good: A.playToken(nonce, playKey),
  // Google echoes a padded nonce with the pad escaped as \u003d; a literal '='
  // is a different payload, which the circuit refuses.
  escapedPaddedNonce: (() => {
    const good = A.playToken(nonce, playKey);
    const raw = good.json.replace(`"nonce":"${nonceB64}"`, `"nonce":"${nonceB64}\\u003d"`);
    if (raw === good.json) throw new Error('could not escape-pad the nonce');
    return A.playToken(nonce, playKey, {raw});
  })(),
  literalPaddedNonce: A.playToken(nonce, playKey, {nonceText: nonceB64 + '='}),
  basicIntegrityOnly: A.playToken(nonce, playKey, {verdicts: ['MEETS_BASIC_INTEGRITY']}),
  strongIntegrity: A.playToken(nonce, playKey, {verdicts: ['MEETS_BASIC_INTEGRITY', 'MEETS_DEVICE_INTEGRITY', 'MEETS_STRONG_INTEGRITY']}),
  unrecognizedApp: A.playToken(nonce, playKey, {recognition: 'UNRECOGNIZED_VERSION'}),
  otherPackage: A.playToken(nonce, playKey, {package: 'com.example.other'}),
  otherRequestPackage: A.playToken(nonce, playKey, {requestPackage: 'com.example.other'}),
  otherNonce: A.playToken(Buffer.alloc(32, 7), playKey),
};
const params = c.rsa4096Params(rsaRoot.modulusHex);
const googleParams = c.rsa4096Params(c.GOOGLE_RSA_ROOT_MODULUS_HEX);

const factory = {
  source: factorySource,
  googleRsaRootModulusHex: c.GOOGLE_RSA_ROOT_MODULUS_HEX,
  googleRsaRootParams: {modulus: limbsText(googleParams.modulus), redc: limbsText(googleParams.redc)},
  limits: {ik: c.LIMITS.ik, batch: c.LIMITS.batch, leaf: c.LIMITS.leaf},
  real: Object.fromEntries(Object.entries(realFactory).map(([name, ders]) => [
    name,
    {chain: ders.map(d => Buffer.from(d).toString('base64')), expected: runFactory(ders, c.GOOGLE_RSA_ROOT_MODULUS_HEX)},
  ])),
  synthetic: {
    package: A.PACKAGE,
    signingDigest: hex(A.SIGNING_DIGEST),
    rsaRootModulusHex: rsaRoot.modulusHex,
    rsaRootParams: {modulus: limbsText(params.modulus), redc: limbsText(params.redc)},
    playKey: hex(Buffer.concat([playKey.x, playKey.y])),
    chain: [...device.ders, rootCert].map(d => Buffer.from(d).toString('base64')),
    unlockedChain: [...unlocked.ders, rootCert].map(d => Buffer.from(d).toString('base64')),
    expectedChain: runFactory([...device.ders, rootCert], rsaRoot.modulusHex),
    statement: hex(statement),
    statementSigDer: hex(sigDer),
    statementSigLow: hex(statementSig),
    nonce: hex(nonce),
    nonceBase64Url: nonceB64,
    tokens: Object.fromEntries(Object.entries(tokens).map(([k, t]) => [k, {
      relay: relayAnswer(t),
      payloadB64Padded: hex(t.payload_b64),
      payloadB64Len: t.payload_b64_len,
      signatureLow: hex(t.signature),
    }])),
  },
};

const OUT = path.join(APP, 'src/utils/__tests__/fixtures');
fs.writeFileSync(path.join(OUT, 'androidChainVectors.json'), JSON.stringify(vectors, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'androidCircuitAbis.json'), JSON.stringify(abis, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'androidFactoryVectors.json'), JSON.stringify(factory, null, 2) + '\n');
for (const [name, v] of Object.entries(factory.real)) {
  console.log(`factory ${name}: ${v.expected.ok ? 'accepted' : `refused (${v.expected.error})`}`);
}
console.log(`factory synthetic: ${factory.synthetic.expectedChain.ok ? 'accepted' : factory.synthetic.expectedChain.error}`);
for (const [name, v] of Object.entries(vectors.cases)) {
  console.log(`${name}: ${v.expected.ok ? 'accepted' : `refused (${v.expected.error})`}`);
}
console.log(`Wrote ${path.relative(APP, OUT)}/androidChainVectors.json, androidCircuitAbis.json and androidFactoryVectors.json from circuits ${source.circuitsCommit}${source.circuitsWorkingTreeChanged ? ' (working tree changed)' : ''}`);

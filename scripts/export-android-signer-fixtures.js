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
    'oidc-domain-attestation-android', 'coinbase-attestation-v2-android') !== '',
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
};

const OUT = path.join(APP, 'src/utils/__tests__/fixtures');
fs.writeFileSync(path.join(OUT, 'androidChainVectors.json'), JSON.stringify(vectors, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'androidCircuitAbis.json'), JSON.stringify(abis, null, 2) + '\n');
for (const [name, v] of Object.entries(vectors.cases)) {
  console.log(`${name}: ${v.expected.ok ? 'accepted' : `refused (${v.expected.error})`}`);
}
console.log(`Wrote ${path.relative(APP, OUT)}/androidChainVectors.json and androidCircuitAbis.json from circuits ${source.circuitsCommit}${source.circuitsWorkingTreeChanged ? ' (working tree changed)' : ''}`);

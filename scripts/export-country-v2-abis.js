#!/usr/bin/env node
/**
 * Write src/utils/__tests__/fixtures/countryV2CircuitAbis.json: the `fn main`
 * parameters (name, visibility, flattened size) of Coinbase Country v2's three
 * compiled packages -- coinbase_country_attestation_v2 (iPhone / server),
 * _android (RKP) and _android_factory -- which the app's input vectors are
 * held to (countryV2InputsFollowTheCircuitAbi.test.ts). Only the ABI is read;
 * nothing random is generated, so a re-run on the same circuits changes
 * nothing.
 *
 * Usage (from anywhere inside the app or the parent repository):
 *   env -u NODE_OPTIONS node scripts/export-country-v2-abis.js
 *   CIRCUITS_DIR=<circuits checkout> env -u NODE_OPTIONS node scripts/export-country-v2-abis.js
 *
 * Prerequisite: the three packages compiled in that checkout
 * (circuits scripts/build.sh coinbase-country-attestation-v2[-android[-factory]]).
 * The circuits commit, and whether its working tree had source changes, is
 * recorded in the fixture.
 */
const {execFileSync} = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8'}).trim();

const APP = git(process.cwd(), 'rev-parse', '--show-toplevel');
const SUPER = git(APP, 'rev-parse', '--show-superproject-working-tree');
const CIRCUITS = process.env.CIRCUITS_DIR || (SUPER ? path.join(SUPER, 'circuits') : '');
if (!CIRCUITS || !fs.existsSync(path.join(CIRCUITS, 'coinbase-country-v2-libs'))) {
  throw new Error(`No circuits checkout with coinbase-country-v2-libs at '${CIRCUITS}'. Set CIRCUITS_DIR.`);
}

const PACKAGES = {
  app_attest: ['coinbase-country-attestation-v2', 'coinbase_country_attestation_v2'],
  android: ['coinbase-country-attestation-v2-android', 'coinbase_country_attestation_v2_android'],
  android_factory: ['coinbase-country-attestation-v2-android-factory', 'coinbase_country_attestation_v2_android_factory'],
};

function abiOf(dir, pkg) {
  const file = path.join(CIRCUITS, dir, 'target', `${pkg}.json`);
  if (!fs.existsSync(file)) throw new Error(`${file} is missing: build ${dir} first (circuits scripts/build.sh ${dir}).`);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const size = t => (t.kind === 'array' ? t.length * size(t.type)
    : t.kind === 'struct' ? t.fields.reduce((n, f) => n + size(f.type), 0) : 1);
  return {
    package: pkg,
    noirVersion: j.noir_version,
    jsonSha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    parameters: j.abi.parameters.map(p => ({name: p.name, visibility: p.visibility, size: size(p.type)})),
  };
}

const out = {
  source: {
    circuitsCommit: git(CIRCUITS, 'rev-parse', 'HEAD'),
    circuitsWorkingTreeChanged: git(CIRCUITS, 'status', '--porcelain', '--',
      'coinbase-country-v2-libs', 'statement-signer', ...Object.values(PACKAGES).map(([d]) => `${d}/src`), ...Object.values(PACKAGES).map(([d]) => `${d}/Nargo.toml`)) !== '',
  },
  ...Object.fromEntries(Object.entries(PACKAGES).map(([variant, [dir, pkg]]) => [variant, abiOf(dir, pkg)])),
};

const file = path.join(APP, 'src/utils/__tests__/fixtures/countryV2CircuitAbis.json');
fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${path.relative(APP, file)} from circuits ${out.source.circuitsCommit}${out.source.circuitsWorkingTreeChanged ? ' (working tree changed)' : ''}`);

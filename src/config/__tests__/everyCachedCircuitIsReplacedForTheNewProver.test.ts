/**
 * The Noir 1.0.0 / bb 6.0.0 prover (mopro/vendor/noir-rs) cannot use files
 * built for nargo 1.0.0-beta.19 / bb 4.2: every key differs. A phone keeps
 * downloaded circuit files until their cache version changes (or, for a
 * pinned row, its ref), so every circuit's version -- CIRCUIT_DATA_VERSIONS
 * and each pinned row's dataVersion -- must be above the one beta.19 files
 * were stored under. GIWA and the Dojang Playground were read from circuits
 * main under beta.19 (no row; their stored version was CIRCUIT_DATA_VERSIONS)
 * and have pinned rows since 2026-11-17.
 */
import {CIRCUIT_DATA_VERSIONS} from '../contracts';
import {CIRCUIT_ARTIFACT_SOURCES} from '../circuitArtifacts';

/** The versions beta.19 / bb 4.2 files were stored under (app main 1aa1e2e). */
const BETA19_DATA_VERSIONS: Record<string, number> = {
  coinbase_attestation: 2,
  coinbase_country_attestation: 3,
  oidc_domain_attestation: 6,
  giwa_attestation: 3,
  dojang_playground: 2,
  human_passport_score: 1,
};

/** Every pinned row's beta.19 version, per signer variant. */
const BETA19_ROW_VERSIONS: Record<string, Record<string, number>> = {
  coinbase_attestation: {app_attest: 2, android: 3, android_factory: 4},
  coinbase_country_attestation: {app_attest: 3, android: 4, android_factory: 5},
  oidc_domain_attestation: {app_attest: 6, android: 7, android_factory: 8},
  human_passport_score: {app_attest: 1, android: 1, android_factory: 1},
  // No row under beta.19: files were stored under CIRCUIT_DATA_VERSIONS.
  giwa_attestation: {app_attest: 3, android: 3, android_factory: 3},
  dojang_playground: {app_attest: 2, android: 2, android_factory: 2},
};

describe('every cached circuit is replaced for the 1.0.0 prover', () => {
  it('names the same circuits as the beta.19 table', () => {
    expect(Object.keys(CIRCUIT_DATA_VERSIONS).sort()).toEqual(Object.keys(BETA19_DATA_VERSIONS).sort());
    expect(Object.keys(CIRCUIT_ARTIFACT_SOURCES).sort()).toEqual(Object.keys(BETA19_ROW_VERSIONS).sort());
  });

  it.each(Object.keys(BETA19_DATA_VERSIONS))('%s: CIRCUIT_DATA_VERSIONS is above its beta.19 version', id => {
    expect(CIRCUIT_DATA_VERSIONS[id as keyof typeof CIRCUIT_DATA_VERSIONS]).toBeGreaterThan(BETA19_DATA_VERSIONS[id]);
  });

  it.each(Object.keys(BETA19_ROW_VERSIONS))('%s: every pinned row is above every version its id ever stored', id => {
    const row = CIRCUIT_ARTIFACT_SOURCES[id as keyof typeof CIRCUIT_ARTIFACT_SOURCES]!;
    const oldMax = Math.max(...Object.values(BETA19_ROW_VERSIONS[id]), BETA19_DATA_VERSIONS[id]);
    for (const [variant, source] of Object.entries(row)) {
      expect([variant, source.dataVersion > oldMax]).toEqual([variant, true]);
    }
    expect(CIRCUIT_DATA_VERSIONS[id as keyof typeof CIRCUIT_DATA_VERSIONS]).toBe(row.app_attest.dataVersion);
  });
});

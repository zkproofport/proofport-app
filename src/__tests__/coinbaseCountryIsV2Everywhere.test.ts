/**
 * Coinbase Country is v2 in this build, everywhere: every Country proof --
 * from the Proof tab or a dApp's request, on iPhone or Android -- is made with
 * the device statement (revocation looked up right before proving, the
 * transaction's country named), the v2 circuit files, v2's nullifier and
 * v2's optional EIP-712 action, under the id `coinbase_country_attestation`.
 * Nothing falls back to v1's files, verifier or nullifier.
 */
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'ios'}}));
jest.mock('@react-native-async-storage/async-storage', () => ({__esModule: true, default: {}}));
export {};

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const {CIRCUIT_ARTIFACT_SOURCES, COUNTRY_V2_CIRCUITS_REF, coinbaseCountryArtifact, requireArtifactRef} = require('../config/circuitArtifacts');
const {BROADCAST_PATHS, CIRCUIT_DATA_VERSIONS, FALLBACK_VERIFIERS} = require('../config/contracts');
const {APP_ACTION_BINDING_OVERRIDES, CIRCUIT_ACTION_BINDING, circuitActionBinding} = require('../config/circuitIds');
const {CIRCUIT_ACTION_BINDING: CORE_BINDING} = require('@zkproofport-app/core/circuits');
const {requireVerifierForVariant} = require('../utils/proofSignerVariant');
const {AppAttestError} = require('../appAttest/appAttestError');
const {ErrorCodes} = require('../constants/errorCodes');
const en = require('../i18n/locales/en.json');
const ko = require('../i18n/locales/ko.json');
/* eslint-enable @typescript-eslint/no-var-requires */

const SRC = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const SCREEN = read('screens/proof/ProofGenerationScreen.tsx');
const HOOK = read('hooks/useCoinbaseCountry.ts');

describe('the proof screen', () => {
  const branch = SCREEN.slice(SCREEN.indexOf('if (isCountry) {'), SCREEN.indexOf('} else if (isGiwa) {'));

  it('makes the device statement for every Country request, dApp requests included, before proving', () => {
    const statement = branch.indexOf('prepareCoinbaseCountryStatement({');
    const prove = branch.indexOf('await generateCountryProof(');
    expect(statement).toBeGreaterThan(-1);
    expect(prove).toBeGreaterThan(statement);
    expect(branch.slice(0, statement)).not.toMatch(/proofRequest\)\s*\{|settingsStore/);
    expect(branch).toMatch(/appAttest: \{witness: countryWitness, action\}/);
  });

  it("checks the transaction's country against the list before the statement and the wallet", () => {
    const country = branch.indexOf('attestedCountryOfTx(txResult.rawTransaction)');
    const refusal = branch.indexOf('countryRequestRefusal(');
    const statement = branch.indexOf('prepareCoinbaseCountryStatement({');
    expect(country).toBeGreaterThan(-1);
    expect(refusal).toBeGreaterThan(country);
    expect(statement).toBeGreaterThan(refusal);
    // A refusal ends the attempt with its own code, and nothing after it runs.
    expect(branch).toMatch(/if \(refusal\) \{\n\s*addLog\(`\[Country\] \$\{refusal\.error\}`\);\n\s*failAttempt\(refusal\);\n\s*return;\n\s*\}/);
    expect(branch).toMatch(/transactionCountry,\n\s*log: addLog/);
  });

  it('carries the action from the action screen or the dApp request', () => {
    expect(branch).toMatch(/route\.params\?\.action \?\?\s*\(proofRequest\?\.inputs as \{action\?: TypedAction\} \| undefined\)\?\.action/);
  });

  it('names the circuit to the hook, which refuses any other', () => {
    expect(branch).toMatch(/circuit: canonical,/);
    expect(HOOK).toMatch(/const CIRCUIT_NAME = 'coinbase_country_attestation';/);
    expect(HOOK).toMatch(/requireVerifierForVariant\(circuitName, signerVariant\)/);
    expect(HOOK).toMatch(/coinbaseCountryArtifact\(signerVariant\)/);
    expect(HOOK).toMatch(/numPublicInputs !== artifact\.publicInputCount/);
  });
});

describe('the files', () => {
  it('come from one pinned ref per platform, 215 public inputs each, never v1\'s directory', () => {
    const row = CIRCUIT_ARTIFACT_SOURCES.coinbase_country_attestation;
    expect(Object.keys(row).sort()).toEqual(['android', 'android_factory', 'app_attest']);
    for (const v of Object.keys(row)) {
      expect(row[v].ref).toBe(COUNTRY_V2_CIRCUITS_REF);
      expect(row[v].publicInputCount).toBe(215);
      expect(row[v].basePath).toMatch(/^coinbase-country-attestation-v2(-android(-factory)?)?\/target$/);
      expect(row[v].remoteFileName).toMatch(/^coinbase_country_attestation_v2(_android(_factory)?)?$/);
    }
    expect(new Set((Object.values(row) as {dataVersion: number}[]).map(r => r.dataVersion)).size).toBe(3);
    expect(CIRCUIT_DATA_VERSIONS.coinbase_country_attestation).toBe(row.app_attest.dataVersion);
    expect(CIRCUIT_DATA_VERSIONS.coinbase_country_attestation).toBeGreaterThan(2); // v1's files are replaced
    expect(() => coinbaseCountryArtifact('web')).toThrow(/no circuit files for statement signer 'web'/);
  });

  it('end at an error naming the constant while the ref is empty -- never at v1', () => {
    for (const v of ['app_attest', 'android', 'android_factory']) {
      const source = coinbaseCountryArtifact(v);
      if (COUNTRY_V2_CIRCUITS_REF === '') {
        expect(() => requireArtifactRef(source)).toThrow(/COUNTRY_V2_CIRCUITS_REF/);
      } else {
        expect(requireArtifactRef(source)).toBe(COUNTRY_V2_CIRCUITS_REF);
      }
    }
  });

  it('are not refreshed from a broadcast that names v1', () => {
    expect(BROADCAST_PATHS.coinbase_country_attestation).toBeNull();
  });
});

describe('the verifier', () => {
  it.each(['development', 'staging', 'production'])('%s: an empty row refuses a proof before it is made (E2018)', env => {
    if (FALLBACK_VERIFIERS[env].coinbase_country_attestation !== '') {
      expect(() => requireVerifierForVariant('coinbase_country_attestation', 'app_attest', env)).not.toThrow();
      return;
    }
    let thrown: unknown;
    try {
      requireVerifierForVariant('coinbase_country_attestation', 'app_attest', env);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AppAttestError);
    expect([(thrown as {code: string}).code, (thrown as {reason: string}).reason]).toEqual(['E2018', 'device_no_verifier']);
  });

  it.each(['android', 'android_factory'])('%s: no row in this build is E2018, never the standard contract', variant => {
    let thrown: unknown;
    try {
      requireVerifierForVariant('coinbase_country_attestation', variant, 'staging');
    } catch (e) {
      thrown = e;
    }
    // Until the Android Country verifiers are deployed and listed.
    if (thrown) expect((thrown as {code: string}).code).toBe('E2018');
  });

  it('other circuits keep proving: their rows are set', () => {
    for (const env of ['development', 'staging', 'production']) {
      expect(() => requireVerifierForVariant('coinbase_attestation', 'app_attest', env)).not.toThrow();
    }
    expect(() => requireVerifierForVariant('no_such_circuit', 'app_attest', 'staging')).toThrow(/Unknown circuit 'no_such_circuit'/);
    expect(() => requireVerifierForVariant('coinbase_attestation', 'app_attest', 'prod')).toThrow(/Unknown environment 'prod'/);
  });
});

describe('the action', () => {
  it('is optional for Country, as for Coinbase KYC v2', () => {
    expect(circuitActionBinding('coinbase_country_attestation')).toBe('optional');
    expect(CIRCUIT_ACTION_BINDING.coinbase_attestation).toBe('optional');
  });

  it("is the app's override only while core still says otherwise", () => {
    // Fails the day core says 'optional' itself: then remove the override.
    for (const [id, binding] of Object.entries(APP_ACTION_BINDING_OVERRIDES)) {
      expect([id, CORE_BINDING[id]]).not.toEqual([id, binding]);
    }
    for (const id of Object.keys(CORE_BINDING)) {
      if (!(id in APP_ACTION_BINDING_OVERRIDES)) expect([id, CIRCUIT_ACTION_BINDING[id]]).toEqual([id, CORE_BINDING[id]]);
    }
  });

  it('opens after the country screen, on the action screen, which keeps the list and offers no other circuit', () => {
    const countryScreen = read('screens/proof/CountryInputScreen.tsx');
    expect(countryScreen).toMatch(/navigation\.navigate\('ActionInput', \{\s*circuit: 'coinbase_country_attestation',\s*countryInputs: \{/);
    const actionScreen = read('screens/proof/ActionInputScreen.tsx');
    expect(actionScreen).toMatch(/actionCircuitsFor\(route\.params\.circuit\)/);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {actionCircuitsFor} = require('../screens/proof/actionCircuits');
    expect(actionCircuitsFor('coinbase_country_attestation')).toEqual(['coinbase_country_attestation']);
    for (const id of ['coinbase_attestation', 'giwa_attestation', 'dojang_playground']) {
      expect([id, actionCircuitsFor(id).includes('coinbase_country_attestation')]).toEqual([id, false]);
    }
    expect(() => actionCircuitsFor('oidc_domain_attestation')).toThrow(/takes no action/);
    // Both ways to the proof screen carry the list.
    expect(actionScreen.match(/route\.params\.countryInputs \? \{countryInputs: route\.params\.countryInputs\} : \{\}/g)).toHaveLength(2);
  });
});

describe('the code it adds', () => {
  it('E2020 is registered and translated, and its detail may be shown', () => {
    expect(ErrorCodes.E2020.code).toBe('E2020');
    for (const locale of [en, ko]) {
      expect(locale.host.errors.E2020.title).toBeTruthy();
      expect(locale.host.errors.E2020.description).toBeTruthy();
    }
  });
});

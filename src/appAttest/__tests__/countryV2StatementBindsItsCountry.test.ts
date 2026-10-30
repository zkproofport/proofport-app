/**
 * Coinbase Country v2's device statement: the same lookup and the same device
 * signers as Coinbase KYC v2, about the Country attestation, and naming the
 * country the record holds -- which must be the country of the transaction
 * being proved. Every refusal comes before anything is signed.
 *
 * The circuit (circuits coinbase-country-v2-libs client_data.nr) checks a
 * 227-byte statement: KYC's 225 bytes with the tag
 * keccak256("coinbase_country_attestation") and the Coinbase Verified Country
 * schema, then the two ASCII country bytes, equal to the attestCountry
 * transaction's.
 */
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'android'}}));
const mockDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => (mockDisk.has(k) ? mockDisk.get(k)! : null),
    setItem: async (k: string, v: string) => void mockDisk.set(k, v),
    removeItem: async (k: string) => void mockDisk.delete(k),
  },
}));

import * as crypto from 'node:crypto';
import {ethers} from 'ethers';
import {AppAttestError} from '../appAttestError';
import {buildClientData, buildCoinbaseClientData, COINBASE_ATTESTER} from '../clientData';
import {
  COINBASE_COUNTRY_SCHEMA_UID,
  COINBASE_KYC_SCHEMA_UID,
  COINBASE_STATEMENT_KINDS,
  coinbaseStatementKind,
} from '../coinbaseStatementKinds';
import {
  coinbaseRequestDigest,
  coinbaseRequestDigestFor,
  prepareCoinbaseCountryStatement,
  prepareCoinbaseKycStatement,
} from '../coinbaseKycStatement';
import {fetchAttestationStatus, recordCountry, revocationClientData, type AttestationStatus} from '../revocationStatement';
import {deviceCheckCode} from '../deviceCheckReasons';
import {ANDROID_CIRCUIT_TRUST} from '../../androidAttest/androidSigner';
import {isAndroidStatementWitness} from '../../androidAttest/androidSignerInputs';
import {GOOGLE_KEY_ATTESTATION_CA1} from '../../utils/androidKeyAttestation';
import {__setAndroidChainKindForTests} from '../../config/signerPlatform';
import {computeScope} from '../../utils/circuitHelpers';
import {coinbaseSignalHashFor} from '../../utils/coinbaseSignal';
import vectors from '../../utils/__tests__/fixtures/androidChainVectors.json';

const WALLET = '0xD6C714247037E5201B7e3dEC97a3ab59a9d2F739';
const UID = '0xed8abaf1eb40dd475fdc94acfb422f3c38c26872c74db237da7179b0e8f46dae';
const NOW = Date.UTC(2026, 2, 1) / 1000;
// The real Coinbase Verified Country record of WALLET (base.easscan.org,
// read 2026-10-30): `string verifiedCountry` = "KR".
const KR_DATA =
  '0x0000000000000000000000000000000000000000000000000000000000000020' +
  '0000000000000000000000000000000000000000000000000000000000000002' +
  '4b52000000000000000000000000000000000000000000000000000000000000';
const COUNTRY_TAG = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('coinbase_country_attestation'));
const KYC_TAG = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('coinbase_attestation'));
const abiString = (v: string) => ethers.utils.defaultAbiCoder.encode(['string'], [v]);

const record = (o: Partial<AttestationStatus> = {}): AttestationStatus => ({
  uid: UID, schemaId: COINBASE_COUNTRY_SCHEMA_UID, attester: COINBASE_ATTESTER, recipient: WALLET, revoked: false, data: KR_DATA, ...o,
});

function codeOf(e: unknown): string {
  return e instanceof AppAttestError ? `${e.code}/${e.reason}` : e instanceof Error ? `error: ${e.message}` : 'no error';
}
const settle = (p: Promise<unknown>) => p.then(() => 'ok', codeOf);

const fields = (o: Record<string, unknown> = {}) => ({
  wallet: WALLET, attestedAt: NOW, schemaUid: COINBASE_COUNTRY_SCHEMA_UID, attester: COINBASE_ATTESTER,
  attestationUid: UID, revoked: false, requestDigest: '0x' + '44'.repeat(32), scope: computeScope('scope'), country: 'KR', ...o,
});

describe('the statement kinds', () => {
  it('are exactly the two Coinbase circuits, and any other id is an error by name', () => {
    expect(Object.keys(COINBASE_STATEMENT_KINDS).sort()).toEqual(['coinbase_attestation', 'coinbase_country_attestation']);
    for (const id of ['giwa_attestation', '__proto__', 'constructor', '', 'coinbase-country']) {
      expect(() => coinbaseStatementKind(id)).toThrow(/No Coinbase device statement for circuit/);
    }
  });

  it("give each circuit its own lookup reasons, each mapped to the same codes as KYC's", () => {
    const kyc = COINBASE_STATEMENT_KINDS.coinbase_attestation.reasons;
    const country = COINBASE_STATEMENT_KINDS.coinbase_country_attestation.reasons;
    for (const k of Object.keys(kyc) as (keyof typeof kyc)[]) {
      expect(country[k]).toMatch(/^country_/);
      expect([k, deviceCheckCode(country[k])]).toEqual([k, deviceCheckCode(kyc[k])]);
    }
  });
});

describe('the 227-byte statement', () => {
  it("is KYC's 225 bytes with Country's tag and schema, then the country", () => {
    const cd = buildCoinbaseClientData('coinbase_country_attestation', fields());
    expect(cd).toHaveLength(227);
    expect(ethers.utils.toUtf8String(cd.slice(0, 16))).toBe('ZKProofport/AA/1');
    expect(ethers.utils.hexlify(cd.slice(16, 48))).toBe(COUNTRY_TAG);
    expect(ethers.utils.hexlify(cd.slice(76, 108))).toBe(COINBASE_COUNTRY_SCHEMA_UID);
    expect(cd[160]).toBe(0);
    expect(String.fromCharCode(cd[225], cd[226])).toBe('KR');
  });

  it("leaves Coinbase KYC v2's 225 bytes as they were", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {country: _c, ...kyc} = fields({schemaUid: COINBASE_KYC_SCHEMA_UID});
    const a = buildClientData(kyc);
    const b = buildCoinbaseClientData('coinbase_attestation', kyc);
    expect(a).toHaveLength(225);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(ethers.utils.hexlify(a.slice(16, 48))).toBe(KYC_TAG);
    expect(() => buildCoinbaseClientData('coinbase_attestation', {...kyc, country: 'KR'})).toThrow(/carries no country/);
  });

  it.each([
    ['missing', undefined],
    ['lowercase', 'kr'],
    ['one letter', 'K'],
    ['three letters', 'KOR'],
    ['empty', ''],
    ['whitespace', ' K'],
    ['Korean', '한국'],
    ['an emoji flag', '🇰🇷'],
    ['wildcards', '%_'],
    ['digits', '82'],
  ])('refuses a %s country before anything is signed (E2005)', (_l, country) => {
    let thrown: unknown;
    try {
      buildCoinbaseClientData('coinbase_country_attestation', fields({country}));
    } catch (e) {
      thrown = e;
    }
    expect(codeOf(thrown)).toBe('E2005/country_record_unreadable');
  });

  it("refuses a revoked record with Country's own reason (E2011)", () => {
    expect(() => buildCoinbaseClientData('coinbase_country_attestation', fields({revoked: true}))).toThrow(AppAttestError);
    try {
      buildCoinbaseClientData('coinbase_country_attestation', fields({revoked: true}));
    } catch (e) {
      expect(codeOf(e)).toBe('E2011/country_record_revoked');
    }
  });

  it("refuses KYC's schema on a Country statement and the other way round", () => {
    expect(() => buildCoinbaseClientData('coinbase_country_attestation', fields({schemaUid: COINBASE_KYC_SCHEMA_UID}))).toThrow(/not the Coinbase Verified Country schema/);
    expect(() => buildCoinbaseClientData('coinbase_attestation', fields({country: undefined}))).toThrow(/not the Coinbase Verified Account schema/);
  });
});

describe("the record's country", () => {
  it('reads the real record of the E2E wallet as KR', () => {
    expect(recordCountry({uid: UID, data: KR_DATA})).toBe('KR');
    expect(recordCountry({uid: UID, data: abiString('US')})).toBe('US');
  });

  it.each([
    ['lowercase', abiString('kr')],
    ['three letters', abiString('KOR')],
    ['empty', abiString('')],
    ['Korean', abiString('한국')],
    ['a long string', abiString('K'.repeat(10_000))],
    ['not an ABI string', '0x1234'],
    ['empty data', '0x'],
    ['an address instead', ethers.utils.defaultAbiCoder.encode(['address'], [WALLET])],
  ])('refuses %s data as unreadable (E2005)', (_l, data) => {
    let thrown: unknown;
    try {
      recordCountry({uid: UID, data});
    } catch (e) {
      thrown = e;
    }
    expect(codeOf(thrown)).toBe('E2005/country_record_unreadable');
  });

  it('refuses a record the lookup returned without data as incomplete (E3002), never as a country', () => {
    expect(() => recordCountry({uid: UID, data: null})).toThrow(AppAttestError);
    try {
      recordCountry({uid: UID, data: undefined});
    } catch (e) {
      expect(codeOf(e)).toBe('E3002/country_lookup_incomplete');
    }
  });
});

describe('the lookup half', () => {
  const lookup = (status: AttestationStatus | Error, o: Record<string, unknown> = {}) => {
    const fetchStatus = jest.fn(async (_uid: string, _log: unknown, reasons: unknown) => {
      expect(reasons).toBe(COINBASE_STATEMENT_KINDS.coinbase_country_attestation.reasons);
      if (status instanceof Error) throw status;
      return status;
    });
    return {
      fetchStatus,
      run: () => revocationClientData(
        {circuit: 'coinbase_country_attestation', wallet: WALLET, attestationUid: UID, requestDigest: '0x' + '44'.repeat(32), scope: computeScope('scope'), transactionCountry: 'KR', ...o} as never,
        {fetchStatus: fetchStatus as never, now: () => NOW, log: () => {}},
      ),
    };
  };

  it('names the record\'s country when it is the transaction\'s', async () => {
    const {run} = lookup(record());
    const {clientData, attestedAt} = await run();
    expect(attestedAt).toBe(NOW);
    expect(clientData).toHaveLength(227);
    expect(String.fromCharCode(clientData[225], clientData[226])).toBe('KR');
    expect(ethers.utils.hexlify(clientData.slice(128, 160))).toBe(UID);
  });

  it('refuses a record naming another country than the transaction (E2020)', async () => {
    expect(await settle(lookup(record({data: abiString('US')})).run())).toBe('E2020/country_record_differs_from_transaction');
  });

  it.each([
    ['revoked', record({revoked: true}), 'E2011/country_record_revoked'],
    ["KYC's schema", record({schemaId: COINBASE_KYC_SCHEMA_UID}), 'E2005/country_record_wrong_schema'],
    ['another issuer', record({attester: '0x' + '33'.repeat(20)}), 'E2005/country_record_wrong_issuer'],
    ['another wallet', record({recipient: '0x' + '11'.repeat(20)}), 'E2005/country_record_other_wallet'],
    ['unreadable data', record({data: abiString('kr')}), 'E2005/country_record_unreadable'],
    ['no data', record({data: null}), 'E3002/country_lookup_incomplete'],
  ])('refuses a %s record', async (_l, status, expected) => {
    expect(await settle(lookup(status).run())).toBe(expected);
  });

  it('carries a lookup failure through with its own code', async () => {
    expect(await settle(lookup(new AppAttestError('country_lookup_unreachable', 'down')).run())).toBe('E3002/country_lookup_unreachable');
  });

  it.each([
    ['no transaction country', {transactionCountry: undefined}],
    ['a lowercase transaction country', {transactionCountry: 'kr'}],
  ])('is a mistake in the app with %s, before any lookup', async (_l, o) => {
    const {run, fetchStatus} = lookup(record(), o);
    expect(await settle(run())).toMatch(/^error: Coinbase Country v2 needs the transaction's country/);
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it('is a mistake in the app to give KYC a transaction country', async () => {
    const fetchStatus = jest.fn();
    const p = revocationClientData(
      {circuit: 'coinbase_attestation', wallet: WALLET, attestationUid: UID, requestDigest: '0x' + '44'.repeat(32), scope: computeScope('scope'), transactionCountry: 'KR'},
      {fetchStatus: fetchStatus as never, now: () => NOW, log: () => {}},
    );
    expect(await settle(p)).toMatch(/carries no country/);
    expect(fetchStatus).not.toHaveBeenCalled();
  });
});

describe("the lookup asks for the record's data, with Country's reasons", () => {
  const answer = (body: unknown, ok = true, status = 200) => jest.fn(async () => ({ok, status, json: async () => body}));
  const reasons = COINBASE_STATEMENT_KINDS.coinbase_country_attestation.reasons;

  it('asks for data and returns it', async () => {
    const f = answer({data: {attestation: {id: UID, schemaId: COINBASE_COUNTRY_SCHEMA_UID, attester: COINBASE_ATTESTER, recipient: WALLET, revoked: false, data: KR_DATA}}});
    const s = await fetchAttestationStatus(UID, () => {}, reasons, f);
    expect(s.data).toBe(KR_DATA);
    const sent = JSON.parse((f.mock.calls[0] as unknown as [string, {body: string}])[1].body);
    expect(sent.query).toMatch(/\bdata\b/);
  });

  it('raises each failure under Country\'s reason', async () => {
    expect(await settle(fetchAttestationStatus(UID, () => {}, reasons, answer({}, false, 503)))).toBe('E3002/country_lookup_unreachable');
    expect(await settle(fetchAttestationStatus(UID, () => {}, reasons, answer({errors: [{message: 'x'}]})))).toBe('E3002/country_lookup_errors');
    expect(await settle(fetchAttestationStatus(UID, () => {}, reasons, answer({data: {attestation: null}})))).toBe('E2005/country_record_missing');
    expect(await settle(fetchAttestationStatus(UID, () => {}, reasons, answer({data: {attestation: {id: UID}}})))).toBe('E3002/country_lookup_incomplete');
    const f = answer({});
    expect(await settle(fetchAttestationStatus("0x12' OR 1=1", () => {}, reasons, f))).toBe('E2005/country_record_uid_malformed');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('the statement on an Android phone', () => {
  const TEGU = (vectors.cases as unknown as Record<string, {chain: string[]}>)['tegu-sdk36-sb-ec-2026-root'].chain;
  const TRUST = {
    ...ANDROID_CIRCUIT_TRUST,
    app: {packageName: 'com.google.android.attestation', signingCertSha256: '103938ee4537e59e8ee792f654504fb8346fc6b346d0bbc4415fc339fcfc8ec1'},
    rootKey: GOOGLE_KEY_ATTESTATION_CA1,
  };
  const NO_INTEGRITY = {decrypt: async (): Promise<never> => {
    throw new Error('an RKP chain asked for a Play Integrity verdict');
  }};
  const KEY = crypto.generateKeyPairSync('ec', {namedCurve: 'P-256'});
  const android = () => {
    const signed: Uint8Array[] = [];
    return {
      signed,
      native: {
        attestAndSign: jest.fn(async (b64: string) => {
          const statement = Buffer.from(b64, 'base64');
          signed.push(Uint8Array.from(statement));
          return {chain: TEGU, signature: crypto.sign('sha256', statement, KEY.privateKey).toString('base64'), strongBox: true, sdkInt: 36};
        }),
        requestIntegrityToken: jest.fn(),
      },
    };
  };
  const action = {
    domain: {name: 'Forum', version: '1', chainId: 84532, verifyingContract: '0x1111111111111111111111111111111111111111'},
    types: {Join: [{name: 'topicId', type: 'string'}]},
    primaryType: 'Join',
    message: {topicId: '한국어 topic'},
  };

  beforeEach(() => {
    __setAndroidChainKindForTests(null);
    mockDisk.clear();
  });

  it.each([
    ['no action', undefined],
    ['an EIP-712 action', action],
  ])('signs the 227 bytes for %s, binding the digest the wallet will sign', async (_l, act) => {
    const a = android();
    const fetchStatus = jest.fn(async () => record());
    const w = await prepareCoinbaseCountryStatement(
      {walletAddress: WALLET, attestationUid: UID, scopeString: 'scope', action: act as never, transactionCountry: 'KR', log: () => {}},
      {platform: 'android', android: {native: a.native as never, trust: TRUST, integrity: NO_INTEGRITY}, revocation: {fetchStatus: fetchStatus as never, now: () => NOW}},
    );
    expect(isAndroidStatementWitness(w)).toBe(true);
    expect(w.clientData).toHaveLength(227);
    expect(a.signed).toEqual([w.clientData]);
    const digest = coinbaseRequestDigestFor('coinbase_country_attestation', WALLET, 'scope', act as never);
    expect(ethers.utils.hexlify(w.clientData.slice(161, 193))).toBe(digest.toLowerCase());
    if (!act) {
      // The signal hash names the circuit: never Coinbase KYC's digest.
      expect(digest).not.toBe(coinbaseRequestDigest(WALLET, 'scope'));
      expect(ethers.utils.hexlify(coinbaseSignalHashFor('coinbase_country_attestation', WALLET, 'scope')))
        .toBe(ethers.utils.solidityKeccak256(['address', 'string', 'string'], [WALLET, 'scope', 'coinbase_country_attestation']));
    }
  });

  it.each([
    ['revoked', record({revoked: true}), 'E2011/country_record_revoked'],
    ['another country', record({data: abiString('US')}), 'E2020/country_record_differs_from_transaction'],
    ['KYC instead of Country', record({schemaId: COINBASE_KYC_SCHEMA_UID}), 'E2005/country_record_wrong_schema'],
  ])('signs nothing for a %s record', async (_l, status, expected) => {
    const a = android();
    const p = prepareCoinbaseCountryStatement(
      {walletAddress: WALLET, attestationUid: UID, scopeString: 'scope', transactionCountry: 'KR', log: () => {}},
      {platform: 'android', android: {native: a.native as never, trust: TRUST, integrity: NO_INTEGRITY}, revocation: {fetchStatus: (async () => status) as never, now: () => NOW}},
    );
    expect(await settle(p)).toBe(expected);
    expect(a.signed).toEqual([]);
  });

  it("leaves Coinbase KYC's statement at 225 bytes on the same phone", async () => {
    const a = android();
    const w = await prepareCoinbaseKycStatement(
      {walletAddress: WALLET, attestationUid: UID, scopeString: 'scope', log: () => {}},
      {platform: 'android', android: {native: a.native as never, trust: TRUST, integrity: NO_INTEGRITY}, revocation: {fetchStatus: (async () => record({schemaId: COINBASE_KYC_SCHEMA_UID, data: '0x'})) as never, now: () => NOW}},
    );
    expect(w.clientData).toHaveLength(225);
    expect(ethers.utils.hexlify(w.clientData.slice(16, 48))).toBe(KYC_TAG);
  });

  it('an unknown platform is an error by name, never a signer', async () => {
    await expect(prepareCoinbaseCountryStatement(
      {walletAddress: WALLET, attestationUid: UID, scopeString: 'scope', transactionCountry: 'KR', log: () => {}},
      {platform: 'web' as never},
    )).rejects.toThrow(/No Coinbase KYC statement signer for 'web'/);
  });
});

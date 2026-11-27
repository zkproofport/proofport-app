/**
 * GIWA KYC v2 and Dojang Playground v2: the 233-byte device statement that a
 * fresh EAS read found the attestation neither revoked nor expired.
 *
 * The circuit (circuits giwa-v2-libs/src/statement.nr) checks every field at
 * the offsets below, revoked == 0, and expirationTime == 0 or > attested_at.
 * Every refusal here comes before the device or the wallet is asked to sign.
 */
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'ios'}}));
const mockSignAndroid = jest.fn();
jest.mock('../../androidAttest/androidSigner', () => ({
  ANDROID_CIRCUIT_TRUST: {},
  relayIntegrityDecrypter: () => ({}),
  signStatementOnAndroid: (...a: unknown[]) => mockSignAndroid(...a),
}));
const mockEnsureKey = jest.fn();
const mockAssert = jest.fn();
jest.mock('../appAttestKey', () => ({
  ensureAttestedKey: (...a: unknown[]) => mockEnsureKey(...a),
  assertClientData: (...a: unknown[]) => mockAssert(...a),
}));
jest.mock('../revocationStatement', () => ({requireProductionCredential: () => {}}));

import {ethers} from 'ethers';
import {
  buildGiwaStatement,
  giwaRequestDigest,
  giwaStatementBytes,
  giwaStatementKind,
  GIWA_EAS,
  GIWA_STATEMENT_KINDS,
  GIWA_STATEMENT_LEN,
  prepareGiwaStatement,
} from '../giwaStatement';
import {AttestationNotLiveError} from '../../utils/easAttestationStatus';
import {oprfScopeBytesOf} from '../../oprf/circuitInputs';

const WALLET = '0x5A3E649208Ae15ec52496c1Ae23b2Ff89Ac02f0c';
const UID = '0x2045041b8869d46fecf5e7ae6ab99b4a6165086555175f0f26a4c703eadb2c48';
const NOW = 1_795_000_000;
const REQUEST_ID = '3f2b8c1e-9d4a-4f6b-8e2c-1a7d5b9c0e4f';
const hex = (b: Uint8Array, from: number, len: number) => ethers.utils.hexlify(b.slice(from, from + len));
const u64 = (b: Uint8Array, from: number) => Number(ethers.BigNumber.from(b.slice(from, from + 8)));

const fields = (o: Record<string, unknown> = {}) => ({
  wallet: WALLET, attestedAt: NOW, attestationUid: UID, requestDigest: '0x' + '44'.repeat(32),
  scope: oprfScopeBytesOf('vote-2026'), expirationTime: 0, ...o,
});

describe('the statement kinds', () => {
  it('are exactly GIWA KYC and the Dojang Playground, with the schema and attester the circuits pin', () => {
    expect(Object.keys(GIWA_STATEMENT_KINDS).sort()).toEqual(['dojang_playground', 'giwa_attestation']);
    expect(GIWA_STATEMENT_KINDS.giwa_attestation).toMatchObject({
      schemaUid: '0xbda8dd64efa4c537514cfe4c96ab5d5f14a8ec0c9105b799b47a010e89c0c72d',
      attester: '0x6646d970499BBeD728636823A5A7e551E811b414',
    });
    expect(GIWA_STATEMENT_KINDS.dojang_playground).toMatchObject({
      schemaUid: '0x072d75e18b2be4f89a13a7147240477481c4b526d5795802acba59046b426e08',
      attester: '0x63CCe2b569A7bC35895ee24306c1512fefc06121',
    });
  });
  it.each(['coinbase_attestation', '', 'GIWA_ATTESTATION', '__proto__', 'toString'])('any other id (%p) is an error by name', id => {
    expect(() => giwaStatementKind(id)).toThrow(/No GIWA status statement for/);
  });
});

describe('the 233 bytes', () => {
  it.each(['giwa_attestation', 'dojang_playground'] as const)('%s: every field at the offset the circuit reads', circuit => {
    const kind = giwaStatementKind(circuit);
    const s = buildGiwaStatement(circuit, fields({expirationTime: NOW + 86_400}));
    expect(s.length).toBe(GIWA_STATEMENT_LEN);
    expect(Buffer.from(s.slice(0, 16)).toString('utf8')).toBe('ZKProofport/AA/1');
    expect(hex(s, 16, 32)).toBe(ethers.utils.keccak256(ethers.utils.toUtf8Bytes(circuit)));
    expect(ethers.utils.getAddress(hex(s, 48, 20))).toBe(WALLET);
    expect(u64(s, 68)).toBe(NOW);
    expect(hex(s, 76, 32)).toBe(kind.schemaUid);
    expect(ethers.utils.getAddress(hex(s, 108, 20))).toBe(kind.attester);
    expect(hex(s, 128, 32)).toBe(UID);
    expect(s[160]).toBe(0);
    expect(hex(s, 161, 32)).toBe('0x' + '44'.repeat(32));
    expect(hex(s, 193, 32)).toBe(ethers.utils.hexlify(oprfScopeBytesOf('vote-2026')));
    expect(u64(s, 225)).toBe(NOW + 86_400);
  });
  it('the two kinds differ in tag, schema and attester only', () => {
    const a = buildGiwaStatement('giwa_attestation', fields());
    const b = buildGiwaStatement('dojang_playground', fields());
    const differing = Array.from(a).map((x, i) => (x === b[i] ? -1 : i)).filter(i => i >= 0);
    expect(differing.every(i => (i >= 16 && i < 48) || (i >= 76 && i < 128))).toBe(true);
  });
  it('expiry: 0 (never) and one second after attested_at are signed; at or before attested_at is refused', () => {
    expect(u64(buildGiwaStatement('dojang_playground', fields({expirationTime: 0})), 225)).toBe(0);
    expect(u64(buildGiwaStatement('dojang_playground', fields({expirationTime: NOW + 1})), 225)).toBe(NOW + 1);
    for (const expirationTime of [NOW, NOW - 1, 1]) {
      expect(() => buildGiwaStatement('dojang_playground', fields({expirationTime}))).toThrow(/had expired/);
    }
  });
  it.each([
    ['a wallet that is not an address', {wallet: '0x1234'}, /not an address/],
    ['an empty wallet', {wallet: ''}, /not an address/],
    ['attested_at 0', {attestedAt: 0}, /positive/],
    ['attested_at negative', {attestedAt: -5}, /positive/],
    ['attested_at fractional', {attestedAt: NOW + 0.5}, /whole seconds/],
    ['attested_at past year 9999', {attestedAt: 253402300800}, /whole seconds/],
    ['an expiry past year 9999', {expirationTime: 253402300800}, /whole seconds/],
    ['a 31-byte uid', {attestationUid: '0x' + '11'.repeat(31)}, /attestation uid is 31 bytes/],
    ['a 33-byte digest', {requestDigest: '0x' + '11'.repeat(33)}, /request digest is 33 bytes/],
    ['a 31-byte scope', {scope: new Uint8Array(31)}, /scope is 31 bytes/],
  ])('refuses %s', (_why, over, re) => {
    expect(() => buildGiwaStatement('giwa_attestation', fields(over))).toThrow(re);
  });
});

describe('the fresh read behind the statement', () => {
  const live = (o: Record<string, unknown> = {}) => jest.fn(async () => ({uid: UID, expirationTime: 0, time: NOW - 100, ...o}));

  it.each(['giwa_attestation', 'dojang_playground'] as const)(
    '%s asks GIWA EAS about this uid, for this wallet, with the pinned schema AND attester, at the statement time',
    async circuit => {
      const requireLive = live();
      const {statement, attestedAt} = await giwaStatementBytes(
        circuit,
        {walletAddress: WALLET, attestationUid: UID, scopeString: 'vote-2026', requestId: REQUEST_ID, log: () => {}},
        {requireLive, now: () => NOW + 0.9},
      );
      expect(attestedAt).toBe(NOW);
      expect(u64(statement, 68)).toBe(NOW);
      const kind = giwaStatementKind(circuit);
      expect((requireLive.mock.calls[0] as unknown[])[0]).toMatchObject({
        eas: GIWA_EAS, uid: UID, recipient: WALLET, schemaUid: kind.schemaUid, attester: kind.attester, nowSeconds: NOW,
      });
      expect(hex(statement, 161, 32)).toBe(giwaRequestDigest(circuit, 'vote-2026', REQUEST_ID));
    },
  );

  it("carries the record's expiry into the statement", async () => {
    const {statement} = await giwaStatementBytes(
      'dojang_playground',
      {walletAddress: WALLET, attestationUid: UID, scopeString: 's', requestId: REQUEST_ID, log: () => {}},
      {requireLive: live({expirationTime: NOW + 30 * 86_400}), now: () => NOW},
    );
    expect(u64(statement, 225)).toBe(NOW + 30 * 86_400);
  });

  it.each([['revoked', 'E2025'], ['expired', 'E2026'], ['lookup', 'E3002'], ['other_attester', 'E2007'], ['other_wallet', 'E2007']] as const)(
    'a %s record is refused with %s and nothing is signed',
    async (kind, code) => {
      mockAssert.mockReset();
      mockSignAndroid.mockReset();
      mockEnsureKey.mockResolvedValue({credential: {}});
      const requireLive = jest.fn(async () => { throw new AttestationNotLiveError(kind, kind); });
      for (const platform of ['ios', 'android'] as const) {
        await expect(prepareGiwaStatement(
          'giwa_attestation',
          {walletAddress: WALLET, attestationUid: UID, scopeString: 's', requestId: REQUEST_ID, log: () => {}},
          {platform, native: {} as never, requireLive, now: () => NOW, android: {native: {} as never, trust: {} as never, integrity: {} as never}},
        )).rejects.toMatchObject({code});
      }
      expect(mockAssert).not.toHaveBeenCalled();
      expect(mockSignAndroid).not.toHaveBeenCalled();
    },
  );

  it('a typed action changes the bound digest (the wallet signs the action, the statement names it)', async () => {
    const action = {
      domain: {name: 'MyVault', version: '1', chainId: 91342, verifyingContract: '0x0000000000000000000000000000000000000000'},
      types: {Deposit: [{name: 'amount', type: 'uint256'}]}, primaryType: 'Deposit', message: {amount: '1'},
    };
    const without = giwaRequestDigest('giwa_attestation', 's', REQUEST_ID);
    const withAction = giwaRequestDigest('giwa_attestation', 's', REQUEST_ID, action);
    expect(withAction).not.toBe(without);
    expect(giwaRequestDigest('dojang_playground', 's', REQUEST_ID)).not.toBe(without);
  });
});

describe('the device signs exactly the statement', () => {
  beforeEach(() => { mockAssert.mockReset(); mockSignAndroid.mockReset(); mockEnsureKey.mockReset(); });

  it('iPhone: the key is checked first, then the read, then App Attest signs the bytes', async () => {
    const order: string[] = [];
    mockEnsureKey.mockImplementation(async () => { order.push('key'); return {credential: {}}; });
    mockAssert.mockImplementation(async (_deps: unknown, bytes: Uint8Array) => { order.push('assert'); return {credential: {c: 1}, assertion: {counter: 3, a: bytes.length}, keyId: 'k'}; });
    const requireLive = jest.fn(async () => { order.push('read'); return {uid: UID, expirationTime: 0, time: 1}; });
    const w = await prepareGiwaStatement(
      'dojang_playground',
      {walletAddress: WALLET, attestationUid: UID, scopeString: 's', requestId: REQUEST_ID, log: () => {}},
      {platform: 'ios', native: {} as never, requireLive, now: () => NOW},
    );
    expect(order).toEqual(['key', 'read', 'assert']);
    expect((mockAssert.mock.calls[0] as unknown[])[1]).toEqual(w.clientData);
    expect(w).toMatchObject({attestedAt: NOW, credential: {c: 1}, assertion: {counter: 3, a: 233}});
  });

  it('a phone without App Attest is refused before the chain is read', async () => {
    mockEnsureKey.mockRejectedValue(new Error('no App Attest'));
    const requireLive = jest.fn();
    await expect(prepareGiwaStatement(
      'giwa_attestation',
      {walletAddress: WALLET, attestationUid: UID, scopeString: 's', requestId: REQUEST_ID, log: () => {}},
      {platform: 'ios', native: {} as never, requireLive, now: () => NOW},
    )).rejects.toThrow(/no App Attest/);
    expect(requireLive).not.toHaveBeenCalled();
  });

  it("Android: the key attestation chain is checked at attested_at, the statement's own time", async () => {
    mockSignAndroid.mockResolvedValue({variant: 'android'});
    const w = await prepareGiwaStatement(
      'giwa_attestation',
      {walletAddress: WALLET, attestationUid: UID, scopeString: 's', requestId: REQUEST_ID, log: () => {}},
      {platform: 'android', requireLive: jest.fn(async () => ({uid: UID, expirationTime: 0, time: 1})), now: () => NOW,
        android: {native: {} as never, trust: {} as never, integrity: {} as never}},
    );
    const [bytes, opts] = mockSignAndroid.mock.calls[0] as [Uint8Array, {now: number}];
    expect(bytes).toEqual(w.clientData);
    expect(opts.now).toBe(NOW);
    expect(w).toMatchObject({variant: 'android', attestedAt: NOW});
  });

  it('an unknown platform or circuit is an error by name', async () => {
    const req = {walletAddress: WALLET, attestationUid: UID, scopeString: 's', requestId: REQUEST_ID, log: () => {}};
    await expect(prepareGiwaStatement('giwa_attestation', req, {platform: 'web' as never})).rejects.toThrow(/No GIWA statement signer for 'web'/);
    await expect(prepareGiwaStatement('coinbase_attestation' as never, req, {platform: 'ios'})).rejects.toThrow(/No GIWA status statement/);
  });
});

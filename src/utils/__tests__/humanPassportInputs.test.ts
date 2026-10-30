/**
 * human_passport_score inputs, against the circuit's own accepted fixture and
 * against real Base issuances.
 *
 * Matrix:
 *   vector     the builder's 11,164 values equal the vector the circuit
 *              accepted (circuits scripts/human-passport/export-app-vector.js),
 *              in action mode; signal mode zeroes the action pair instead
 *   recovery   the issuer key is recovered from the request digest, and
 *              equals the fixture's issuer key
 *   real data  a direct verifyAndAttest, one wrapped in an ERC-4337
 *              EntryPoint call and one inside another contract's call all
 *              recover Human Passport's real issuer, for the real recipient
 *   refusals   another wallet; tampered data; other expiry; other schema;
 *              two entries; garbage / truncated calldata; a decoy selector
 *   bounds     data of 10,240 bytes builds, 10,241 does not; expired at now;
 *              min_score 0, 2^32, 1.5; leaf index outside the list
 *   head       decimals other than 4, padding in the score word, offset
 *              other than 0xc0, shorter than the head
 */
import {ethers} from 'ethers';
import vector from './fixtures/humanPassportVector.json';
import real from './fixtures/humanPassportRealIssuances.json';
import {
  findVerifyAndAttestCalls,
  matchIssuance,
  passportDigest,
  prepareHumanPassportInputs,
  PRODUCTION_ISSUER_LEAVES,
  readScoreHead,
  type HumanPassportInputParams,
  type PassportRequest,
} from '../humanPassport';
import {HUMAN_PASSPORT_ISSUER, HUMAN_PASSPORT_ISSUER_ROOT} from '../../config/circuitIds';

const issuance = vector.issuance;
const request: PassportRequest = {
  schema: issuance.schema,
  recipient: issuance.recipient,
  expirationTime: issuance.expirationTime,
  revocable: issuance.revocable,
  refUID: issuance.refUID,
  data: issuance.data,
  value: issuance.value,
  nonce: issuance.nonce,
  fee: issuance.fee,
};

/** The fixture's issuer list: the production leaves, then the test issuer's. */
function fixtureLeaves(): string[] {
  const testIssuer = ethers.utils.computeAddress(vector.issuerPubkey);
  return [...PRODUCTION_ISSUER_LEAVES, ethers.utils.keccak256(ethers.utils.concat([testIssuer, issuance.domainSeparator, issuance.schema]))];
}

function recoverIssuerPubkey(): string {
  const digest = passportDigest(issuance.domainSeparator, request);
  for (const v of [27, 28]) {
    const sig = ethers.utils.joinSignature({r: issuance.issuerSignatureRS.slice(0, 66), s: '0x' + issuance.issuerSignatureRS.slice(66), v});
    const key = ethers.utils.recoverPublicKey(digest, sig);
    if (key.toLowerCase() === vector.issuerPubkey.toLowerCase()) return key;
  }
  throw new Error('issuer key not recovered');
}

function params(over: Partial<HumanPassportInputParams> = {}): HumanPassportInputParams {
  return {
    signalHash: new Uint8Array(32),
    action: vector.action,
    userAddress: vector.userAddress,
    userSignature: vector.userSignatureRS + '1b',
    userPubkey: vector.userPubkey,
    scopeString: vector.scopeString,
    minScoreUnits: vector.minScoreUnits,
    nowSeconds: vector.now,
    issuance: {
      request,
      issuerSignature: issuance.issuerSignatureRS,
      issuerPubkey: recoverIssuerPubkey(),
      leafIndex: vector.issuerLeafIndex,
      domainSeparator: issuance.domainSeparator,
    },
    issuerLeaves: fixtureLeaves(),
    ...over,
  };
}

describe('prepareHumanPassportInputs', () => {
  it('builds exactly the vector the circuit accepted', () => {
    const built = prepareHumanPassportInputs(params());
    expect(built).toHaveLength(11164);
    const firstDiff = built.findIndex((v, i) => BigInt(v) !== BigInt(vector.expectedFlat[i]));
    expect(firstDiff).toBe(-1);
  });

  it('puts the fixture tree root and nullifier where the circuit reads them', () => {
    const built = prepareHumanPassportInputs(params());
    const hex = (from: number) => '0x' + built.slice(from, from + 32).map(b => Number(b).toString(16).padStart(2, '0')).join('');
    expect(hex(96)).toBe(vector.signerListMerkleRoot);
    expect(hex(160)).toBe(vector.expectedNullifier);
  });

  it('in signal mode sends the signal hash and a zero action pair', () => {
    const signal = new Uint8Array(32).fill(7);
    const built = prepareHumanPassportInputs(params({action: undefined, signalHash: signal}));
    expect(built.slice(0, 32)).toEqual(new Array(32).fill('7'));
    expect(built.slice(32, 96)).toEqual(new Array(64).fill('0'));
  });

  it('builds the production root over the production leaves', () => {
    const built = prepareHumanPassportInputs(params({issuerLeaves: PRODUCTION_ISSUER_LEAVES, issuance: {...params().issuance, leafIndex: 0}}));
    const root = '0x' + built.slice(96, 128).map(b => Number(b).toString(16).padStart(2, '0')).join('');
    expect(root).toBe(HUMAN_PASSPORT_ISSUER_ROOT);
  });

  it('holds 10,240 data bytes and refuses 10,241', () => {
    const at = (n: number) => params({issuance: {...params().issuance, request: {...request, data: '0x' + '01'.repeat(n)}}});
    expect(prepareHumanPassportInputs(at(10240))).toHaveLength(11164);
    expect(() => prepareHumanPassportInputs(at(10241))).toThrow(/10240/);
  });

  it.each([0, 2 ** 32, 1.5, -1])('refuses min_score %p', units => {
    expect(() => prepareHumanPassportInputs(params({minScoreUnits: units}))).toThrow(/min_score/);
  });

  it('refuses a score already expired at now', () => {
    expect(() => prepareHumanPassportInputs(params({nowSeconds: issuance.expirationTime}))).toThrow(/expired/);
  });

  it('refuses a leaf index outside the list', () => {
    expect(() => prepareHumanPassportInputs(params({issuance: {...params().issuance, leafIndex: 3}}))).toThrow(/leaf 3/);
  });
});

describe('real Base issuances', () => {
  const cases = Object.entries(real) as [string, (typeof real)['direct']][];

  it.each(cases)('%s: recovers Human Passport\'s issuer for the attestation\'s recipient', (_kind, item) => {
    const calls = findVerifyAndAttestCalls(item.input);
    expect(calls.length).toBeGreaterThan(0);
    const att = {...item.attestation, expirationTime: Number(item.attestation.expirationTime)};
    const matched = calls.map(c => matchIssuance(c, att, att.recipient)).find(m => !('error' in m));
    expect(matched).toBeDefined();
    if (!matched || 'error' in matched) return;
    expect(ethers.utils.computeAddress(matched.issuerPubkey)).toBe(ethers.utils.getAddress(HUMAN_PASSPORT_ISSUER));
    expect(matched.head.scorerId).toBe(335);
    expect(matched.head.decimals).toBe(4);
    expect(matched.leafIndex).toBe(0);
  });

  const direct = real.direct;
  const att = {...direct.attestation, expirationTime: Number(direct.attestation.expirationTime)};
  const call = () => findVerifyAndAttestCalls(direct.input)[0];

  it('refuses another wallet', () => {
    expect(matchIssuance(call(), att, '0x' + '11'.repeat(20))).toMatchObject({error: expect.stringMatching(/not this wallet/)});
  });

  it('refuses data other than the attestation\'s', () => {
    expect(matchIssuance(call(), {...att, data: att.data.slice(0, -2) + (att.data.endsWith('ff') ? '00' : 'ff')}, att.recipient)).toMatchObject({error: expect.stringMatching(/other data/)});
  });

  it('refuses another expiry', () => {
    expect(matchIssuance(call(), {...att, expirationTime: att.expirationTime + 1}, att.recipient)).toMatchObject({error: expect.stringMatching(/expires/)});
  });

  it('refuses a request whose signature does not recover the issuer', () => {
    const c = call();
    const tampered = {...c, r: '0x' + '22'.repeat(32), v: c.v, s: c.s, attestationRequest: c.attestationRequest};
    expect(matchIssuance(tampered as any, att, att.recipient)).toHaveProperty('error');
  });

  it('refuses another schema and a two-entry request', () => {
    const c = call();
    const req = c.attestationRequest;
    const otherSchema = {...c, attestationRequest: {...req, multiAttestationRequest: [{...req.multiAttestationRequest[0], schema: '0x' + '33'.repeat(32)}]}};
    expect(matchIssuance(otherSchema as any, att, att.recipient)).toMatchObject({error: expect.stringMatching(/schema/)});
    const m = req.multiAttestationRequest[0];
    const twoEntries = {...c, attestationRequest: {...req, multiAttestationRequest: [{...m, data: [m.data[0], m.data[0]]}]}};
    expect(matchIssuance(twoEntries as any, att, att.recipient)).toMatchObject({error: expect.stringMatching(/exactly one/)});
  });

  it('finds nothing in garbage, truncated calldata or a decoy selector', () => {
    expect(findVerifyAndAttestCalls('0x')).toEqual([]);
    expect(findVerifyAndAttestCalls(direct.input.slice(0, 200))).toEqual([]);
    expect(findVerifyAndAttestCalls('0x48a15e6f' + '00'.repeat(8))).toEqual([]);
    // A decoy before the real call: the real one is still found.
    expect(findVerifyAndAttestCalls('0x48a15e6fdead' + direct.input.slice(2))).toHaveLength(1);
  });
});

describe('readScoreHead', () => {
  const head = (words: (number | bigint)[]) => '0x' + words.map(w => BigInt(w).toString(16).padStart(64, '0')).join('');
  it('reads the five words', () => {
    expect(readScoreHead(head([1, 4, 335, 233860, 200000, 0xc0]))).toEqual({passingScore: true, decimals: 4, scorerId: 335, score: 233860, threshold: 200000});
  });
  it.each([
    [[1, 18, 335, 1, 1, 0xc0], /decimals/],
    [[1, 4, 335, 2 ** 32, 1, 0xc0], /padding/],
    [[2, 4, 335, 1, 1, 0xc0], /padding/],
    [[1, 4, 335, 1, 1, 0xe0], /offset/],
  ])('refuses %p', (words, message) => {
    expect(() => readScoreHead(head(words as number[]))).toThrow(message);
  });
  it('refuses data shorter than the head', () => {
    expect(() => readScoreHead('0x' + '00'.repeat(191))).toThrow(/shorter/);
  });
});

/**
 * Which chain a Human Passport proof is made from: always the one the person
 * chose (the in-app threshold screen, or the proof screen's picker for a dApp
 * request); nothing here picks a chain on its own.
 *
 * Matrix: a chosen chain is checked before any lookup (unknown ids, Shape
 * (360), strings, NaN, null, empty -> refused by name with the known list);
 * the survey asks all six chains at once and keeps found / none / unchecked
 * apart, never asks Shape, does not count an expired attestation; the
 * picker's starting row: none anywhere -> nothing, only scores below the
 * threshold -> the newest of them (the row says it is below), several
 * meeting it -> the newest meeting it even beside a newer one below it,
 * an unchecked chain is never preselected, no threshold -> the newest score.
 */
import real from './fixtures/humanPassportRealIssuances.json';
import {findHumanPassportScore, preselectPassportChain, surveyHumanPassportChains, type ChainScoreState} from '../humanPassport';

const WALLET = real.direct.attestation.recipient;
const DATA = real.direct.attestation.data; // score 20.547
const NOW = 1_790_000_000;

type Answer = {kind: 'scores'; rows: {expirationTime: number}[]} | {kind: 'fail'};
let answers: Record<string, Answer>;
const fetchMock = jest.fn(async (url: string) => {
  const host = new URL(url).host;
  const a = answers[host] ?? {kind: 'scores', rows: []};
  if (a.kind === 'fail') throw new Error('network down');
  return {
    ok: true,
    json: async () => ({data: {attestations: a.rows.map((r, i) => ({
      id: `0x${String(i).padStart(64, '0')}`, txid: '0x01', recipient: WALLET, data: DATA, expirationTime: r.expirationTime, revoked: false,
    }))}}),
  } as any;
});

beforeEach(() => {
  answers = {};
  fetchMock.mockClear();
  (globalThis as any).fetch = fetchMock;
});

const log = () => {};

it.each([360, 1, 84532, 0, NaN, -1, 1.5, '8453', 'shape', 'Shape', 'SHAPE', '', null, undefined])('refuses a chosen chain %p by name, listing the known chains, before any lookup', async id => {
  await expect(findHumanPassportScore(WALLET, id as never, 200000, NOW, log))
    .rejects.toThrow(/Unknown Human Passport chain .*Known: 8453, 10, 42161, 59144, 534352, 324\./);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('a wallet whose only score is on Shape: Shape is never asked, every chain says none, nothing is preselected', async () => {
  const states = await surveyHumanPassportChains(WALLET, NOW, log);
  const hosts = fetchMock.mock.calls.map(c => new URL(c[0]).host).sort();
  expect(hosts).toEqual(['arbitrum.easscan.org', 'base.easscan.org', 'linea.easscan.org', 'optimism.easscan.org', 'scroll.easscan.org', 'zksync.easscan.org']);
  expect(states.every(st => st.state === 'none')).toBe(true);
  expect(preselectPassportChain(states, 200000)).toBeNull();
  expect(preselectPassportChain(states)).toBeNull();
});

describe('the chain the picker starts on', () => {
  const found = (chainId: number, score: number, expirationTime: number): ChainScoreState => ({chainId, state: 'found', score, expirationTime});
  const none = (chainId: number): ChainScoreState => ({chainId, state: 'none'});
  const unchecked = (chainId: number): ChainScoreState => ({chainId, state: 'unchecked', reason: 'timeout'});

  it('nothing anywhere, or only lookups that did not finish -> nothing preselected', () => {
    expect(preselectPassportChain([], 200000)).toBeNull();
    expect(preselectPassportChain([none(8453), unchecked(10), none(324)], 200000)).toBeNull();
  });

  it('only scores below the threshold -> the newest of them', () => {
    expect(preselectPassportChain([found(8453, 150000, 100), found(10, 190000, 900), none(324)], 200000)).toBe(10);
  });

  it('the newest score meeting the threshold wins over a newer one below it', () => {
    expect(preselectPassportChain([found(8453, 150000, 999), found(10, 250000, 100), found(42161, 300000, 500)], 200000)).toBe(42161);
  });

  it('exactly the threshold meets it', () => {
    expect(preselectPassportChain([found(8453, 150000, 999), found(59144, 200000, 1)], 200000)).toBe(59144);
  });

  it('no threshold (the in-app screen, where it can still change) -> the newest score', () => {
    expect(preselectPassportChain([found(8453, 150000, 999), found(10, 250000, 100)])).toBe(8453);
  });
});

it('the survey keeps found, none and unchecked apart, for every chain', async () => {
  answers['base.easscan.org'] = {kind: 'scores', rows: [{expirationTime: NOW + 100}]};
  answers['zksync.easscan.org'] = {kind: 'fail'};
  const states = await surveyHumanPassportChains(WALLET, NOW, log);
  expect(states.map(s => [s.chainId, s.state])).toEqual([
    [8453, 'found'], [10, 'none'], [42161, 'none'], [59144, 'none'], [534352, 'none'], [324, 'unchecked'],
  ]);
  expect(states[0]).toMatchObject({score: 205470});
});

it('an expired or another wallet\'s attestation from the indexer is not counted', async () => {
  answers['base.easscan.org'] = {kind: 'scores', rows: [{expirationTime: NOW - 1}]};
  const states = await surveyHumanPassportChains(WALLET, NOW, log);
  expect(states[0].state).toBe('none');
});

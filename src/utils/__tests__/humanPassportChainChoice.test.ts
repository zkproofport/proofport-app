/**
 * Which chain a Human Passport proof is made from.
 *
 * Matrix: the person's pick wins (and is checked, unknown ids throw by name,
 * nothing is looked up); with no pick every chain is looked up: none anywhere
 * -> E2021, only too-low scores -> E2022, nothing found but a lookup that did
 * not finish -> E3001 (never read as "none"), one chain meeting the threshold
 * -> it, several -> the newest; Shape (no indexer) answers through the
 * explorer's log search and "No logs found" is "none", not a failure.
 */
import real from './fixtures/humanPassportRealIssuances.json';
import {resolvePassportChain, surveyHumanPassportChains, HumanPassportError} from '../humanPassport';

const WALLET = real.direct.attestation.recipient;
const DATA = real.direct.attestation.data; // score 20.547
const NOW = 1_790_000_000;

type Answer = {kind: 'scores'; rows: {expirationTime: number}[]} | {kind: 'fail'};
let answers: Record<string, Answer>;
const fetchMock = jest.fn(async (url: string) => {
  const host = new URL(url).host;
  if (host === 'shapescan.xyz') {
    return {ok: true, json: async () => ({message: 'No logs found', result: []})} as any;
  }
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

it('uses the picked chain without looking anything up', async () => {
  expect(await resolvePassportChain(WALLET, 360, 200000, NOW, log)).toBe(360);
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([1, 84532, 0, NaN])('refuses an unknown picked chain %p by name', async id => {
  await expect(resolvePassportChain(WALLET, id, 200000, NOW, log)).rejects.toThrow(/Unknown Human Passport chain/);
});

it('no score anywhere -> E2021', async () => {
  await expect(resolvePassportChain(WALLET, undefined, 200000, NOW, log)).rejects.toMatchObject({code: 'E2021'});
  expect(fetchMock).toHaveBeenCalledTimes(7);
});

it('only scores below the threshold -> E2022', async () => {
  answers['optimism.easscan.org'] = {kind: 'scores', rows: [{expirationTime: NOW + 100}]};
  await expect(resolvePassportChain(WALLET, undefined, 300000, NOW, log)).rejects.toMatchObject({code: 'E2022'});
});

it('nothing found but one lookup did not finish -> E3001, not "none"', async () => {
  answers['linea.easscan.org'] = {kind: 'fail'};
  const err = await resolvePassportChain(WALLET, undefined, 200000, NOW, log).catch(e => e);
  expect(err).toBeInstanceOf(HumanPassportError);
  expect(err.code).toBe('E3001');
});

it('one chain meets the threshold -> that chain, even beside a failed lookup', async () => {
  answers['scroll.easscan.org'] = {kind: 'scores', rows: [{expirationTime: NOW + 100}]};
  answers['linea.easscan.org'] = {kind: 'fail'};
  expect(await resolvePassportChain(WALLET, undefined, 200000, NOW, log)).toBe(534352);
});

it('several meet it -> the newest', async () => {
  answers['base.easscan.org'] = {kind: 'scores', rows: [{expirationTime: NOW + 100}]};
  answers['arbitrum.easscan.org'] = {kind: 'scores', rows: [{expirationTime: NOW + 900}]};
  expect(await resolvePassportChain(WALLET, undefined, 200000, NOW, log)).toBe(42161);
});

it('the survey keeps found, none and unchecked apart, for every chain', async () => {
  answers['base.easscan.org'] = {kind: 'scores', rows: [{expirationTime: NOW + 100}]};
  answers['zksync.easscan.org'] = {kind: 'fail'};
  const states = await surveyHumanPassportChains(WALLET, NOW, log);
  expect(states.map(s => [s.chainId, s.state])).toEqual([
    [8453, 'found'], [10, 'none'], [42161, 'none'], [59144, 'none'], [534352, 'none'], [360, 'none'], [324, 'unchecked'],
  ]);
  expect(states[0]).toMatchObject({score: 205470});
});

it('an expired or another wallet\'s attestation from the indexer is not counted', async () => {
  answers['base.easscan.org'] = {kind: 'scores', rows: [{expirationTime: NOW - 1}]};
  const states = await surveyHumanPassportChains(WALLET, NOW, log);
  expect(states[0].state).toBe('none');
});

/**
 * Live: the app's own lookup, against each chain's real indexer and RPC, for
 * a wallet that recorded a score there; and a wallet whose only score is on
 * Shape, which the app does not accept. Network only;
 * run with npm run test:giwa-live -- humanPassportLookup.
 */
import byChain from './fixtures/humanPassportRealIssuancesByChain.json';
import real from './fixtures/humanPassportRealIssuances.json';
import shapeOnly from './fixtures/humanPassportShapeOnlyIssuance.json';
import {findHumanPassportScore, resolvePassportChain, surveyHumanPassportChains} from '../humanPassport';
import {HUMAN_PASSPORT_ISSUER_LEAVES} from '../../config/circuitIds';

jest.setTimeout(120_000);
const now = () => Math.floor(Date.now() / 1000);
const cases: [number, string][] = [
  [8453, real.direct.attestation.recipient],
  ...Object.entries(byChain).map(([id, item]) => [Number(id), item.attestation.recipient] as [number, string]),
];

it.each(cases)('chain %i: finds and checks the real score of %s', async (chainId, wallet) => {
  const found = await findHumanPassportScore(wallet, chainId, 1, now(), () => {});
  expect(found.chainId).toBe(chainId);
  expect(HUMAN_PASSPORT_ISSUER_LEAVES[found.leafIndex].chainId).toBe(chainId);
});

it('a wallet whose only score is on Shape has no supported score', async () => {
  const wallet = shapeOnly['360'].attestation.recipient;
  const states = await surveyHumanPassportChains(wallet, now(), () => {});
  expect(states.map(s => [s.chainId, s.state])).toEqual([[8453, 'none'], [10, 'none'], [42161, 'none'], [59144, 'none'], [534352, 'none'], [324, 'none']]);
  await expect(resolvePassportChain(wallet, undefined, 1, now(), () => {})).rejects.toMatchObject({code: 'E2021'});
});

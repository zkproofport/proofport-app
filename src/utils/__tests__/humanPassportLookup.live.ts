/**
 * Live: the app's own lookup, against each chain's real indexer (or Shape's
 * explorer) and RPC, for a wallet that recorded a score there. Network only;
 * run with npm run test:giwa-live -- humanPassportLookup.
 */
import byChain from './fixtures/humanPassportRealIssuancesByChain.json';
import real from './fixtures/humanPassportRealIssuances.json';
import {findHumanPassportScore, surveyHumanPassportChains} from '../humanPassport';
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

it('the survey finds the Shape wallet on Shape and nowhere it has none', async () => {
  const states = await surveyHumanPassportChains((byChain as any)['360'].attestation.recipient, now(), () => {});
  expect(states.find(s => s.chainId === 360)?.state).toBe('found');
});

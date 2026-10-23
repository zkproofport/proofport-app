/**
 * Reading History never fails on one damaged entry: the store passes it
 * through, and the History screens show it as raw text
 * (src/screens/history/historyRecordText.ts).
 */
const mockDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {getItem: async (k: string) => mockDisk.get(k) ?? null, setItem: async (k: string, v: string) => void mockDisk.set(k, v)},
}));
import {proofHistoryStore} from '../proofHistoryStore';

it('passes null, strings and arrays through and still migrates the good records', async () => {
  mockDisk.set('@zkproofport:proofHistory:items', JSON.stringify([
    null, 'text', [1], {id: 'arc', circuitId: 'arc_eligibility', status: 'verified', proofHash: '0x12'},
  ]));
  const items = await proofHistoryStore.getAll();
  expect(items.slice(0, 3)).toEqual([null, 'text', [1]]);
  expect(items[3]).toMatchObject({id: 'arc', circuitId: 'arc_eligibility', overallStatus: 'verified', source: 'manual'});
});

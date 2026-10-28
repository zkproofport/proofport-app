/**
 * publicInputCountOf asks mopro (a 3 s parse of the whole circuit on a Galaxy
 * A23) once per circuit file, and again only when the file changes.
 */
const mockDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => (mockDisk.has(k) ? mockDisk.get(k)! : null),
    setItem: async (k: string, v: string) => void mockDisk.set(k, v),
  },
}));
const mockStat = {size: 8_776_838, mtime: new Date('2026-10-29T00:00:00Z') as Date | string};
jest.mock('react-native-fs', () => ({__esModule: true, default: {stat: async () => mockStat}}));
jest.mock('mopro-ffi', () => ({getNumPublicInputsFromCircuit: () => 214}));

import {publicInputCountOf} from '../circuitPublicInputs';

const P = '/docs/circuits/oidc_domain_attestation.json';

beforeEach(() => {
  mockDisk.clear();
  mockStat.size = 8_776_838;
  mockStat.mtime = new Date('2026-10-29T00:00:00Z');
});

it('the second proof does not parse the circuit again', async () => {
  const count = jest.fn(() => 214);
  expect(await publicInputCountOf(P, count)).toBe(214);
  expect(await publicInputCountOf(P, count)).toBe(214);
  expect(count).toHaveBeenCalledTimes(1);
});

it.each([
  ['a re-downloaded file (new time)', () => (mockStat.mtime = new Date('2026-10-30T00:00:00Z'))],
  ['a file of another size', () => (mockStat.size = 6_792_586)],
])('%s is counted again', async (_l, change) => {
  const count = jest.fn(() => 214);
  await publicInputCountOf(P, count);
  change();
  await publicInputCountOf(P, count);
  expect(count).toHaveBeenCalledTimes(2);
});

it('an unreadable or damaged record is recomputed, not trusted', async () => {
  const count = jest.fn(() => 214);
  await publicInputCountOf(P, count);
  const key = [...mockDisk.keys()][0];
  for (const bad of ['not json', '{"stamp":"8776838:1761696000000","count":-1}', '{"stamp":"x","count":214}']) {
    mockDisk.set(key, bad);
    await publicInputCountOf(P, count);
  }
  expect(count).toHaveBeenCalledTimes(4);
});

it('a file with no readable time is counted every time, never cached', async () => {
  mockStat.mtime = 'not a date';
  const count = jest.fn(() => 214);
  await publicInputCountOf(P, count);
  await publicInputCountOf(P, count);
  expect(count).toHaveBeenCalledTimes(2);
  expect(mockDisk.size).toBe(0);
});

it('a count that throws propagates and caches nothing', async () => {
  await expect(publicInputCountOf(P, () => { throw new Error('bad circuit'); })).rejects.toThrow('bad circuit');
  expect(mockDisk.size).toBe(0);
});

/**
 * The History store keeps a proof log only scrubbed and within its caps, and
 * two screens writing the same record at once do not lose each other's fields.
 *
 * MATRIX rows held here: hostile (a raw token passed to `update` is stored
 * scrubbed), boundary/large (per-record cap, total cap across records),
 * empty (empty / non-string log stores nothing), race (concurrent updates are
 * serialized), integrity (export leaves logs out; damaged entries survive and
 * do not block a removal), external failure (a failed write rejects and the
 * next write still runs).
 */
const mockDisk = new Map<string, string>();
let mockFailNextWrite = false;
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => {
      await new Promise(resolve => setTimeout(resolve, 1));
      return mockDisk.get(k) ?? null;
    },
    setItem: async (k: string, v: string) => {
      await new Promise(resolve => setTimeout(resolve, 1));
      if (mockFailNextWrite) {
        mockFailNextWrite = false;
        throw new Error('disk full');
      }
      mockDisk.set(k, v);
    },
    removeItem: async (k: string) => void mockDisk.delete(k),
  },
}));
import {proofHistoryStore, type ProofHistoryItem} from '../proofHistoryStore';
import {PROOF_LOG_LIMITS} from '../../utils/proofLog';

const KEY = '@zkproofport:proofHistory:items';
const JWT = `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from('{"nonce":"n"}').toString('base64url')}.${'s'.repeat(80)}`;
const stored = (): Record<string, unknown>[] => JSON.parse(mockDisk.get(KEY)!);
const base = (id: string): Partial<ProofHistoryItem> => ({
  id, circuitId: 'coinbase_attestation', circuitName: 'x', proofHash: '', timestamp: '2026-10-27T00:00:00Z',
  network: 'Base', walletAddress: '', offChainStatus: 'pending', onChainStatus: 'pending', overallStatus: 'started',
});

let errors: jest.SpyInstance;
beforeEach(() => {
  mockDisk.clear();
  mockFailNextWrite = false;
  errors = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errors.mockRestore());

it('stores a log scrubbed, whoever passes it in raw', async () => {
  mockDisk.set(KEY, JSON.stringify([base('a')]));
  await proofHistoryStore.update('a', {log: `[OIDC] token=${JWT}\nnonce abc`});
  expect(stored()[0].log).toBe(`[OIDC] token=[redacted jwt, ${JWT.length} chars]\nnonce abc`);
});

it('caps one record at the per-record limit', async () => {
  mockDisk.set(KEY, JSON.stringify([base('a')]));
  await proofHistoryStore.update('a', {log: 'z'.repeat(PROOF_LOG_LIMITS.perRecordChars * 3)});
  expect((stored()[0].log as string).length).toBeLessThanOrEqual(PROOF_LOG_LIMITS.perRecordChars);
});

it.each([['empty', ''], ['whitespace', '  \n '], ['a number', 5 as unknown as string], ['undefined', undefined]])(
  'a %s log stores no log field and still applies the other fields', async (_name, log) => {
    mockDisk.set(KEY, JSON.stringify([{...base('a'), log: 'earlier'}]));
    await proofHistoryStore.update('a', {overallStatus: 'failed', log});
    expect(stored()[0].overallStatus).toBe('failed');
    // The earlier log is untouched: an empty value is "nothing to write", not "erase".
    expect(stored()[0].log).toBe('earlier');
  },
);

it('keeps the total of all logs under the budget, dropping the oldest logs, never records', async () => {
  const per = PROOF_LOG_LIMITS.perRecordChars;
  const count = Math.ceil(PROOF_LOG_LIMITS.totalChars / per) + 3;
  // Newest first, as `add` stores them.
  mockDisk.set(KEY, JSON.stringify(Array.from({length: count}, (_, i) => base(`r${i}`))));
  for (let i = count - 1; i >= 0; i--) {
    await proofHistoryStore.update(`r${i}`, {log: String(i % 10).repeat(per)});
  }
  const items = stored();
  expect(items).toHaveLength(count);
  const total = items.reduce((sum, item) => sum + (typeof item.log === 'string' ? item.log.length : 0), 0);
  expect(total).toBeLessThanOrEqual(PROOF_LOG_LIMITS.totalChars);
  expect(items[0].log).toBeDefined();
  expect(items[count - 1].log).toBeUndefined();
  expect(items[count - 1].id).toBe(`r${count - 1}`);
});

it('two writers at once lose neither write', async () => {
  mockDisk.set(KEY, JSON.stringify([base('a')]));
  await Promise.all([
    proofHistoryStore.update('a', {proofHash: '0xproof', overallStatus: 'generated', log: 'generation'}),
    proofHistoryStore.update('a', {offChainStatus: 'verified'}),
    proofHistoryStore.update('a', {onChainStatus: 'verified'}),
  ]);
  expect(stored()[0]).toMatchObject({proofHash: '0xproof', offChainStatus: 'verified', onChainStatus: 'verified', log: 'generation'});
});

it('a failed write rejects and the next one still runs', async () => {
  mockDisk.set(KEY, JSON.stringify([base('a')]));
  mockFailNextWrite = true;
  await expect(proofHistoryStore.update('a', {log: 'lost'})).rejects.toThrow('disk full');
  await proofHistoryStore.update('a', {log: 'kept'});
  expect(stored()[0].log).toBe('kept');
});

it('an update next to damaged entries works and leaves them alone', async () => {
  mockDisk.set(KEY, JSON.stringify([null, 'text', base('a')]));
  await proofHistoryStore.update('a', {log: 'line'});
  expect(stored()).toEqual([null, 'text', expect.objectContaining({id: 'a', log: 'line'})]);
});

it('removing a record works when the list holds a damaged entry', async () => {
  mockDisk.set(KEY, JSON.stringify([null, base('a'), base('b')]));
  await proofHistoryStore.remove('a');
  expect(stored().map(item => (item === null ? null : item.id))).toEqual([null, 'b']);
});

it('the history export leaves every log out', async () => {
  mockDisk.set(KEY, JSON.stringify([{...base('a'), log: 'secret-free but personal'}, base('b'), null]));
  const exported = JSON.parse(await proofHistoryStore.exportToJSON());
  expect(exported[0]).not.toHaveProperty('log');
  expect(exported[0].id).toBe('a');
  expect(exported[1].id).toBe('b');
  expect(exported[2]).toBeNull();
});

it('an older record without a log still reads exactly as before', async () => {
  mockDisk.set(KEY, JSON.stringify([base('old')]));
  const [item] = await proofHistoryStore.getAll();
  expect(item).not.toHaveProperty('log');
});

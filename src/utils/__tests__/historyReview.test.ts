import {captureHistoryReview, HISTORY_REVIEW_LIMIT} from '../historyReview';
import {historyStatus, formatHistoryDate, historyMonth} from '../historyPresentation';
import {proofHistoryStore} from '../../stores/proofHistoryStore';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () => ({__esModule: true, default: {getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn()}}));

describe('stored proof request review', () => {
  it('keeps exact typed action fields and detaches them from the active request', () => {
    const action = {primaryType: 'Access', domain: {name: 'Forum', chainId: 91342}, types: {Access: [{name: 'topic', type: 'string'}]}, message: {topic: '한국어 "topic" %_ <script>', allow: false, limit: '9007199254740993', tags: [], extra: {zero: 0, empty: '', absent: null}}};
    const snapshot = captureHistoryReview({scope: 'forum', countryList: ['KR'], isIncluded: false, action});
    expect(snapshot).toEqual({version: 1, inputs: {scope: 'forum', countryList: ['KR'], isIncluded: false}, action});
    action.message.topic = 'changed';
    expect((snapshot?.action as typeof action).message.topic).toBe('한국어 "topic" %_ <script>');
  });
  it('saves only reviewable proof conditions, never credentials or raw authentication data', () => {
    const result = captureHistoryReview({domain: 'masselabs.com', provider: 'google', jwt: 'token', idToken: 'token', rawTransaction: 'secret', expectedName: 'person', expectedBirth: 'birth', metadata: {secret: true}, unknown: 'not a supported predicate'});
    expect(result).toEqual({version: 1, inputs: {domain: 'masselabs.com', provider: 'google'}});
  });
  it('retains no inferred predicates for empty inputs and preserves distinct scalar values', () => {
    expect(captureHistoryReview({})).toEqual({version: 1, inputs: {}});
    expect(captureHistoryReview({ageThreshold: 0, currentYear: null, targetRegion: '', isIncluded: false})?.inputs)
      .toEqual({ageThreshold: 0, currentYear: null, targetRegion: '', isIncluded: false});
    expect(captureHistoryReview(null)).toBeUndefined();
    expect(captureHistoryReview(undefined)).toBeUndefined();
  });
  it('retains every arbitrary nested action key without prototype pollution', () => {
    const action = JSON.parse('{"primaryType":"Grant","message":{"__proto__":{"allow":true},"constructor":"x","permissions":["read","write"]},"domain":{},"types":{}}');
    const result = captureHistoryReview({action});
    expect(result?.action).toEqual(action);
    expect(({} as any).allow).toBeUndefined();
  });
  it('declines oversized or unserializable snapshots without failing proof generation', () => {
    const cyclic: any = {}; cyclic.self = cyclic;
    expect(captureHistoryReview({action: cyclic})).toBeUndefined();
    expect(captureHistoryReview({scope: 'x'.repeat(HISTORY_REVIEW_LIMIT)})).toBeUndefined();
    expect(captureHistoryReview({scope: 'x'.repeat(HISTORY_REVIEW_LIMIT * 2)})).toBeUndefined();
    expect(captureHistoryReview({ageThreshold: Infinity})).toBeUndefined();
    expect(captureHistoryReview({action: {message: {big: 1n}}})).toBeUndefined();
    expect(captureHistoryReview({action: {message: {value: undefined}}})).toBeUndefined();
    let deep: any = {}; for (let i = 0; i < 40; i++) deep = {nested: deep};
    expect(captureHistoryReview({action: deep})).toBeUndefined();
  });
});

describe('history result labels and dates', () => {
  it.each(['started', 'generating', 'pending', 'generated', 'verified', 'failed', 'verified_failed'])('preserves status %s', status => {
    expect(historyStatus(status).labelKey).toBe(`host.history.states.${status}`);
  });
  it('never downgrades verified or labels a verification failure as generation failure', () => {
    expect(historyStatus('verified').tone).toBe('green');
    expect(historyStatus('generated').tone).toBe('blue');
    expect(historyStatus('verified_failed').labelKey).not.toBe(historyStatus('failed').labelKey);
    expect(() => historyStatus('invented')).toThrow('invented');
    expect(() => historyStatus('__proto__')).toThrow('__proto__');
  });
  it.each([null, undefined, false, true, 0, 1, [], {}, '', ' '])('does not coerce a malformed legacy timestamp %p into a date', value => {
    expect(formatHistoryDate(value as never, 'en')).toBe('Date unavailable');
    expect(historyMonth(value as never, 'ko')).toBe('날짜 정보 없음');
  });
  it('formats Korean and English dates and handles invalid legacy dates', () => {
    const date = '2026-09-23T01:00:00Z';
    expect(formatHistoryDate(date, 'ko')).toContain('2026');
    expect(historyMonth(date, 'ko')).toContain('9월');
    expect(historyMonth(date, 'en')).toContain('September');
    expect(formatHistoryDate('bad', 'ko')).toBe('날짜 정보 없음');
    expect(historyMonth('bad', 'en')).toBe('Date unavailable');
    expect(() => historyMonth(date, 'xx')).toThrow('xx');
  });
});

describe('history storage failures and compatibility', () => {
  beforeEach(() => jest.clearAllMocks());
  it('keeps legacy history without fabricating request contents', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify([{id: 'old', status: 'verified', proofHash: '0x12'}]));
    const [item] = await proofHistoryStore.getAll();
    expect(item.overallStatus).toBe('verified');
    expect(item.review).toBeUndefined();
  });
  it('propagates storage read errors so UI can retry instead of showing no records', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('storage unavailable'));
    await expect(proofHistoryStore.getAll()).rejects.toThrow('storage unavailable');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
  it('does not overwrite unreadable stored data while adding a record', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('broken json');
    await expect(proofHistoryStore.add({} as any)).rejects.toThrow();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});

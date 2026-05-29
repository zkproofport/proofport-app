import {
  cacheNeedsInvalidation,
  StoredCircuitVersion,
} from '../cacheInvalidation';

const URL_A = 'https://raw.githubusercontent.com/org/circuits/main';
const URL_B = 'https://raw.githubusercontent.com/org/circuits/v2.0.0';

function stored(
  partial: Partial<StoredCircuitVersion> = {},
): StoredCircuitVersion {
  return {baseUrl: URL_A, downloadedAt: 1, dataVersion: 6, ...partial};
}

describe('cacheNeedsInvalidation', () => {
  // Regression #1: the original bug returned `false` here, so a stale circuit
  // already on disk (downloaded before version metadata existed) was reused
  // forever and could only be cleared by reinstalling the app.
  it('invalidates when there is no metadata but files are cached', () => {
    expect(
      cacheNeedsInvalidation({
        stored: null,
        expectedVersion: 6,
        currentBaseUrl: URL_A,
        hasCachedFiles: true,
      }),
    ).toBe(true);
  });

  it('does not invalidate when there is no metadata and nothing is cached', () => {
    expect(
      cacheNeedsInvalidation({
        stored: null,
        expectedVersion: 6,
        currentBaseUrl: URL_A,
        hasCachedFiles: false,
      }),
    ).toBe(false);
  });

  // Regression #2: a CIRCUIT_DATA_VERSIONS bump (e.g. v5 -> v6) must self-heal
  // without a reinstall.
  it('invalidates when the stored data version differs from expected', () => {
    expect(
      cacheNeedsInvalidation({
        stored: stored({dataVersion: 5}),
        expectedVersion: 6,
        currentBaseUrl: URL_A,
        hasCachedFiles: true,
      }),
    ).toBe(true);
  });

  it('does not invalidate when version and base URL both match', () => {
    expect(
      cacheNeedsInvalidation({
        stored: stored({dataVersion: 6, baseUrl: URL_A}),
        expectedVersion: 6,
        currentBaseUrl: URL_A,
        hasCachedFiles: true,
      }),
    ).toBe(false);
  });

  it('invalidates when the base URL changed (source moved)', () => {
    expect(
      cacheNeedsInvalidation({
        stored: stored({dataVersion: 6, baseUrl: URL_A}),
        expectedVersion: 6,
        currentBaseUrl: URL_B,
        hasCachedFiles: true,
      }),
    ).toBe(true);
  });

  it('treats missing stored.dataVersion as 0', () => {
    expect(
      cacheNeedsInvalidation({
        stored: {baseUrl: URL_A, downloadedAt: 1},
        expectedVersion: 6,
        currentBaseUrl: URL_A,
        hasCachedFiles: true,
      }),
    ).toBe(true);

    // version 0 expected + no stored version + same URL -> still valid
    expect(
      cacheNeedsInvalidation({
        stored: {baseUrl: URL_A, downloadedAt: 1},
        expectedVersion: 0,
        currentBaseUrl: URL_A,
        hasCachedFiles: true,
      }),
    ).toBe(false);
  });
});

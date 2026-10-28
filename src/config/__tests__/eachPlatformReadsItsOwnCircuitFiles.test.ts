/**
 * Coinbase KYC v2 and the OIDC domain proof are each two circuits under one
 * id: the iPhone package (App Attest) and the Android package (Android key
 * attestation). The phone's platform picks the row; a platform or variant the
 * table does not hold is an error naming it, never the other platform's
 * files. Every other circuit never asks the platform at all.
 */
const mockDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => (mockDisk.has(k) ? mockDisk.get(k)! : null),
    setItem: async (k: string, v: string) => void mockDisk.set(k, v),
    removeItem: async (k: string) => void mockDisk.delete(k),
  },
}));
const mockDownloads: string[] = [];
jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    DocumentDirectoryPath: '/tmp/documents',
    MainBundlePath: '/tmp/bundle',
    exists: async () => false,
    mkdir: async () => {},
    unlink: async () => {},
    stat: async () => ({size: 10}),
    hash: async () => 'ff',
    stopDownload: () => {},
    downloadFile: (o: {fromUrl: string}) => {
      mockDownloads.push(o.fromUrl);
      return {jobId: 1, promise: Promise.resolve({statusCode: 200, bytesWritten: 10})};
    },
  },
}));
const mockPlatform = {OS: 'ios'};
jest.mock('react-native', () => ({NativeModules: {}, Platform: mockPlatform}));

import {
  ANDROID_SIGNATURE_CIRCUITS_REF,
  artifactSourceFor,
  circuitArtifactSource,
  coinbaseKycArtifact,
  hasPinnedArtifactSource,
  requireArtifactRef,
  SRS_2_21_BYTES,
  SRS_PART_MAX_BYTES,
} from '../circuitArtifacts';
import {signerVariantFor} from '../signerPlatform';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {circuitBaseUrl, circuitDataVersion, downloadCircuitFiles} = require('../../utils/circuitDownload');

beforeEach(() => {
  mockPlatform.OS = 'ios';
  mockDownloads.length = 0;
  mockDisk.clear();
  (globalThis as {fetch?: unknown}).fetch = jest.fn(async () => ({ok: false, status: 404, text: async () => ''}));
});

describe('the platform', () => {
  it('maps ios and android, and nothing else', () => {
    expect(signerVariantFor('ios')).toBe('app_attest');
    expect(signerVariantFor('android')).toBe('android');
    for (const os of ['web', 'windows', 'macos', '', '__proto__', 'constructor']) {
      expect(() => signerVariantFor(os)).toThrow(`No statement signer for platform '${os}'. Known: ios, android.`);
    }
  });
});

describe.each(['coinbase_attestation', 'oidc_domain_attestation'] as const)('%s', id => {
  it('has a row for each platform: the iPhone package, and the Android package with a split .srs', () => {
    const ios = artifactSourceFor(id, 'app_attest')!;
    const android = artifactSourceFor(id, 'android')!;
    expect(ios.variant).toBe('app_attest');
    expect(android.variant).toBe('android');
    expect(ios.srsParts).toBeNull();
    expect(android.remoteFileName).toBe(`${ios.remoteFileName}_android`);
    expect(android.basePath).toBe(ios.basePath.replace('/target', '-android/target'));
    expect(android.vkPath).toBe(`${android.basePath}/vk`);
    // Same public inputs; a different file set, so a different cache version.
    expect(android.publicInputCount).toBe(ios.publicInputCount);
    expect(android.dataVersion).not.toBe(ios.dataVersion);
    // ceil(134,217,940 / 64 MiB) = 3: every part at most 64 MiB.
    expect(android.srsParts).toBe(3);
    expect(SRS_2_21_BYTES / android.srsParts!).toBeLessThanOrEqual(SRS_PART_MAX_BYTES);
    expect(android.ref).toBe(ANDROID_SIGNATURE_CIRCUITS_REF);
    expect(android.refName).toBe('ANDROID_SIGNATURE_CIRCUITS_REF');
  });

  it("this phone's platform picks the row", () => {
    mockPlatform.OS = 'ios';
    expect(circuitArtifactSource(id)?.variant).toBe('app_attest');
    mockPlatform.OS = 'android';
    expect(circuitArtifactSource(id)?.variant).toBe('android');
    expect(circuitDataVersion(id)).toBe(artifactSourceFor(id, 'android')!.dataVersion);
    mockPlatform.OS = 'ios';
    expect(circuitDataVersion(id)).toBe(artifactSourceFor(id, 'app_attest')!.dataVersion);
  });

  it('an unknown platform or variant throws, naming it', () => {
    mockPlatform.OS = 'web';
    expect(() => circuitArtifactSource(id)).toThrow("No statement signer for platform 'web'");
    expect(() => artifactSourceFor(id, 'windows')).toThrow(`${id} has no circuit files for statement signer 'windows'. Known: app_attest, android.`);
    expect(() => artifactSourceFor(id, '__proto__')).toThrow(/no circuit files for statement signer '__proto__'/);
  });
});

describe('the Android circuits ref', () => {
  it('is a full 40-hex commit or not set yet -- never a branch or a tag', () => {
    expect(ANDROID_SIGNATURE_CIRCUITS_REF === '' || /^[0-9a-f]{40}$/.test(ANDROID_SIGNATURE_CIRCUITS_REF)).toBe(true);
  });

  it('refuses a branch name or a short sha on an Android row, naming the constant', () => {
    const row = artifactSourceFor('coinbase_attestation', 'android')!;
    expect(() => requireArtifactRef({...row, ref: 'android-signature'})).toThrow(/ANDROID_SIGNATURE_CIRCUITS_REF is 'android-signature': set it to the 40-hex/);
    expect(() => requireArtifactRef({...row, ref: 'abcdef1'})).toThrow(/ANDROID_SIGNATURE_CIRCUITS_REF is 'abcdef1'/);
    expect(() => requireArtifactRef({...row, ref: ''})).toThrow(/ANDROID_SIGNATURE_CIRCUITS_REF is empty/);
    expect(requireArtifactRef({...row, ref: 'ab'.repeat(20)})).toBe('ab'.repeat(20));
  });

  (ANDROID_SIGNATURE_CIRCUITS_REF === '' ? it : it.skip)('while empty, an Android download fails naming it and fetches nothing', async () => {
    mockPlatform.OS = 'android';
    await expect(circuitBaseUrl('coinbase_attestation', 'production')).rejects.toThrow(/ANDROID_SIGNATURE_CIRCUITS_REF is empty/);
    await expect(downloadCircuitFiles('oidc_domain_attestation', 'staging', undefined, () => {})).rejects.toThrow(/ANDROID_SIGNATURE_CIRCUITS_REF is empty/);
    expect(mockDownloads).toEqual([]);
  });
});

describe('every other circuit', () => {
  it('never asks the platform', async () => {
    mockPlatform.OS = 'web'; // would throw if read
    for (const id of ['coinbase_country_attestation', 'giwa_attestation', 'no_such_circuit', '__proto__']) {
      expect(hasPinnedArtifactSource(id)).toBe(false);
      expect(circuitArtifactSource(id)).toBeUndefined();
    }
    await downloadCircuitFiles('giwa_attestation', 'development', undefined, () => {});
    expect(mockDownloads[0]).toBe('https://raw.githubusercontent.com/zkproofport/circuits/main/giwa-attestation/target/giwa_attestation.json');
  });
});

describe('coinbaseKycArtifact', () => {
  it("is this phone's row, or the variant asked for", () => {
    mockPlatform.OS = 'android';
    expect(coinbaseKycArtifact().remoteFileName).toBe('coinbase_attestation_v2_android');
    expect(coinbaseKycArtifact('app_attest').remoteFileName).toBe('coinbase_attestation_v2');
  });
});

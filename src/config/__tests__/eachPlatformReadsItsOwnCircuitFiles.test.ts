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
  OPRF_CIRCUITS_REF,
  __setOprfCircuitsRefForTests,
  artifactSourceFor,
  circuitArtifactSource,
  circuitFilesDecidableNow,
  coinbaseKycArtifact,
  hasPinnedArtifactSource,
  requireArtifactRef,
  SRS_2_21_BYTES,
  SRS_PART_MAX_BYTES,
} from '../circuitArtifacts';
import {
  __setAndroidChainKindForTests,
  knownAndroidChainKind,
  loadAndroidChainKind,
  rememberAndroidChainKind,
  signerPlatformFor,
  signerVariantFor,
  wireSignerVariant,
} from '../signerPlatform';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {circuitBaseUrl, circuitDataVersion, downloadCircuitFiles} = require('../../utils/circuitDownload');

beforeEach(() => {
  mockPlatform.OS = 'ios';
  __setAndroidChainKindForTests(null);
  mockDownloads.length = 0;
  mockDisk.clear();
  (globalThis as {fetch?: unknown}).fetch = jest.fn(async () => ({ok: false, status: 404, text: async () => ''}));
});

describe('the platform and the Android chain kind', () => {
  it('knows ios and android, and nothing else', () => {
    expect(signerPlatformFor('ios')).toBe('ios');
    expect(signerPlatformFor('android')).toBe('android');
    for (const os of ['web', 'windows', 'macos', '', '__proto__', 'constructor']) {
      expect(() => signerPlatformFor(os)).toThrow(`No statement signer for platform '${os}'. Known: ios, android.`);
    }
  });

  it('iPhone is app_attest; Android is its chain kind, and an unknown kind is an error, never a default', () => {
    expect(signerVariantFor('ios', null)).toBe('app_attest');
    expect(signerVariantFor('android', 'android')).toBe('android');
    expect(signerVariantFor('android', 'android_factory')).toBe('android_factory');
    expect(() => signerVariantFor('android', null)).toThrow(/attestation chain kind is not known yet/);
    expect(() => signerVariantFor('android', 'windows' as never)).toThrow(/Not an Android chain kind: 'windows'/);
  });

  it('maps each variant to the wire name the relay and core take', () => {
    expect(['app_attest', 'android', 'android_factory'].map(wireSignerVariant)).toEqual(['standard', 'android', 'android_factory']);
    expect(() => wireSignerVariant('rkp')).toThrow("No wire signer variant for 'rkp'. Known: app_attest, android, android_factory.");
    expect(() => wireSignerVariant('__proto__')).toThrow(/No wire signer variant/);
  });

  it('keeps the chain kind on the phone and reads it back; a damaged value stays unknown', async () => {
    await rememberAndroidChainKind('android_factory');
    __setAndroidChainKindForTests(null);
    expect(await loadAndroidChainKind()).toBe('android_factory');
    mockDisk.set('@zkproofport:androidChainKind:v1', 'android_rkp');
    expect(await loadAndroidChainKind()).toBeNull();
    expect(knownAndroidChainKind()).toBeNull();
    await expect(rememberAndroidChainKind('factory' as never)).rejects.toThrow(/Not an Android chain kind: 'factory'/);
  });
});

// Coinbase KYC's Android rows read OPRF_CIRCUITS_REF since the OPRF nullifier
// (one commit for every OPRF circuit, empty until it is pushed); OIDC's keep
// ANDROID_SIGNATURE_CIRCUITS_REF.
const ANDROID_REF = {coinbase_attestation: ['OPRF_CIRCUITS_REF', OPRF_CIRCUITS_REF], oidc_domain_attestation: ['ANDROID_SIGNATURE_CIRCUITS_REF', ANDROID_SIGNATURE_CIRCUITS_REF]} as const;

describe.each(['coinbase_attestation', 'oidc_domain_attestation'] as const)('%s', id => {
  it('has a row for each signer: the iPhone package, and two Android packages with a split .srs', () => {
    const ios = artifactSourceFor(id, 'app_attest')!;
    const android = artifactSourceFor(id, 'android')!;
    const factory = artifactSourceFor(id, 'android_factory')!;
    expect(factory.variant).toBe('android_factory');
    expect(factory.remoteFileName).toBe(`${ios.remoteFileName}_android_factory`);
    expect(factory.basePath).toBe(ios.basePath.replace('/target', '-android-factory/target'));
    expect(factory.publicInputCount).toBe(ios.publicInputCount);
    expect(new Set([ios.dataVersion, android.dataVersion, factory.dataVersion]).size).toBe(3);
    expect(factory.srsParts).toBe(3);
    expect(factory.ref).toBe(ANDROID_REF[id][1]);
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
    expect(android.ref).toBe(ANDROID_REF[id][1]);
    expect(android.refName).toBe(ANDROID_REF[id][0]);
  });

  it("this phone's platform and chain kind pick the row", () => {
    mockPlatform.OS = 'ios';
    expect(circuitArtifactSource(id)?.variant).toBe('app_attest');
    mockPlatform.OS = 'android';
    expect(() => circuitArtifactSource(id)).toThrow(/attestation chain kind is not known yet/);
    expect(circuitFilesDecidableNow(id)).toBe(false);
    __setAndroidChainKindForTests('android_factory');
    expect(circuitFilesDecidableNow(id)).toBe(true);
    expect(circuitArtifactSource(id)?.variant).toBe('android_factory');
    expect(circuitDataVersion(id)).toBe(artifactSourceFor(id, 'android_factory')!.dataVersion);
    __setAndroidChainKindForTests('android');
    expect(circuitArtifactSource(id)?.variant).toBe('android');
    expect(circuitDataVersion(id)).toBe(artifactSourceFor(id, 'android')!.dataVersion);
    mockPlatform.OS = 'ios';
    expect(circuitDataVersion(id)).toBe(artifactSourceFor(id, 'app_attest')!.dataVersion);
  });

  it('an unknown platform or variant throws, naming it', () => {
    mockPlatform.OS = 'web';
    expect(() => circuitArtifactSource(id)).toThrow("No statement signer for platform 'web'");
    expect(() => artifactSourceFor(id, 'windows')).toThrow(`${id} has no circuit files for statement signer 'windows'. Known: app_attest, android, android_factory.`);
    expect(() => artifactSourceFor(id, '__proto__')).toThrow(/no circuit files for statement signer '__proto__'/);
  });
});

describe('the OPRF circuits ref', () => {
  it('is a full 40-hex commit, and every Android Coinbase KYC download is read from it', async () => {
    expect(OPRF_CIRCUITS_REF).toMatch(/^[0-9a-f]{40}$/);
    for (const kind of ['android', 'android_factory'] as const) {
      mockPlatform.OS = 'android';
      __setAndroidChainKindForTests(kind);
      await expect(circuitBaseUrl('coinbase_attestation', 'staging')).resolves.toBe(`https://raw.githubusercontent.com/zkproofport/circuits/${OPRF_CIRCUITS_REF}`);
    }
  });

  it('when empty, every Android Coinbase KYC download ends at an error naming it', async () => {
    __setOprfCircuitsRefForTests('');
    try {
      for (const kind of ['android', 'android_factory'] as const) {
        mockPlatform.OS = 'android';
        __setAndroidChainKindForTests(kind);
        await expect(circuitBaseUrl('coinbase_attestation', 'staging')).rejects.toThrow(/OPRF_CIRCUITS_REF is empty/);
      }
    } finally {
      __setOprfCircuitsRefForTests(null);
    }
  });
});

describe('the Android circuits ref', () => {
  it('is a full 40-hex commit -- never a branch, a tag or empty', () => {
    expect(ANDROID_SIGNATURE_CIRCUITS_REF).toMatch(/^[0-9a-f]{40}$/);
  });

  it.each(['android', 'android_factory'])('refuses a branch name or a short sha on an %s row, naming the constant', variant => {
    const row = artifactSourceFor('oidc_domain_attestation', variant)!;
    expect(() => requireArtifactRef({...row, ref: 'android-signature'})).toThrow(/ANDROID_SIGNATURE_CIRCUITS_REF is 'android-signature': set it to the 40-hex/);
    expect(() => requireArtifactRef({...row, ref: 'abcdef1'})).toThrow(/ANDROID_SIGNATURE_CIRCUITS_REF is 'abcdef1'/);
    expect(() => requireArtifactRef({...row, ref: ''})).toThrow(/ANDROID_SIGNATURE_CIRCUITS_REF is empty/);
    expect(requireArtifactRef({...row, ref: 'ab'.repeat(20)})).toBe('ab'.repeat(20));
  });

  it.each([
    ['android', 'oidc_domain_attestation', 'oidc-domain-attestation-android/target/oidc_domain_attestation_android'],
    ['android_factory', 'oidc_domain_attestation', 'oidc-domain-attestation-android-factory/target/oidc_domain_attestation_android_factory'],
  ] as const)('an %s phone reads %s from the filled commit, under its own package', async (kind, id, file) => {
    const RAW = `https://raw.githubusercontent.com/zkproofport/circuits/${ANDROID_SIGNATURE_CIRCUITS_REF}`;
    mockPlatform.OS = 'android';
    __setAndroidChainKindForTests(kind);
    for (const env of ['development', 'staging', 'production'] as const) {
      expect(await circuitBaseUrl(id, env)).toBe(RAW);
    }
    // The .srs is joined from parts only against a published SHA256SUMS; the
    // fetch mock has none, so the download stops there -- after the json was
    // requested from the right place.
    await expect(downloadCircuitFiles(id, 'staging', undefined, () => {})).rejects.toThrow(/No SHA256SUMS at .*: a \.srs published in parts is never joined unchecked/);
    expect(mockDownloads[0]).toBe(`${RAW}/${file}.json`);
  });
});

describe('every other circuit', () => {
  it('never asks the platform', async () => {
    mockPlatform.OS = 'web'; // would throw if read
    // The Laboratory circuits have one signer-independent row (OPRF_CIRCUITS_REF since the OPRF nullifier).
    for (const id of ['giwa_attestation', 'dojang_playground']) {
      expect(hasPinnedArtifactSource(id)).toBe(true);
      expect(circuitArtifactSource(id)?.refName).toBe('OPRF_CIRCUITS_REF');
      expect(circuitFilesDecidableNow(id)).toBe(true);
    }
    for (const id of ['no_such_circuit', '__proto__']) {
      expect(hasPinnedArtifactSource(id)).toBe(false);
      expect(circuitArtifactSource(id)).toBeUndefined();
      expect(circuitFilesDecidableNow(id)).toBe(true);
    }
    // Signer-independent: the download goes to the OPRF ref without reading
    // the platform (which is 'web' here and would throw if asked).
    await downloadCircuitFiles('giwa_attestation', 'development', undefined, () => {});
    expect(mockDownloads[0]).toBe(`https://raw.githubusercontent.com/zkproofport/circuits/${OPRF_CIRCUITS_REF}/giwa-attestation/target/giwa_attestation.json`);
  });
});

describe('coinbaseKycArtifact', () => {
  it("is this phone's row, or the variant asked for", () => {
    mockPlatform.OS = 'android';
    __setAndroidChainKindForTests('android');
    expect(coinbaseKycArtifact().remoteFileName).toBe('coinbase_attestation_v2_android');
    expect(coinbaseKycArtifact('android_factory').remoteFileName).toBe('coinbase_attestation_v2_android_factory');
    expect(coinbaseKycArtifact('app_attest').remoteFileName).toBe('coinbase_attestation_v2');
  });
});

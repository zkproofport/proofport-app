/**
 * Which device signer vouches for a statement on this phone. One table per
 * question, and an unknown value is an error.
 *
 *   app_attest       iPhone: Apple App Attest (src/appAttest/*), the iOS circuits
 *   android          Android, Remote Key Provisioning chain under Key
 *                    Attestation CA1 (src/androidAttest/*), the `*-android`
 *                    packages
 *   android_factory  Android, factory-provisioned chain under Google's RSA root
 *                    (devices launched with Android 12 or earlier), plus a Play
 *                    Integrity verdict, the `*-android-factory` packages
 *
 * All three prove the same public inputs with different circuits, so the
 * variant decides the circuit files, the input layout and the verifier. On
 * Android it is a property of the phone's attestation chain, which only a
 * generated key reveals: it is learned once (androidChainKind.ts), kept, and
 * read from here. Never guessed from what a file or a witness looks like.
 */

export type StatementSignerVariant = 'app_attest' | 'android' | 'android_factory';
export type AndroidChainKind = Extract<StatementSignerVariant, 'android' | 'android_factory'>;
export type SignerPlatform = 'ios' | 'android';

export const STATEMENT_SIGNER_VARIANTS: readonly StatementSignerVariant[] = Object.freeze([
  'app_attest',
  'android',
  'android_factory',
]);

/**
 * What the proof callback calls each variant (`signerVariant`, accepted by the
 * relay and by @zkproofport-app/core): `standard` is every circuit that is not
 * an Android package -- the iPhone's and the AI server's.
 */
export const WIRE_SIGNER_VARIANT: Readonly<Record<StatementSignerVariant, 'standard' | 'android' | 'android_factory'>> =
  Object.freeze({app_attest: 'standard', android: 'android', android_factory: 'android_factory'});

export type WireSignerVariant = (typeof WIRE_SIGNER_VARIANT)[StatementSignerVariant];

/** The wire name for a variant. Own keys only. */
export function wireSignerVariant(variant: string): WireSignerVariant {
  if (!Object.prototype.hasOwnProperty.call(WIRE_SIGNER_VARIANT, variant)) {
    throw new Error(`No wire signer variant for '${variant}'. Known: ${Object.keys(WIRE_SIGNER_VARIANT).join(', ')}.`);
  }
  return WIRE_SIGNER_VARIANT[variant as StatementSignerVariant];
}

const PLATFORMS: readonly SignerPlatform[] = Object.freeze(['ios', 'android']);

/** The signer platform for a React Native `Platform.OS` value. */
export function signerPlatformFor(platformOS: string): SignerPlatform {
  if (!(PLATFORMS as readonly string[]).includes(platformOS)) {
    throw new Error(`No statement signer for platform '${platformOS}'. Known: ${PLATFORMS.join(', ')}.`);
  }
  return platformOS as SignerPlatform;
}

/**
 * This phone's platform. `react-native` is required lazily so that modules
 * which only sometimes need the platform stay importable in plain node tests.
 */
export function currentSignerPlatform(): SignerPlatform {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {Platform} = require('react-native') as {Platform: {OS: string}};
  return signerPlatformFor(Platform.OS);
}

// ─── The Android chain kind, learned from the phone ───────────────────────

const CHAIN_KIND_KEY = '@zkproofport:androidChainKind:v1';
const CHAIN_KINDS: readonly AndroidChainKind[] = Object.freeze(['android', 'android_factory']);
let knownChainKind: AndroidChainKind | null = null;

export function isAndroidChainKind(v: unknown): v is AndroidChainKind {
  return typeof v === 'string' && (CHAIN_KINDS as readonly string[]).includes(v);
}

/** The kind this phone's attestation chain was last seen to be, or null. */
export function knownAndroidChainKind(): AndroidChainKind | null {
  return knownChainKind;
}

/** Keep what a chain showed, in memory and on the phone. */
export async function rememberAndroidChainKind(kind: AndroidChainKind): Promise<void> {
  if (!isAndroidChainKind(kind)) {
    throw new Error(`Not an Android chain kind: '${String(kind)}'. Known: ${CHAIN_KINDS.join(', ')}.`);
  }
  knownChainKind = kind;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  await AsyncStorage.setItem(CHAIN_KIND_KEY, kind);
}

/**
 * Read the kept kind at launch. A missing or damaged value leaves it unknown
 * (it is learned again before the next proof); it is never filled in.
 */
export async function loadAndroidChainKind(): Promise<AndroidChainKind | null> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const stored: unknown = await AsyncStorage.getItem(CHAIN_KIND_KEY);
  knownChainKind = isAndroidChainKind(stored) ? stored : null;
  return knownChainKind;
}

/** Test seam. */
export function __setAndroidChainKindForTests(kind: AndroidChainKind | null): void {
  knownChainKind = kind;
}

/** Thrown when an Android variant is needed before the phone's chain was seen. */
export class AndroidChainKindUnknownError extends Error {
  constructor() {
    super(
      "This phone's attestation chain kind is not known yet: a device signer must make one key " +
        '(src/androidAttest/androidChainKind.ts ensureAndroidChainKind) before its circuit files are chosen.',
    );
    this.name = 'AndroidChainKindUnknownError';
  }
}

/** The variant for a platform and, on Android, a chain kind. */
export function signerVariantFor(platform: SignerPlatform, chainKind: AndroidChainKind | null): StatementSignerVariant {
  if (platform === 'ios') return 'app_attest';
  if (platform === 'android') {
    if (chainKind === null) throw new AndroidChainKindUnknownError();
    if (!isAndroidChainKind(chainKind)) throw new Error(`Not an Android chain kind: '${String(chainKind)}'.`);
    return chainKind;
  }
  throw new Error(`No statement signer for platform '${String(platform)}'. Known: ${PLATFORMS.join(', ')}.`);
}

/** This phone's variant. On Android, throws until the chain kind is known. */
export function currentSignerVariant(): StatementSignerVariant {
  return signerVariantFor(currentSignerPlatform(), knownChainKind);
}

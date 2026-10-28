/**
 * Verifier contracts of the Android packages, per environment, signer variant
 * and circuit id.
 *
 * An Android proof of `coinbase_attestation` or `oidc_domain_attestation` is
 * made by another circuit than the iPhone's (`*_android`, `*_android_factory`:
 * other vk), so it verifies only on that package's own contract. The address
 * in FALLBACK_VERIFIERS is the iPhone circuit's and rejects every Android
 * proof; it is never used for one. A variant / environment / circuit with no
 * row here is refused by name (AndroidVerifierMissingError), never answered
 * with the standard address.
 *
 * Rows (circuits e02e674, deployed 2026-10-28; @zkproofport-app/core
 * android-signature abf5291 pins the OIDC ones in PINNED_VARIANT_VERIFIERS,
 * held to it by verifierAddressesComeFromCore.test.ts):
 *   Base Sepolia (84532), development and staging -- the chain these circuits
 *   already use in those builds. The same packages are also on Ethereum
 *   Sepolia (oidc android 0xbb430a01...e62f, oidc android_factory
 *   0x17ed7935...367a, coinbase android 0x9432c878...b794, coinbase
 *   android_factory 0xeb101079...4100); the app does not use that chain for
 *   these circuits.
 *   Production: none.
 */
import type {CircuitName} from './circuitIds';
import {CIRCUIT_NETWORKS, type Environment} from './contracts';

export type AndroidVerifierVariant = 'android' | 'android_factory';

export interface VariantVerifier {
  address: string;
  chainId: number;
}

const BASE_SEPOLIA = 84532;

const TESTNET_ROWS: Readonly<Record<AndroidVerifierVariant, Readonly<Partial<Record<CircuitName, VariantVerifier>>>>> = Object.freeze({
  android: Object.freeze({
    oidc_domain_attestation: Object.freeze({address: '0x64866bf6734ed43d34799C7949f5eCb35B7e7e44', chainId: BASE_SEPOLIA}),
    coinbase_attestation: Object.freeze({address: '0x395B3bCC27E7E405ec909a81374243fD0b44aacc', chainId: BASE_SEPOLIA}),
  }),
  android_factory: Object.freeze({
    oidc_domain_attestation: Object.freeze({address: '0x9E47e3c2B30E840CFC4D6901bA3E28fC666B3135', chainId: BASE_SEPOLIA}),
    coinbase_attestation: Object.freeze({address: '0xBFAf9390c36d14D596556e42eb52d984De040Aa1', chainId: BASE_SEPOLIA}),
  }),
});

export const ANDROID_VARIANT_VERIFIERS: Readonly<Record<Environment, Readonly<Record<AndroidVerifierVariant, Readonly<Partial<Record<CircuitName, VariantVerifier>>>>>>> =
  Object.freeze({
    development: TESTNET_ROWS,
    staging: TESTNET_ROWS,
    production: Object.freeze({android: Object.freeze({}), android_factory: Object.freeze({})}),
  });

export class AndroidVerifierMissingError extends Error {
  constructor(readonly circuit: string, readonly env: string, readonly variant: string) {
    super(
      `No ${variant} verifier for ${circuit} in the ${env} build: an Android proof of it cannot be checked by anyone, ` +
        "so it is not made or sent (the iPhone circuit's verifier rejects it). src/config/variantVerifiers.ts",
    );
    this.name = 'AndroidVerifierMissingError';
  }
}

/**
 * The contract an Android proof of `circuit` verifies on, in `env`. Throws
 * AndroidVerifierMissingError for a missing row, and an Error when the row's
 * chain is not the chain the app uses for the circuit in that build.
 */
export function androidVerifierFor(circuit: string, env: Environment, variant: AndroidVerifierVariant): VariantVerifier {
  const byEnv = Object.prototype.hasOwnProperty.call(ANDROID_VARIANT_VERIFIERS, env) ? ANDROID_VARIANT_VERIFIERS[env] : undefined;
  if (!byEnv) throw new Error(`Unknown environment '${env}'. Known: ${Object.keys(ANDROID_VARIANT_VERIFIERS).join(', ')}.`);
  const byVariant = Object.prototype.hasOwnProperty.call(byEnv, variant) ? byEnv[variant] : undefined;
  if (!byVariant) throw new Error(`Unknown Android signer variant '${variant}'. Known: ${Object.keys(byEnv).join(', ')}.`);
  const row = Object.prototype.hasOwnProperty.call(byVariant, circuit) ? byVariant[circuit as CircuitName] : undefined;
  if (!row || !row.address) throw new AndroidVerifierMissingError(circuit, env, variant);
  const network = CIRCUIT_NETWORKS[env][circuit as CircuitName];
  if (!network || network.chainId !== row.chainId) {
    throw new Error(
      `The ${variant} verifier for ${circuit} is on chain ${row.chainId}, but the ${env} build uses chain ${network?.chainId} for it`,
    );
  }
  return row;
}

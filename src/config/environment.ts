/**
 * Environment management with build-time defaults and runtime override.
 *
 * Build time: __DEV__ (React Native) determines default environment.
 * Runtime: setEnvironmentOverride() allows switching in dev builds.
 */

import {STATIC_CONFIGS, VERIFIER_ABI, FALLBACK_VERIFIERS, CIRCUIT_NETWORKS} from './contracts';
import {getVerifierAddress as getVerifierAddressAsync, syncDeployments} from './deployments';
import type {
  Environment,
  CircuitName,
  NetworkConfig,
  AttestationConfig,
  RelayConfig,
} from './contracts';
import {NativeModules} from 'react-native';

const BUILD_ENV: Environment = (() => {
  // Debug builds always use development
  if (__DEV__) return 'development';

  // Release builds: read environment from native module (Android productFlavor / iOS Info.plist)
  const nativeEnv = NativeModules.AppEnv?.APP_ENV;
  if (nativeEnv === 'development' || nativeEnv === 'staging' || nativeEnv === 'production') {
    return nativeEnv;
  }

  // Fallback if native module missing
  return 'production';
})();

let _runtimeOverride: Environment | null = null;

export function getEnvironment(): Environment {
  return _runtimeOverride ?? BUILD_ENV;
}

export function setEnvironmentOverride(env: Environment | null): void {
  _runtimeOverride = env;
}

/*
 * `getNetworkConfig()` is gone.
 *
 * It answered "what chain is this build on", and nothing in a multi-chain app
 * has that question. Every caller actually wanted "what chain does THIS
 * CIRCUIT live on" and got Base because Base was the first chain anybody
 * wrote down. An arc_eligibility proof was verified against the Coinbase
 * contract on Base Sepolia and reported failed while being valid.
 *
 * Use `getNetworkConfigForCircuit(circuit)`. For the set of chains the wallet
 * session must carry, use `walletNetworks()`.
 */

/**
 * Network config for a specific circuit. Honors CIRCUIT_NETWORKS
 * so e.g. giwa_attestation always resolves to GIWA Sepolia (chain 91342)
 * regardless of the current environment.
 */
export function getNetworkConfigForCircuit(circuit: CircuitName): NetworkConfig {
  const net = CIRCUIT_NETWORKS[getEnvironment()][circuit];
  if (!net) {
    // No default. A circuit with no chain written down is a circuit nobody has
    // decided where to verify, and answering "Base" made that decision for
    // them, silently and wrongly.
    throw new Error(
      `No network is configured for circuit '${circuit}' in the ${getEnvironment()} environment. ` +
        'Add it to CIRCUIT_NETWORKS in src/config/contracts.ts.',
    );
  }
  return net;
}

export function getAttestationConfig(): AttestationConfig {
  return STATIC_CONFIGS[getEnvironment()].attestation;
}

export function getRelayConfig(): RelayConfig {
  return STATIC_CONFIGS[getEnvironment()].relay;
}

export function getVerifierAbi(): string[] {
  return VERIFIER_ABI;
}

export function getBaseRpcUrls(): string[] {
  return STATIC_CONFIGS[getEnvironment()].rpcUrls.base;
}

/**
 * Get verifier address (async — reads from cache/fallback).
 */
export async function getVerifierAddress(circuit: CircuitName): Promise<string> {
  return getVerifierAddressAsync(circuit, getEnvironment());
}

/**
 * Get verifier address synchronously (fallback only, no cache).
 * Use when async is not possible (e.g., render-time defaults).
 */
export function getVerifierAddressSync(circuit: CircuitName): string {
  return FALLBACK_VERIFIERS[getEnvironment()][circuit];
}

/**
 * Initialize deployments on app start.
 * Fetches latest addresses from GitHub and caches them.
 */
export async function initDeployments(): Promise<boolean> {
  return syncDeployments(getEnvironment());
}

export type {Environment, CircuitName, NetworkConfig, AttestationConfig, RelayConfig};

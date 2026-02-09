/**
 * Environment management with build-time defaults and runtime override.
 *
 * Build time: __DEV__ (React Native) determines default environment.
 * Runtime: setEnvironmentOverride() allows switching in dev builds.
 */

import {STATIC_CONFIGS, VERIFIER_ABI, FALLBACK_VERIFIERS} from './contracts';
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
  if (nativeEnv === 'development' || nativeEnv === 'production') {
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

export function getNetworkConfig(): NetworkConfig {
  return STATIC_CONFIGS[getEnvironment()].network;
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

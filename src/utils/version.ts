import * as Application from 'expo-application';

/**
 * Get the marketing version (e.g., "1.0.0")
 */
export function getVersion(): string {
  return Application.nativeApplicationVersion ?? require('../../package.json').version;
}

/**
 * Get the build number (e.g., "10000")
 */
export function getBuildNumber(): string {
  return Application.nativeBuildVersion ?? '0';
}

/**
 * Get formatted version display string (e.g., "Version 1.0.0 (10000)")
 */
export function getVersionDisplay(): string {
  const version = getVersion();
  const buildNumber = getBuildNumber();
  return `Version ${version} (${buildNumber})`;
}

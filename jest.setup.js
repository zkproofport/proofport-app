/**
 * `__DEV__` is React Native's, injected by Metro. Under jest it is simply
 * absent, so any module that reads it throws ReferenceError on import — which
 * reads as "jest cannot parse this file" and sends you looking at babel.
 *
 * Tests that want the release path can override it per file.
 */
globalThis.__DEV__ = true;

// expo-application ships untranspiled ESM, which this config does not
// transform. Modules that read the running build (src/utils/version.ts) get
// "no native value" here, as on a JS-only runtime; a test that needs a
// particular version mocks the module itself, which overrides this.
jest.mock('expo-application', () => ({nativeApplicationVersion: null, nativeBuildVersion: null}));

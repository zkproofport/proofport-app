/**
 * `__DEV__` is React Native's, injected by Metro. Under jest it is simply
 * absent, so any module that reads it throws ReferenceError on import — which
 * reads as "jest cannot parse this file" and sends you looking at babel.
 *
 * Tests that want the release path can override it per file.
 */
globalThis.__DEV__ = true;

const { getDefaultConfig } = require('expo/metro-config');
const { mergeConfig } = require('@react-native/metro-config');
const path = require('path');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
// openstoa-mobile is a sibling RN package consumed via `file:` from
// package.json. Metro needs to know to watch and resolve from these
// directories (it does not follow file: paths into a sibling repo by default).
const openstoaPackagesRoot = path.resolve(__dirname, '../openstoa/packages');
const openstoaWatchFolders = [
  path.join(openstoaPackagesRoot, 'mobile'),
  path.join(openstoaPackagesRoot, 'miniapp-bridge'),
  path.join(openstoaPackagesRoot, 'api-types'),
  // `mls` holds the ONE copy of the MLS/TAK crypto; the mini-app's
  // `src/crypto/*` are thin re-exports that reach into it with a relative path
  // (`../../../mls/src/...`). Metro will not resolve a path outside every
  // watch folder, so leaving it off this list fails the bundle with
  // "Unable to resolve module ../../../mls/src/keyManager" — while vitest,
  // which resolves from the filesystem directly, passes. Adding a package
  // under packages/ means adding it here.
  path.join(openstoaPackagesRoot, 'mls'),
];

const config = {
  watchFolders: openstoaWatchFolders,
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
  resolver: {
    // Hoist sibling-package dependency lookups back into proofport-app's
    // node_modules. Without this, Metro fails to resolve `react`,
    // `@openstoa/*`, etc. from the file:-linked openstoa-mobile sources
    // because their relative __dirname is ../openstoa/packages/mobile.
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    // Alias jose to its browser build
    extraNodeModules: new Proxy(
      {
        jose: path.resolve(__dirname, 'node_modules/jose/dist/browser/index.js'),
        '@openstoa/miniapp-bridge': path.resolve(__dirname, 'node_modules/@openstoa/miniapp-bridge'),
        '@openstoa/api-types': path.resolve(__dirname, 'node_modules/@openstoa/api-types'),
      },
      {
        // Fall back to standard module resolution for everything else.
        get: (target, name) => (name in target ? target[name] : undefined),
      },
    ),
    resolveRequest: (context, moduleName, platform) => {
      // Redirect jose package to browser version
      if (moduleName === 'jose') {
        return {
          filePath: path.resolve(__dirname, 'node_modules/jose/dist/browser/index.js'),
          type: 'sourceFile',
        };
      }
      // Redirect internal jose/node paths to browser
      if (moduleName.includes('jose/dist/node')) {
        const browserPath = moduleName.replace('/node/esm', '/browser').replace('/node/cjs', '/browser').replace('/node/', '/browser/');
        return context.resolveRequest(context, browserPath, platform);
      }
      // Block node `crypto` (the app provides WebCrypto via global.crypto;
      // ts-mls PoC attaches `subtle`). `util` is NO LONGER blocked: it now
      // resolves to the installed `util` browser-polyfill (0.12.5, has
      // promisify) because react-native-quick-crypto requires util.promisify.
      // A real util is strictly safer than an empty module for all consumers.
      if (moduleName === 'crypto') {
        return {type: 'empty'};
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);

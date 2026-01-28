const { getDefaultConfig } = require('expo/metro-config');
const { mergeConfig } = require('@react-native/metro-config');
const path = require('path');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
  resolver: {
    // Alias jose to its browser build
    extraNodeModules: {
      jose: path.resolve(__dirname, 'node_modules/jose/dist/browser/index.js'),
    },
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
      // Block node crypto/util modules
      if (moduleName === 'crypto' || moduleName === 'util') {
        return {type: 'empty'};
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);

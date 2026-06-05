const path = require('path');
const pkg = require('./mopro_bindings/package.json');

module.exports = {
  project: {
    ios: {
      automaticPodsInstallation: true,
    },
  },
  dependencies: {
    [pkg.name]: {
      root: path.join(__dirname, 'mopro_bindings'),
      platforms: {
        ios: {},
        android: {},
      },
    },
  },
  assets: ['./node_modules/react-native-vector-icons/Fonts'],
  // Circuit assets are now downloaded from GitHub at runtime
  // See src/utils/circuitDownload.ts for loading logic
};

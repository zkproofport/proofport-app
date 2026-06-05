module.exports = {
  presets: ['babel-preset-expo'],
  // react-native-reanimated/plugin MUST be last for Reanimated to work.
  plugins: [
    '@babel/plugin-transform-export-namespace-from',
    'react-native-reanimated/plugin',
  ],
};

/**
 * Minimal Jest config. The current suite covers pure, dependency-free logic
 * (no react-native runtime), so a plain node environment with babel-jest
 * (driven by babel.config.js / babel-preset-expo for TS) is sufficient and
 * avoids pulling in the heavy react-native jest preset.
 */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
};

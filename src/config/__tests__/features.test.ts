/**
 * `OPENSTOA_ENABLED` comes from the build, and the whole point of moving it out
 * of source is that the two platforms ship independently with different answers.
 * These pin the parsing, including the case that used to be impossible to get
 * wrong and now is: a build that says nothing at all.
 */
const loadFlag = (value: unknown): boolean => {
  jest.resetModules();
  jest.doMock('react-native', () => ({
    NativeModules: {AppEnv: value === undefined ? {} : {OPENSTOA_ENABLED: value}},
  }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../features').OPENSTOA_ENABLED as boolean;
};

describe('OPENSTOA_ENABLED', () => {
  it('is false only when the build says exactly that', () => {
    expect(loadFlag('false')).toBe(false);
  });

  it('is true when the build enables it', () => {
    expect(loadFlag('true')).toBe(true);
  });

  it('accepts either case — resValue and Info.plist are hand-edited strings', () => {
    expect(loadFlag('FALSE')).toBe(false);
    expect(loadFlag('False')).toBe(false);
    expect(loadFlag('TRUE')).toBe(true);
  });

  it('DEFAULTS TO ENABLED when the build says nothing', () => {
    // A build that forgets the setting keeps the feature. Defaulting the other
    // way would let a missing line silently delete a whole tab.
    expect(loadFlag(undefined)).toBe(true);
    expect(loadFlag('')).toBe(true);
  });

  it('an unrecognised value is enabled, not a crash and not disabled', () => {
    // iOS resolves `$(OPENSTOA_ENABLED)` literally when the setting is absent,
    // so the value reaching JS is not always one of the two words.
    expect(loadFlag('$(OPENSTOA_ENABLED)')).toBe(true);
    expect(loadFlag('yes')).toBe(true);
    expect(loadFlag(null)).toBe(true);
  });

  it('survives the native module being missing entirely', () => {
    jest.resetModules();
    jest.doMock('react-native', () => ({NativeModules: {}}));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect(require('../features').OPENSTOA_ENABLED).toBe(true);
  });
});

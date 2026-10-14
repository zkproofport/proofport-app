/**
 * The wallet sheet offers external wallets over WalletConnect and nothing else.
 *
 * AppKit enables email and social sign-in unless told not to, and both create
 * an embedded wallet that holds none of what a circuit here proves. The live
 * sheet showed "Continue with Email" and four social buttons on 2026-10-14
 * while every document said there was no such login.
 */
const mockCreateAppKit = jest.fn((options: unknown) => ({options}));

jest.mock('@reown/appkit-react-native', () => ({createAppKit: mockCreateAppKit}));
jest.mock('@reown/appkit-ethers-react-native', () => ({EthersAdapter: jest.fn()}));
jest.mock('@react-native-async-storage/async-storage', () => ({}));
jest.mock('react-native', () => ({NativeModules: {}}));

describe('wallet connection', () => {
  it('passes socials: false, which turns off email and every social login', () => {
    require('../config/AppKitConfig');
    expect(mockCreateAppKit).toHaveBeenCalledTimes(1);
    const options = mockCreateAppKit.mock.calls[0][0] as {features?: {socials?: unknown}};
    expect(options.features?.socials).toBe(false);
  });
});

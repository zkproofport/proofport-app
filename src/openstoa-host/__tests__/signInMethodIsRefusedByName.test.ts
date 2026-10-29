/**
 * The OpenStoa bridge contract lets the mini-app ask the host to sign in with
 * `method: 'mdl'`. This app has no circuit for it, so the host refuses the
 * method by name before any request leaves the phone -- it never becomes an
 * OIDC sign-in, and never reaches the relay with a circuit id nobody serves.
 */
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => void store.set(k, v),
      removeItem: async (k: string) => void store.delete(k),
    },
  };
});
jest.mock('expo-secure-store', () => ({getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn()}), {virtual: true});
jest.mock('expo-notifications', () => ({}), {virtual: true});
jest.mock('expo-device', () => ({}), {virtual: true});
jest.mock('expo-crypto', () => ({randomUUID: () => 'install-id'}), {virtual: true});
jest.mock('expo-constants', () => ({__esModule: true, default: {}}), {virtual: true});
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'ios', select: (o: Record<string, unknown>) => o.ios}}));
jest.mock('../../config', () => ({
  OPENSTOA_ENABLED: true,
  CIRCUIT_IDS: jest.requireActual('../../config/circuitIds').CIRCUIT_IDS,
}));
jest.mock('../../i18n', () => ({__esModule: true, default: {t: (k: string) => k}, getLanguage: () => 'en'}));
jest.mock('../pushTapBridge', () => ({startPushTapBridge: jest.fn(), subscribeHostPushTap: jest.fn(), subscribeHostPushReceived: jest.fn(), jumpToOpenStoaTab: jest.fn()}));
jest.mock('../pushRegistration', () => ({registerForPushWithDeps: jest.fn()}));
jest.mock('../pushClearing', () => ({clearDeliveredForTopic: jest.fn(), CHAT_CHANNEL_ID: 'chat'}));
jest.mock('../unreadBadge', () => ({setUnreadBadge: jest.fn()}));
jest.mock('../passkeyDomain', () => ({resolvePasskeyDomain: jest.fn()}));
jest.mock('../topicProofRelay', () => ({requestTopicProof: jest.fn()}));
jest.mock('../../stores/activeProofRequestStore', () => ({getActiveProofRequest: () => null}));
const mockTrigger = jest.fn();
jest.mock('../../utils/deepLinkBridge', () => ({triggerDeepLink: (...a: unknown[]) => mockTrigger(...a)}));
const mockFetch = jest.fn();
jest.mock('../fetchWithDeadline', () => ({fetchWithDeadline: (...a: unknown[]) => mockFetch(...a)}));

import {createZkProofportHostApi} from '../zkProofportHostApi';

function host() {
  return createZkProofportHostApi({
    getNavigation: () => null,
    baseUrl: 'https://openstoa.example',
    showError: jest.fn(),
    haptic: jest.fn(),
    getTheme: () => 'dark',
    subscribeTheme: () => () => {},
    getDeveloperMode: () => false,
    subscribeDeveloperMode: () => () => {},
  } as never);
}

describe('sign-in method', () => {
  const dev = (global as {__DEV__?: boolean}).__DEV__;
  beforeEach(() => {
    (global as {__DEV__?: boolean}).__DEV__ = false;
    mockFetch.mockReset();
    mockTrigger.mockReset();
  });
  afterAll(() => {
    (global as {__DEV__?: boolean}).__DEV__ = dev;
  });

  it.each(['mdl', 'MDL', '__proto__', 'constructor', ''])('%p is refused by name, and nothing is requested', async method => {
    await expect(host().loginToOpenStoa({force: true, method: method as never})).rejects.toThrow(
      `Unknown sign-in method '${method}'. Known: oidc.`,
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockTrigger).not.toHaveBeenCalled();
  });

  it.each([undefined, 'oidc'])('%p asks the server for an OIDC proof request', async method => {
    mockFetch.mockResolvedValueOnce({ok: false, status: 503, text: async () => 'down'});
    await expect(host().loginToOpenStoa({force: true, method: method as never})).rejects.toThrow(/proof-request failed \(503\)/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://openstoa.example/api/auth/proof-request');
    expect(JSON.parse(init.body)).toEqual({circuitType: 'oidc_domain_attestation'});
  });
});

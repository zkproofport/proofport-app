/**
 * useForceUpdate: checked at launch, checked again on returning to the
 * foreground once the last good answer is older than the TTL, never two checks
 * at once, and the verdict visible to the deep link handler.
 */
import React from 'react';
import {act, create} from 'react-test-renderer';

type Listener = (state: string) => void;
const mockListeners: Listener[] = [];
const mockRemove = jest.fn();

jest.mock('react-native', () => ({
  AppState: {
    addEventListener: (_event: string, listener: Listener) => {
      mockListeners.push(listener);
      return {remove: mockRemove};
    },
  },
  Platform: {OS: 'ios'},
  Settings: {get: jest.fn(() => undefined)},
}));
jest.mock('@react-native-async-storage/async-storage', () => ({getItem: jest.fn(), setItem: jest.fn()}));
jest.mock('expo-application', () => ({nativeApplicationVersion: '1.4.0'}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {useForceUpdate, isUpdateRequired} = require('../useForceUpdate') as typeof import('../useForceUpdate');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {MIN_VERSION_TTL_MS, MIN_VERSION_URL} = require('../../utils/forceUpdate') as typeof import('../../utils/forceUpdate');

const IOS_STORE = 'https://apps.apple.com/app/id6803903114';
const body = (minimum: string) => JSON.stringify({schema: 1, ios: {minimum, storeUrl: IOS_STORE}});

let clock = 0;
let minimum = '1.4.0';
let fetchImpl: jest.Mock;
let states: string[] = [];

function Probe() {
  const state = useForceUpdate(() => ({
    fetch: fetchImpl,
    storage: {getItem: async () => null, setItem: async () => undefined},
    platform: 'ios',
    runningVersion: '1.4.0',
    now: () => clock,
    url: MIN_VERSION_URL,
  }));
  states.push(state.status);
  return null;
}

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  mockListeners.length = 0;
  states = [];
  clock = 1_000_000;
  minimum = '1.4.0';
  fetchImpl = jest.fn(async () => ({ok: true, status: 200, text: async () => body(minimum)}));
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
});
afterEach(() => jest.restoreAllMocks());

describe('useForceUpdate', () => {
  it('starts as checking, then allows a version at the minimum', async () => {
    await act(async () => { create(React.createElement(Probe)); });
    await flush();
    expect(states[0]).toBe('checking');
    expect(states[states.length - 1]).toBe('allowed');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(isUpdateRequired()).toBe(false);
  });

  it('does not re-check on a foreground inside the TTL, and does after it', async () => {
    await act(async () => { create(React.createElement(Probe)); });
    await flush();
    clock += MIN_VERSION_TTL_MS - 1;
    await act(async () => mockListeners.forEach(l => l('active')));
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    minimum = '1.5.0';
    clock += 1;
    await act(async () => mockListeners.forEach(l => l('active')));
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(states[states.length - 1]).toBe('blocked');
    expect(isUpdateRequired()).toBe(true);
  });

  it('ignores background and inactive transitions', async () => {
    await act(async () => { create(React.createElement(Probe)); });
    await flush();
    clock += MIN_VERSION_TTL_MS * 2;
    await act(async () => mockListeners.forEach(l => { l('background'); l('inactive'); }));
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries on every foreground while the file stays unreadable (nothing cached)', async () => {
    fetchImpl = jest.fn(async () => { throw new TypeError('Network request failed'); });
    await act(async () => { create(React.createElement(Probe)); });
    await flush();
    expect(states[states.length - 1]).toBe('allowed');
    for (let i = 0; i < 3; i++) {
      await act(async () => mockListeners.forEach(l => l('active')));
      await flush();
    }
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('shares one check between foreground events that arrive while it runs', async () => {
    let release: () => void = () => undefined;
    fetchImpl = jest.fn(() => new Promise(resolve => {
      release = () => resolve({ok: true, status: 200, text: async () => body('1.4.0')});
    }));
    await act(async () => { create(React.createElement(Probe)); });
    await act(async () => mockListeners.forEach(l => { l('active'); l('active'); l('active'); }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await flush();
    expect(states[states.length - 1]).toBe('allowed');
  });

  it('unblocks when a later read lowers the minimum', async () => {
    minimum = '2.0.0';
    await act(async () => { create(React.createElement(Probe)); });
    await flush();
    expect(isUpdateRequired()).toBe(true);
    minimum = '1.0.0';
    clock += MIN_VERSION_TTL_MS;
    await act(async () => mockListeners.forEach(l => l('active')));
    await flush();
    expect(states[states.length - 1]).toBe('allowed');
    expect(isUpdateRequired()).toBe(false);
  });

  it('removes its listener on unmount', async () => {
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => { tree = create(React.createElement(Probe)); });
    await flush();
    await act(async () => tree!.unmount());
    expect(mockRemove).toHaveBeenCalled();
  });
});

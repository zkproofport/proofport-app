const mockDisk = new Map<string, string>();
let mockRead: (() => Promise<string | null>) | null = null;
let mockWrite: ((key: string, value: string) => Promise<void>) | null = null;
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true, default: {
    getItem: jest.fn(async (key: string) => mockRead ? mockRead() : mockDisk.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      if (mockWrite) await mockWrite(key, value);
      mockDisk.set(key, value);
    }),
  },
}));
import AsyncStorage from '@react-native-async-storage/async-storage';
import {settingsStore} from '../settingsStore';
const KEY = '@zkproofport:settings:app';
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
beforeEach(() => {jest.clearAllMocks(); mockDisk.clear(); mockRead = null; mockWrite = null;});

it('uses defaults only when storage has no settings', async () => {
  expect(await settingsStore.get()).toMatchObject({theme: 'dark', autoSaveProofs: true, confirmBeforeGenerate: true});
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it('rejects read failure and does not replace the saved settings during an update', async () => {
  const bytes = JSON.stringify({theme: 'light', developerMode: true}); mockDisk.set(KEY, bytes);
  mockRead = async () => {throw new Error('read failed');};
  await expect(settingsStore.get()).rejects.toThrow('read failed');
  await expect(settingsStore.update({autoSaveProofs: false})).rejects.toThrow('read failed');
  expect(mockDisk.get(KEY)).toBe(bytes);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it('rejects corrupt JSON instead of overwriting it with defaults', async () => {
  mockDisk.set(KEY, '{broken');
  await expect(settingsStore.update({theme: 'light'})).rejects.toThrow();
  expect(mockDisk.get(KEY)).toBe('{broken');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it.each(['', ' ', 'null', '[]', '42', 'true', '""'])('rejects invalid stored settings %p without overwriting the bytes', async bytes => {
  mockDisk.set(KEY, bytes);
  await expect(settingsStore.update({theme: 'light'})).rejects.toThrow();
  expect(mockDisk.get(KEY)).toBe(bytes);
});
it('keeps two independent choices when the first read is slow', async () => {
  const read = deferred<string | null>();
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => read.promise);
  const first = settingsStore.update({autoSaveProofs: false});
  const second = settingsStore.update({confirmBeforeGenerate: false});
  await Promise.resolve();
  read.resolve(JSON.stringify({theme: 'light', developerMode: true}));
  await Promise.all([first, second]);
  expect(await settingsStore.get()).toMatchObject({autoSaveProofs: false, confirmBeforeGenerate: false, theme: 'light', developerMode: true});
});
it('serializes theme and other settings even while a native write is pending', async () => {
  const write = deferred<void>();
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async (key, bytes) => {await write.promise; mockDisk.set(key, bytes);});
  const first = settingsStore.update({theme: 'light'});
  const second = settingsStore.update({autoSaveProofs: false});
  await Promise.resolve(); await Promise.resolve();
  write.resolve();
  await Promise.all([first, second]);
  expect(await settingsStore.get()).toMatchObject({theme: 'light', autoSaveProofs: false});
});
it('allows retry after a failed mutation without poisoning the queue', async () => {
  mockWrite = async () => {throw new Error('full');};
  await expect(settingsStore.update({theme: 'light'})).rejects.toThrow('full');
  mockWrite = null;
  await settingsStore.update({autoSaveProofs: false});
  expect(await settingsStore.get()).toMatchObject({theme: 'dark', autoSaveProofs: false});
});

describe('a saved default network the app no longer has', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
  afterEach(() => (console.log as jest.Mock).mockRestore());

  it.each(['arc', 'omnione', '', 'ARC', 'base ', '<script>'])('shows the initial network instead of %p', async value => {
    mockDisk.set(KEY, JSON.stringify({defaultNetwork: value, theme: 'light'}));
    const settings = await settingsStore.get();
    expect(settings.defaultNetwork).toBe('base');
    expect(settings.theme).toBe('light');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('keeps every network the app still has', async () => {
    const {NETWORK_CATEGORIES} = require('../../config/networks');
    for (const {id} of NETWORK_CATEGORIES) {
      mockDisk.set(KEY, JSON.stringify({defaultNetwork: id}));
      expect((await settingsStore.get()).defaultNetwork).toBe(id);
    }
  });

  it('writes the corrected value back only on the next real update', async () => {
    mockDisk.set(KEY, JSON.stringify({defaultNetwork: 'arc'}));
    await settingsStore.update({theme: 'light'});
    expect(JSON.parse(mockDisk.get(KEY)!)).toMatchObject({defaultNetwork: 'base', theme: 'light'});
  });
});

describe('the Laboratory switch', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
  afterEach(() => (console.log as jest.Mock).mockRestore());

  it('is off on a fresh install', async () => {
    expect((await settingsStore.get()).laboratoryEnabled).toBe(false);
  });

  it('is off for settings saved before the key existed, keeping everything else', async () => {
    mockDisk.set(KEY, JSON.stringify({theme: 'light', developerMode: true, autoSaveProofs: false}));
    expect(await settingsStore.get()).toMatchObject({laboratoryEnabled: false, theme: 'light', developerMode: true, autoSaveProofs: false});
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('keeps a saved true', async () => {
    mockDisk.set(KEY, JSON.stringify({laboratoryEnabled: true}));
    expect((await settingsStore.get()).laboratoryEnabled).toBe(true);
  });

  it.each(['true', 'false', 1, 0, null, {}, [], ''])('reads the corrupt value %p as off, without writing', async value => {
    mockDisk.set(KEY, JSON.stringify({laboratoryEnabled: value, theme: 'light'}));
    const settings = await settingsStore.get();
    expect(settings.laboratoryEnabled).toBe(false);
    expect(settings.theme).toBe('light');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('repairs a corrupt value on the next real update', async () => {
    mockDisk.set(KEY, JSON.stringify({laboratoryEnabled: 'true'}));
    await settingsStore.update({theme: 'light'});
    expect(JSON.parse(mockDisk.get(KEY)!)).toMatchObject({laboratoryEnabled: false, theme: 'light'});
  });

  it('turns on, off and on again', async () => {
    for (const value of [true, false, true]) {
      await settingsStore.update({laboratoryEnabled: value});
      expect((await settingsStore.get()).laboratoryEnabled).toBe(value);
    }
  });

  it('keeps the switch and another choice made while the first read is slow', async () => {
    const read = deferred<string | null>();
    jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => read.promise);
    const first = settingsStore.update({laboratoryEnabled: true});
    const second = settingsStore.update({autoSaveProofs: false});
    const third = settingsStore.update({theme: 'light'});
    await Promise.resolve();
    read.resolve(JSON.stringify({developerMode: true}));
    await Promise.all([first, second, third]);
    expect(await settingsStore.get()).toMatchObject({laboratoryEnabled: true, autoSaveProofs: false, theme: 'light', developerMode: true});
  });

  it('the last of rapid on/off flips wins, in the order they were made', async () => {
    await Promise.all([true, false, true, false].map(value => settingsStore.update({laboratoryEnabled: value})));
    expect((await settingsStore.get()).laboratoryEnabled).toBe(false);
  });

  it('reset turns it off', async () => {
    await settingsStore.update({laboratoryEnabled: true});
    expect((await settingsStore.reset()).laboratoryEnabled).toBe(false);
    expect((await settingsStore.get()).laboratoryEnabled).toBe(false);
  });
});

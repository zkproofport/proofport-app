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

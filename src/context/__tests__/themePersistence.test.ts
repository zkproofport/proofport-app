import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

const mockGet = jest.fn();
const mockUpdate = jest.fn();
jest.mock('../../stores', () => ({settingsStore: {get: (...args: unknown[]) => mockGet(...args), update: (...args: unknown[]) => mockUpdate(...args)}}));
jest.mock('i18next', () => ({__esModule: true, default: {t: (key: string) => key}}));

import {ThemeProvider, useThemeColors} from '../ThemeContext';
import {registerErrorHandler, resetErrorBridge} from '../../utils/errorBridge';
const showError = jest.fn();
let screen: ReactTestRenderer | undefined;
let consoleError: jest.SpyInstance;
function Probe() {const theme = useThemeColors(); return React.createElement('ThemeProbe' as never, theme);}
function value() {return screen!.root.findByType('ThemeProbe' as never).props;}
async function mount() {await act(async () => {screen = create(React.createElement(ThemeProvider, null, React.createElement(Probe)));});}
async function choose(mode: 'dark' | 'light') {await act(async () => {value().setThemeMode(mode);});}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
beforeEach(() => {
  jest.clearAllMocks(); resetErrorBridge(); registerErrorHandler(showError);
  mockGet.mockResolvedValue({theme: 'dark'}); mockUpdate.mockImplementation(async (partial: {theme: string}) => partial);
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
  const originalError = console.error;
  consoleError = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).startsWith('react-test-renderer is deprecated')) return;
    originalError(...args);
  });
});
afterEach(async () => {if (screen) await act(async () => screen!.unmount()); screen = undefined; consoleError.mockRestore(); resetErrorBridge();});

it.each(['dark', 'light'])('starts from the stored %s theme', async theme => {
  mockGet.mockResolvedValueOnce({theme}); await mount(); expect(value().mode).toBe(theme);
});
it('reports a rejected save via the bridge and restores the persisted theme', async () => {
  mockUpdate.mockRejectedValueOnce(new Error('disk full'));
  await mount(); await choose('light');
  expect(showError).toHaveBeenCalledWith('E5001', expect.any(String));
  expect(value().mode).toBe('dark');
});
it('does not roll back a newer choice when an older save fails', async () => {
  const older = deferred<{theme: string}>();
  mockUpdate.mockImplementationOnce(() => older.promise);
  await mount(); await choose('light'); await choose('dark');
  expect(value().mode).toBe('dark');
  await act(async () => {older.reject(new Error('first save failed'));});
  expect(value().mode).toBe('dark');
  expect(mockUpdate).toHaveBeenLastCalledWith({theme: 'dark'});
  expect(showError).toHaveBeenCalledTimes(1);
});
it('writes rapid choices in order so a slow older write cannot become the saved theme', async () => {
  const older = deferred<{theme: string}>();
  mockUpdate.mockImplementationOnce(() => older.promise);
  await mount(); await choose('light'); await choose('dark');
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  await act(async () => {older.resolve({theme: 'light'});});
  expect(mockUpdate.mock.calls).toEqual([[{theme: 'light'}], [{theme: 'dark'}]]);
  expect(value().mode).toBe('dark');
});
it('restores the last successful choice when the latest save fails', async () => {
  await mount(); await choose('light');
  mockUpdate.mockRejectedValueOnce(new Error('disk full'));
  await choose('dark');
  expect(value().mode).toBe('light');
  expect(showError).toHaveBeenCalledTimes(1);
});
it('does not overwrite a user choice when the initial read finishes late', async () => {
  const read = deferred<{theme: string}>();
  mockGet.mockImplementationOnce(() => read.promise);
  await mount(); await choose('light');
  await act(async () => {read.resolve({theme: 'dark'});});
  expect(value().mode).toBe('light');
});
it('reports initial read rejection instead of leaking an unhandled promise', async () => {
  mockGet.mockRejectedValueOnce(new Error('disk read failed')); await mount();
  expect(showError).toHaveBeenCalledWith('E5002', expect.any(String));
});

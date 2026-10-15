/**
 * One QR code in front of the camera is one proof request.
 *
 * The camera reports the code on every frame, and several frames can reach the
 * screen before its "already scanned" state re-renders into the callback. On
 * 2026-10-15 a single scan of the Ssiat demo's QR reached the relay five times
 * within 8 ms; App took the duplicates for newer requests and cancelled the
 * real one, so approving it failed with E1007.
 */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

type Scanner = {onCodeScanned: (codes: Array<{value?: string}>) => void};
const mockScanners: Scanner[] = [];
const mockTrigger = jest.fn();
const mockGoBack = jest.fn();
let mockFocus: (() => void | (() => void)) | null = null;

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', SafeAreaView: 'SafeAreaView', TouchableOpacity: 'TouchableOpacity',
  StyleSheet: {create: (s: unknown) => s, absoluteFill: {}},
  Alert: {alert: jest.fn()}, Linking: {openSettings: jest.fn()}, Platform: {OS: 'ios'},
}));
jest.mock('react-native-vision-camera', () => ({
  Camera: 'Camera',
  useCameraDevice: () => ({id: 'back'}),
  useCameraPermission: () => ({hasPermission: true, requestPermission: jest.fn()}),
  useCodeScanner: (scanner: Scanner) => {mockScanners.push(scanner); return scanner;},
}));
jest.mock('@react-navigation/native', () => {
  const ReactActual = jest.requireActual('react');
  return {
    useNavigation: () => ({canGoBack: () => true, goBack: mockGoBack, navigate: jest.fn()}),
    useFocusEffect: (effect: () => void | (() => void)) => {
      mockFocus = effect;
      ReactActual.useEffect(() => effect(), [effect]);
    },
  };
});
jest.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));
jest.mock('../../utils/deepLinkBridge', () => ({triggerDeepLink: (...args: unknown[]) => mockTrigger(...args)}));
jest.mock('../../context', () => ({
  useThemeColors: () => ({colors: {
    background: {primary: '#000'}, text: {primary: '#fff', secondary: '#ccc'}, info: {500: '#00f'},
  }}),
}));

import QRScanScreen from '../scan/QRScanScreen';

const LINK = 'zkproofport://proof-request?data=abc';
let tree: ReactTestRenderer;

beforeEach(async () => {
  jest.useFakeTimers();
  mockScanners.length = 0;
  mockTrigger.mockReset();
  mockGoBack.mockReset();
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => {tree = create(React.createElement(QRScanScreen));});
});
afterEach(() => {
  act(() => tree.unmount());
  jest.useRealTimers();
});

/** Frames delivered back to back, before React re-renders the screen. */
function framesBeforeRerender(count: number, value = LINK) {
  const scanner = mockScanners[mockScanners.length - 1];
  act(() => {
    for (let i = 0; i < count; i++) scanner.onCodeScanned([{value}]);
  });
  act(() => {jest.advanceTimersByTime(300);});
}

it.each([1, 2, 5, 30])('%i frames of the same code hand over exactly one request', count => {
  framesBeforeRerender(count);
  expect(mockTrigger).toHaveBeenCalledTimes(1);
  expect(mockTrigger).toHaveBeenCalledWith(LINK, 'scan');
  expect(mockGoBack).toHaveBeenCalledTimes(1);
});

it('a frame arriving after the re-render does not hand it over again', () => {
  framesBeforeRerender(3);
  framesBeforeRerender(3);
  expect(mockTrigger).toHaveBeenCalledTimes(1);
});

it('an empty frame does not lock the scanner', () => {
  const scanner = mockScanners[mockScanners.length - 1];
  act(() => scanner.onCodeScanned([]));
  act(() => scanner.onCodeScanned([{value: ''}]));
  framesBeforeRerender(2);
  expect(mockTrigger).toHaveBeenCalledTimes(1);
});

it('returning to the scanner allows the next code', () => {
  framesBeforeRerender(5);
  act(() => {mockFocus?.();});
  framesBeforeRerender(5, 'zkproofport://proof-request?data=next');
  expect(mockTrigger.mock.calls.map(call => call[0])).toEqual([LINK, 'zkproofport://proof-request?data=next']);
});

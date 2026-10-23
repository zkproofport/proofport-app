/**
 * Each sign-in hook sends the nonce it is given to its provider, and refuses
 * to open a sheet with something that is not one.
 */
import React from 'react';
import {act, create} from 'react-test-renderer';

const mockAuthRequest = jest.fn();
const mockPromptAsync = jest.fn();
const mockGoogleSignIn = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: {GoogleIdToken: {signIn: (...a: unknown[]) => mockGoogleSignIn(...a)}},
  Platform: {OS: 'android'},
}));
jest.mock('expo-auth-session', () => ({
  ResponseType: {IdToken: 'id_token'},
  AuthRequest: class {
    constructor(config: unknown) {
      mockAuthRequest(config);
    }
    promptAsync(...a: unknown[]) {
      return mockPromptAsync(...a);
    }
  },
}), {virtual: true});

import {useMicrosoftAuth} from '../useMicrosoftAuth';
import {useGoogleAuth} from '../useGoogleAuth';
import type {SignInResult} from '../signInResult';

const NONCE = '1dd297f01d4567260b8519ab54aabdf7138fe1b04c89a3aea3c05a1f82a0e0ff';

function hook<T>(use: () => T): T {
  let value!: T;
  const Probe = () => {
    value = use();
    return null;
  };
  act(() => {
    create(React.createElement(Probe));
  });
  return value;
}

let logs: jest.SpyInstance;
let errors: jest.SpyInstance;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  logs = jest.spyOn(console, 'log').mockImplementation(() => {});
  errors = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  logs.mockRestore();
  errors.mockRestore();
});

describe('useMicrosoftAuth', () => {
  it('puts the given nonce on the authorize request and returns the token', async () => {
    mockPromptAsync.mockResolvedValue({type: 'success', params: {id_token: 'h.p.s', state: 'x'}});
    const {promptSignIn} = hook(useMicrosoftAuth);
    let r!: SignInResult;
    await act(async () => {r = await promptSignIn(NONCE);});
    expect(r).toEqual({token: 'h.p.s'});
    expect(mockAuthRequest).toHaveBeenCalledWith(expect.objectContaining({
      responseType: 'id_token',
      extraParams: expect.objectContaining({nonce: NONCE}),
    }));
  });

  it('never logs the ID token itself', async () => {
    mockPromptAsync.mockResolvedValue({type: 'success', params: {id_token: 'SECRET.TOKEN.VALUE'}});
    const {promptSignIn} = hook(useMicrosoftAuth);
    await act(async () => {await promptSignIn(NONCE);});
    expect(JSON.stringify(logs.mock.calls)).not.toContain('SECRET.TOKEN.VALUE');
  });

  it.each(['', 'abc', NONCE.toUpperCase()])('refuses nonce %p without opening the browser', async bad => {
    const {promptSignIn} = hook(useMicrosoftAuth);
    let r!: SignInResult;
    await act(async () => {r = await promptSignIn(bad);});
    expect(r).toEqual({error: expect.stringMatching(/64-hex nonce/), cancelled: false});
    expect(mockAuthRequest).not.toHaveBeenCalled();
  });

  it('a dismissed browser is a cancel', async () => {
    mockPromptAsync.mockResolvedValue({type: 'dismiss'});
    const {promptSignIn} = hook(useMicrosoftAuth);
    let r!: SignInResult;
    await act(async () => {r = await promptSignIn(NONCE);});
    expect(r).toEqual({error: 'Microsoft sign-in was cancelled', cancelled: true});
  });
});

describe('useGoogleAuth', () => {
  it('passes the nonce to the native module and returns its token', async () => {
    mockGoogleSignIn.mockResolvedValue({idToken: 'g.t.s'});
    const {promptSignIn} = hook(useGoogleAuth);
    let r!: SignInResult;
    await act(async () => {r = await promptSignIn(NONCE);});
    expect(r).toEqual({token: 'g.t.s'});
    expect(mockGoogleSignIn).toHaveBeenCalledWith(expect.objectContaining({nonce: NONCE}));
  });

  it('a native CANCELLED is a cancel; KEYCHAIN says why', async () => {
    const {promptSignIn} = hook(useGoogleAuth);
    let r!: SignInResult;
    mockGoogleSignIn.mockRejectedValueOnce(Object.assign(new Error('closed'), {code: 'CANCELLED'}));
    await act(async () => {r = await promptSignIn(NONCE);});
    expect(r).toEqual(expect.objectContaining({cancelled: true}));
    mockGoogleSignIn.mockRejectedValueOnce(Object.assign(new Error('keychain error'), {code: 'KEYCHAIN'}));
    await act(async () => {r = await promptSignIn(NONCE);});
    expect(r).toEqual({error: expect.stringMatching(/keychain-access-groups/), cancelled: false});
  });

  it('a bad nonce is a returned failure, not a throw, and opens nothing', async () => {
    const {promptSignIn} = hook(useGoogleAuth);
    let r!: SignInResult;
    await act(async () => {r = await promptSignIn('nope');});
    expect(r).toEqual({error: expect.stringMatching(/64-hex nonce/), cancelled: false});
    expect(mockGoogleSignIn).not.toHaveBeenCalled();
  });
});

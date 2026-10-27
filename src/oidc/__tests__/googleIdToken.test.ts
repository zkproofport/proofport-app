/**
 * The JS side of the native Google sign-in contract, with the native module
 * mocked. What each platform's module actually does is held by
 * theNativeGoogleSignInCarriesTheNonce.test.ts (source) and the device
 * checklist in app-dev.md (behaviour).
 */
const mockNative: {GoogleIdToken?: {signIn: jest.Mock}} = {};
// A getter: the factory runs when the import below is hoisted, before mockNative exists.
jest.mock('react-native', () => ({get NativeModules() {return mockNative;}, Platform: {OS: 'ios'}}));

import {signInWithGoogleNonce, NATIVE_ERROR_CODES} from '../googleIdToken';
import {GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID} from '../../config/GoogleAuthConfig';

const NONCE = '1dd297f01d4567260b8519ab54aabdf7138fe1b04c89a3aea3c05a1f82a0e0ff';

beforeEach(() => {
  mockNative.GoogleIdToken = {signIn: jest.fn()};
});

it('sends the nonce with the WEB client id as server client id, and the iOS client id', async () => {
  mockNative.GoogleIdToken!.signIn.mockResolvedValue({idToken: 'a.b.c'});
  await expect(signInWithGoogleNonce(NONCE)).resolves.toEqual({idToken: 'a.b.c'});
  expect(mockNative.GoogleIdToken!.signIn).toHaveBeenCalledWith({
    nonce: NONCE,
    serverClientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
  });
  expect(GOOGLE_WEB_CLIENT_ID).toMatch(/^491923400813-5bb3up/);
});

it.each(['', 'abc', NONCE.toUpperCase(), `0x${NONCE}`, `${NONCE}0`])(
  'refuses a malformed nonce %p before opening any sheet',
  async nonce => {
    await expect(signInWithGoogleNonce(nonce)).rejects.toThrow(/64-hex nonce/);
    expect(mockNative.GoogleIdToken!.signIn).not.toHaveBeenCalled();
  },
);

it.each(NATIVE_ERROR_CODES)('maps native rejection %s to that code', async code => {
  mockNative.GoogleIdToken!.signIn.mockRejectedValue(Object.assign(new Error(`native ${code}`), {code}));
  const r = await signInWithGoogleNonce(NONCE);
  expect(r).toEqual({error: `native ${code} (code=${code})`, code, cancelled: code === 'CANCELLED'});
});

it('an unknown native code is UNKNOWN, never a cancel', async () => {
  mockNative.GoogleIdToken!.signIn.mockRejectedValue(Object.assign(new Error('boom'), {code: 'cancelled'}));
  await expect(signInWithGoogleNonce(NONCE)).resolves.toEqual(
    expect.objectContaining({code: 'UNKNOWN', cancelled: false}),
  );
});

it.each([
  ['nothing', undefined],
  ['null', null],
  ['an empty token', {idToken: ''}],
  ['a non-string token', {idToken: 42}],
  ['a bare string', 'a.b.c'],
])('a resolve with %s is NO_ID_TOKEN', async (_label, value) => {
  mockNative.GoogleIdToken!.signIn.mockResolvedValue(value);
  await expect(signInWithGoogleNonce(NONCE)).resolves.toEqual(
    expect.objectContaining({code: 'NO_ID_TOKEN', cancelled: false}),
  );
});

it('says the module is not linked instead of throwing when it is missing', async () => {
  delete mockNative.GoogleIdToken;
  await expect(signInWithGoogleNonce(NONCE)).resolves.toEqual(
    expect.objectContaining({code: 'UNKNOWN', error: expect.stringMatching(/not linked/)}),
  );
});

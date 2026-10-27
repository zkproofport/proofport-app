import {oidcBindingFor, signInBound, signInProviderFor} from '../oidcSignIn';
import {deriveOidcNonce} from '../oidcNonce';
import {signedIn, signInFailed} from '../../hooks/signInResult';
import {jwt} from './jwt';

const RID = '7f3c2a10-5b6e-4d8f-9a1b-2c3d4e5f6a7b';
const MINTED = '00000000-0000-4000-8000-000000000000';

describe('signInProviderFor', () => {
  it('maps google and microsoft to themselves, and no provider ("Any email") to Google', () => {
    expect(signInProviderFor('google')).toBe('google');
    expect(signInProviderFor('microsoft')).toBe('microsoft');
    expect(signInProviderFor(undefined)).toBe('google');
  });

  it.each(['Microsoft', 'GOOGLE', '', ' google', 'apple', 'toString', '__proto__', null, 0])(
    'refuses %p instead of signing in with Google',
    provider => {
      expect(() => signInProviderFor(provider)).toThrow(/Unknown OIDC provider/);
    },
  );
});

describe('oidcBindingFor', () => {
  it('a dApp request binds to the relay request id and never mints one', () => {
    const mint = jest.fn(() => MINTED);
    const b = oidcBindingFor('dapp-scope', RID, mint);
    expect(b).toEqual({scope: 'dapp-scope', requestId: RID, nonce: deriveOidcNonce('dapp-scope', RID)});
    expect(mint).not.toHaveBeenCalled();
  });

  it('an in-app proof binds to a freshly minted id', () => {
    const mint = jest.fn(() => MINTED);
    const b = oidcBindingFor('proofport:default', undefined, mint);
    expect(mint).toHaveBeenCalledTimes(1);
    expect(b).toEqual({scope: 'proofport:default', requestId: MINTED, nonce: deriveOidcNonce('proofport:default', MINTED)});
  });

  it.each(['req-1', RID.toUpperCase(), ''])('refuses a relay request id that is not a lowercase UUID (%p)', id => {
    expect(() => oidcBindingFor('s', id, () => MINTED)).toThrow(/lowercase UUID/);
  });

  it.each([undefined, null, 7, {}])('refuses a missing or non-string scope (%p)', scope => {
    expect(() => oidcBindingFor(scope, RID, () => MINTED)).toThrow(/no scope/);
  });

  it('refuses an empty scope rather than filling one in', () => {
    expect(() => oidcBindingFor('  ', RID, () => MINTED)).toThrow(/empty/);
  });
});

describe('signInBound', () => {
  const nonce = deriveOidcNonce('s', RID);

  it('asks the provider for exactly this nonce and accepts a token carrying it', async () => {
    const token = jwt({nonce, email: 'a@corp.com'});
    const prompt = jest.fn(async () => signedIn(token));
    await expect(signInBound(prompt, nonce)).resolves.toEqual({token});
    expect(prompt).toHaveBeenCalledWith(nonce);
  });

  it.each([
    ['no nonce', jwt({email: 'a@corp.com'})],
    ['another request’s nonce', jwt({nonce: deriveOidcNonce('s', MINTED)})],
    ['a random nonce like the old Microsoft one', jwt({nonce: 'k3j4h5g6'})],
    ['a malformed token', 'not-a-jwt'],
  ])('refuses a token with %s as E2012, not cancelled', async (_label, token) => {
    const r = await signInBound(async () => signedIn(token), nonce);
    expect(r).toEqual(expect.objectContaining({code: 'E2012', cancelled: false}));
    expect('token' in r).toBe(false);
  });

  it('passes a provider failure through as E2008 with its reason', async () => {
    const r = await signInBound(async () => signInFailed('keychain error -2'), nonce);
    expect(r).toEqual({error: 'keychain error -2', cancelled: false, code: 'E2008'});
  });

  it('keeps a dismissed sheet a cancel', async () => {
    const r = await signInBound(async () => signInFailed('closed', true), nonce);
    expect(r).toEqual({error: 'closed', cancelled: true, code: 'E2008'});
  });
});

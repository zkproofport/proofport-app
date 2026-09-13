/**
 * A failed sign-in carries its reason. It is not left in state to be read.
 *
 * Both identity hooks answered `string | null` and kept the reason in their own
 * `error`. A caller reading that immediately after `await promptSignIn()` gets
 * the value from the render still in flight — `null`, because the hook clears
 * it when sign-in starts. So the proof screen printed "Sign-In was cancelled"
 * for every failure: a dismissed sheet, a keychain problem, a missing token.
 *
 * On 2026-09-12 that hid a real one. The log read
 *
 *     [9:36:22] [OIDC] Starting Google Sign-In...
 *     [9:36:40] [Error] Google Sign-In was cancelled
 *
 * — eighteen seconds, a person who had completed the login twice, and a
 * sentence saying they had cancelled. An earlier fix in the same session read
 * `authHook.error` right after the await and changed nothing, because the
 * problem was never which value to read; it was reading state at all.
 */
import * as fs from 'fs';
import * as path from 'path';
import {signedIn, signInFailed} from '../signInResult';

const HOOKS = path.resolve(__dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(HOOKS, ...p), 'utf8');

const SIGN_IN_HOOKS = ['useGoogleAuth.ts', 'useMicrosoftAuth.ts'];

describe('a sign-in says why it failed', () => {
  it('carries a token, or a reason and whether the person cancelled', () => {
    const ok = signedIn('id-token');
    expect('token' in ok && ok.token).toBe('id-token');

    const dismissed = signInFailed('the sheet was closed', true);
    expect('token' in dismissed).toBe(false);
    expect(!('token' in dismissed) && dismissed.cancelled).toBe(true);

    const broke = signInFailed('keychain error -2');
    // Not cancelled unless said so: everything was being called a cancel.
    expect(!('token' in broke) && broke.cancelled).toBe(false);
  });

  it.each(SIGN_IN_HOOKS)('%s answers with that shape, not string | null', file => {
    const src = read(file);
    expect(src).toContain('Promise<SignInResult>');
    expect(src).not.toContain('promptSignIn: () => Promise<string | null>');
  });

  it.each(SIGN_IN_HOOKS)('%s never returns a bare null for a failure', file => {
    const src = read(file);
    // A bare `return null` is a failure with no reason attached.
    expect(src).not.toMatch(/\n\s*return null;/);
  });

  it.each(SIGN_IN_HOOKS)('%s returns its failures rather than throwing some', file => {
    // The proof screen handled a thrown error and a returned one in two
    // different branches, and only one of them showed the reason.
    const src = read(file);
    const inPrompt = src.slice(src.indexOf('const promptSignIn'), src.indexOf('const reset'));
    expect(inPrompt).not.toMatch(/throw new Error\(msg\)/);
  });

  it('makes the proof screen read the returned reason, never the hook state', () => {
    const screen = fs.readFileSync(
      path.join(HOOKS, '..', 'screens', 'proof', 'ProofGenerationScreen.tsx'),
      'utf8',
    );
    expect(screen).toContain("if (!('token' in signIn))");
    expect(screen).toContain('signIn.error');
    expect(screen).toContain('signIn.cancelled');
    // The stale read, and the branch it lived in.
    expect(screen).not.toContain('authHook.error');
    expect(screen).not.toContain('if (!jwtToken)');
  });

  it('says "cancelled" only when the person actually cancelled', () => {
    const screen = fs.readFileSync(
      path.join(HOOKS, '..', 'screens', 'proof', 'ProofGenerationScreen.tsx'),
      'utf8',
    );
    expect(screen).toMatch(/signIn\.cancelled\s*\n?\s*\?\s*`\$\{providerName\} Sign-In was cancelled`/);
  });
});

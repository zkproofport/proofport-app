/**
 * A wallet's refusal reaches the log and the screen in the wallet's words.
 *
 * On 2026-10-30 a Coinbase Country proof with a typed "Deposit" action ended
 * at E4002 "Signature failed: [object Object]". WalletConnect rejects with the
 * JSON-RPC error member as a plain object, and every signing hook stringified
 * it with `String(e)`. These cases are the shapes that member arrives in.
 */
import * as fs from 'fs';
import * as path from 'path';

import {describeWalletError, signingFailure, walletErrorParts} from '../walletError';
import {WALLET_REJECTED_PREFIX, rejectedInWallet} from '../walletRejection';

describe('describeWalletError', () => {
  it('keeps code and message of a plain JSON-RPC error object', () => {
    const text = describeWalletError({code: -32603, message: 'Provided chainId "84532" must match the active chainId "8453"'});
    expect(text).toBe('Provided chainId "84532" must match the active chainId "8453" (code -32603)');
    expect(text).not.toContain('[object Object]');
  });

  it('adds the message nested in data', () => {
    expect(describeWalletError({code: -32603, message: 'Internal JSON-RPC error.', data: {message: 'execution reverted'}}))
      .toBe('Internal JSON-RPC error. (code -32603): execution reverted');
  });

  it('adds data when it is a string, and not when it repeats the message', () => {
    expect(describeWalletError({code: 1, message: 'a', data: 'b'})).toBe('a (code 1): b');
    expect(describeWalletError({code: 1, message: 'a', data: {message: 'a'}})).toBe('a (code 1)');
  });

  it('unwraps an {error: {...}} wrapper', () => {
    expect(describeWalletError({error: {code: 4100, message: 'Unauthorized'}})).toBe('Unauthorized (code 4100)');
  });

  it('keeps an Error message, with its code when it has one', () => {
    expect(describeWalletError(new Error('boom'))).toBe('boom');
    expect(describeWalletError(Object.assign(new Error('nope'), {code: 4001}))).toBe('nope (code 4001)');
  });

  it('keeps a string code', () => {
    expect(walletErrorParts({code: 'ACTION_REJECTED', message: 'x'}).code).toBe('ACTION_REJECTED');
  });

  it.each([
    [{code: 5}, '{"code":5} (code 5)'],
    [{foo: 'bar'}, '{"foo":"bar"}'],
    [{}, 'The wallet returned an error with no message.'],
    ['   ', 'The wallet returned an empty error.'],
    ['plain text', 'plain text'],
    [null, 'The wallet returned no error detail (null).'],
    [undefined, 'The wallet returned no error detail (undefined).'],
    [42, 'The wallet returned no error detail (42).'],
  ])('never answers [object Object] for %p', (input, expected) => {
    expect(describeWalletError(input)).toBe(expected);
  });

  it('survives circular data and BigInts', () => {
    const circular: Record<string, unknown> = {big: BigInt(7)};
    circular.self = circular;
    const text = describeWalletError(circular);
    expect(text).toContain('[circular]');
    expect(text).toContain('7n');
  });

  it('keeps Korean, emoji and long messages whole', () => {
    const long = '서명 거부 🙅 '.repeat(500);
    expect(describeWalletError({code: -32000, message: long})).toBe(`${long.trim()} (code -32000)`);
  });
});

describe('signingFailure', () => {
  it('reports a plain-object refusal as "Signature failed" with the wallet words', () => {
    const e = signingFailure({code: -32603, message: 'Provided chainId "84532" must match the active chainId "8453"'});
    expect(e.message).toBe('Signature failed: Provided chainId "84532" must match the active chainId "8453" (code -32603)');
  });

  it.each([4001, 5000])('marks code %i as the person saying no', code => {
    const e = signingFailure({code, message: 'User rejected the request.'});
    expect(rejectedInWallet(e.message)).toBe(true);
    expect(e.message).toBe(`${WALLET_REJECTED_PREFIX}: User rejected the request. (code ${code})`);
  });

  it('recognises an already-pending request by code and by text, from a plain object', () => {
    expect(signingFailure({code: -32002, message: 'x'}).message).toBe('Signing request already pending. Please try again.');
    expect(signingFailure({code: -1, message: 'Request already pending'}).message).toBe('Signing request already pending. Please try again.');
  });
});

describe('every hook that asks a wallet to sign goes through signingFailure', () => {
  const hooksDir = path.join(__dirname, '../../hooks');
  const signers = fs
    .readdirSync(hooksDir)
    .filter(f => f.endsWith('.ts'))
    .filter(f => fs.readFileSync(path.join(hooksDir, f), 'utf8').includes('method: signed.method'));

  it('finds the four signing hooks', () => {
    expect(signers.sort()).toEqual(['useCoinbaseCountry.ts', 'useCoinbaseKyc.ts', 'useDojangPlayground.ts', 'useGiwaKyc.ts']);
  });

  it.each(['useCoinbaseCountry.ts', 'useCoinbaseKyc.ts', 'useDojangPlayground.ts', 'useGiwaKyc.ts'])('%s', file => {
    const src = fs.readFileSync(path.join(hooksDir, file), 'utf8');
    expect(src).toContain('throw signingFailure(signError)');
    expect(src).toContain('const errorMessage = describeWalletError(error)');
    expect(src).not.toMatch(/String\(signError\)/);
  });
});

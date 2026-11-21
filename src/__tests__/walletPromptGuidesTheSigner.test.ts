/**
 * While a proof waits on the wallet app, the proof screen says so and says
 * what the signature is for, in plain words (2026-11-21: two signatures per
 * proof, and people did not know they had to go to the wallet app twice).
 */
import * as fs from 'fs';
import * as path from 'path';
import {oprfRequestEip712Json, oprfRequestTypedData} from '@zkproofport-app/core';
import {promptingRequest, walletPromptFor, REUSE_GUARD_PRIMARY_TYPE, type WalletPrompt} from '../utils/walletPrompt';
import ko from '../i18n/locales/ko.json';
import en from '../i18n/locales/en.json';

const FROM = '0xD6C714247037E5201B7e3dEC97a3ab59a9d2F739';
const oprfJson = () =>
  oprfRequestEip712Json(oprfRequestTypedData({domainName: 'zkproofport.app', scopeName: 'proofport:kyc', deadline: 2_000_000_000, nowSeconds: 1_999_999_700}));

describe('walletPromptFor', () => {
  it('names the reuse-guard signature by the struct the app really sends', () => {
    expect(JSON.parse(oprfJson()).primaryType).toBe(REUSE_GUARD_PRIMARY_TYPE);
    expect(walletPromptFor('eth_signTypedData_v4', [FROM, oprfJson()])).toBe('reuseGuard');
    // A payload passed as an object reads the same.
    expect(walletPromptFor('eth_signTypedData_v4', [FROM, JSON.parse(oprfJson())])).toBe('reuseGuard');
  });

  it('calls the request signature a request, as message or as typed action', () => {
    expect(walletPromptFor('personal_sign', ['0x' + '11'.repeat(32), FROM])).toBe('request');
    const action = JSON.stringify({types: {EIP712Domain: [], Claim: []}, primaryType: 'Claim', domain: {}, message: {}});
    expect(walletPromptFor('eth_signTypedData_v4', [FROM, action])).toBe('request');
  });

  it('a typed payload it cannot read is still a signature being asked for', () => {
    for (const payload of ['', '{', 'null', '{"primaryType":7}', undefined, null, 42, '<script>', '한국어 ✍️']) {
      expect(walletPromptFor('eth_signTypedData_v4', [FROM, payload])).toBe('request');
    }
    expect(walletPromptFor('eth_signTypedData_v4', undefined)).toBe('request');
    // Near-misses of the struct name are not the reuse guard.
    for (const name of ['oprfrequest', 'OprfRequest ', 'OprfRequestX', '']) {
      expect(walletPromptFor('eth_signTypedData_v4', [FROM, JSON.stringify({primaryType: name})])).toBe('request');
    }
  });

  it('a chain switch or add is a network prompt', () => {
    expect(walletPromptFor('wallet_switchEthereumChain', [{chainId: '0x1'}])).toBe('network');
    expect(walletPromptFor('wallet_addEthereumChain', [{chainId: '0x1'}])).toBe('network');
  });

  it('a read never prompts', () => {
    for (const m of ['eth_chainId', 'eth_accounts', 'eth_requestAccounts_', 'eth_call', '', 'PERSONAL_SIGN', 'eth_sign']) {
      expect(walletPromptFor(m, [])).toBeNull();
    }
  });
});

describe('promptingRequest', () => {
  it('shows the prompt while the wallet waits and clears it on approval', async () => {
    const seen: Array<WalletPrompt | null> = [];
    let release!: (v: string) => void;
    const send = jest.fn(() => new Promise<unknown>(r => { release = r as (v: string) => void; }));
    const request = promptingRequest(send, p => seen.push(p));
    const pending = request({method: 'eth_signTypedData_v4', params: [FROM, oprfJson()]});
    expect(seen).toEqual(['reuseGuard']);
    release('0xsig');
    await expect(pending).resolves.toBe('0xsig');
    expect(seen).toEqual(['reuseGuard', null]);
    expect(send).toHaveBeenCalledWith('eth_signTypedData_v4', [FROM, oprfJson()]);
  });

  it('clears the prompt when the person refuses in the wallet', async () => {
    const seen: Array<WalletPrompt | null> = [];
    const refusal = {code: 4001, message: 'User rejected'};
    const request = promptingRequest(() => Promise.reject(refusal), p => seen.push(p));
    await expect(request({method: 'personal_sign', params: ['0x00', FROM]})).rejects.toBe(refusal);
    expect(seen).toEqual(['request', null]);
  });

  it('a read passes through without touching the prompt, params defaulting to []', async () => {
    const onPrompt = jest.fn();
    const send = jest.fn(async () => '0x1');
    await promptingRequest(send, onPrompt)({method: 'eth_chainId'});
    expect(onPrompt).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('eth_chainId', []);
  });
});

describe('the proof screen', () => {
  const screen = fs.readFileSync(path.join(__dirname, '../screens/proof/ProofGenerationScreen.tsx'), 'utf8');

  it('sends every wallet request through the prompting wrapper', () => {
    // Three places build the wallet provider (Dojang, Human Passport, the
    // Coinbase/GIWA path); a raw provider.send wrapper would sign silently.
    expect(screen.match(/promptingRequest\(\(method, params\) => provider\.send\(method, params\), setWalletPrompt\)/g)).toHaveLength(3);
    expect(screen).not.toMatch(/request: async \(args[^)]*\) =>\s*provider\.send/);
  });

  it('shows the reuse-guard step while the hook obtains it', () => {
    expect(screen).toMatch(/scope: 'reuse_guard'/);
    expect(screen).toMatch(/'signing', 'reuse_guard',\n\]\);/);
  });
});

describe('the wording', () => {
  const generation = (l: typeof ko) => (l as any).host.proof.generation;
  it.each([['ko', ko], ['en', en]])('%s has every prompt and step label, with no protocol terms', (_lang, locale) => {
    const g = generation(locale);
    for (const kind of ['request', 'reuseGuard', 'network'] as WalletPrompt[]) {
      for (const field of ['title', 'body']) {
        const text: string = g.walletPrompt[kind][field];
        expect(typeof text).toBe('string');
        expect(text.trim().length).toBeGreaterThan(0);
        expect(text).not.toMatch(/EIP|712|OPRF|nullifier|typed|TACEO|personal_sign/i);
      }
    }
    expect(g.steps.reuse_guard).toBeTruthy();
    expect(g.steps.signing).toBeTruthy();
  });
});

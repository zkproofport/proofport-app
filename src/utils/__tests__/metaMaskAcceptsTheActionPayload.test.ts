/**
 * The typed-data request the app sends for a Coinbase Country "Deposit" action
 * passes MetaMask's own checks, and differs from KYC's in nothing but its
 * content.
 *
 * Asked on 2026-10-30, when a Country proof with a Deposit action ended at
 * "Signature failed: [object Object]". The action is the Action screen's
 * starting values (src/screens/proof/ActionInputScreen.tsx), the payload is
 * what `whatTheWalletSigns` puts on the wire. The checks are those MetaMask
 * runs on `eth_signTypedData_v4`, from @metamask/eth-json-rpc-middleware 24.0.2
 * (src/wallet.ts: validatePrimaryType, validateVerifyingContract) and
 * @metamask/signature-controller 39.2.10 (src/utils/validation.ts:
 * TYPED_MESSAGE_SCHEMA, and "Provided chainId must match the active chainId"),
 * using the schema and the hash from @metamask/eth-sig-util itself.
 *
 * Result: the payload is valid whenever the wallet is on the circuit's chain,
 * and refused with that chain-id sentence when it is not -- the one rule of
 * theirs it can fail.
 */
jest.mock('react-native', () => ({NativeModules: {}}));

import {TYPED_MESSAGE_SCHEMA, TypedDataUtils, SignTypedDataVersion} from '@metamask/eth-sig-util';
import {validate} from 'jsonschema';

import {getNetworkConfigForCircuit} from '../../config/environment';
import type {CircuitName} from '../../config/circuitIds';
import {whatTheWalletSigns} from '../signedAction';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The Deposit action with the Action screen's starting values, on this circuit's chain. */
function depositFor(circuit: CircuitName) {
  return {
    domain: {
      name: 'MyVault',
      version: '1',
      chainId: getNetworkConfigForCircuit(circuit).chainId,
      verifyingContract: '0x0000000000000000000000000000000000000000',
    },
    types: {Deposit: [{name: 'amount', type: 'uint256'}, {name: 'nonce', type: 'uint256'}]},
    primaryType: 'Deposit',
    message: {amount: '1000000', nonce: '1'},
  };
}

/** MetaMask's checks on an eth_signTypedData_v4 payload, in the order it runs them. */
function metaMaskRefusal(payload: string, activeChainIdHex: string): string | undefined {
  const data = JSON.parse(payload);
  if (!data.types?.[String(data.primaryType).replace(/\[.*\]$/, '')]) return 'invalid input: primaryType';
  const vc = data.domain?.verifyingContract;
  if (vc && vc !== 'cosmos' && !ADDRESS.test(vc)) return 'invalid input: verifyingContract';
  if (validate(data, TYPED_MESSAGE_SCHEMA).errors.length > 0) {
    return 'Data must conform to EIP-712 schema. See https://git.io/fNtcx.';
  }
  let {chainId} = data.domain;
  if (chainId) {
    if (typeof chainId === 'string') chainId = parseInt(chainId, chainId.startsWith('0x') ? 16 : 10);
    const active = parseInt(activeChainIdHex, 16);
    if (chainId !== active) return `Provided chainId "${chainId}" must match the active chainId "${active}"`;
  }
  return undefined;
}

const ZERO_SIGNAL = `0x${'00'.repeat(32)}`;

describe.each(['coinbase_country_attestation', 'coinbase_attestation'] as const)('%s Deposit action', circuit => {
  const action = depositFor(circuit);
  const signed = whatTheWalletSigns(ZERO_SIGNAL, action);
  const payload = signed.params[0] as string;
  const chainHex = `0x${getNetworkConfigForCircuit(circuit).chainId.toString(16)}`;

  it('is signed with eth_signTypedData_v4 over one JSON string', () => {
    expect(signed.method).toBe('eth_signTypedData_v4');
    expect(signed.params).toHaveLength(1);
    expect(typeof payload).toBe('string');
  });

  it("passes every MetaMask check when the wallet is on the circuit's chain", () => {
    expect(metaMaskRefusal(payload, chainHex)).toBeUndefined();
  });

  it('is refused only for the chain when the wallet is elsewhere', () => {
    expect(metaMaskRefusal(payload, '0x2105')).toMatch(/must match the active chainId "8453"/);
  });

  it('hashes, in MetaMask, to the digest the app recovers against', () => {
    const mm = `0x${Buffer.from(TypedDataUtils.eip712Hash(JSON.parse(payload), SignTypedDataVersion.V4)).toString('hex')}`;
    expect(mm).toBe(signed.digest.toLowerCase());
  });
});

describe('Country and KYC send the same request shape', () => {
  it('differ in nothing but the chain they are configured for', () => {
    const country = JSON.parse(whatTheWalletSigns(ZERO_SIGNAL, depositFor('coinbase_country_attestation')).params[0] as string);
    const kyc = JSON.parse(whatTheWalletSigns(ZERO_SIGNAL, depositFor('coinbase_attestation')).params[0] as string);
    expect({...country, domain: {...country.domain, chainId: 0}}).toEqual({...kyc, domain: {...kyc.domain, chainId: 0}});
  });
});

describe('the schema check is live', () => {
  it('refuses a payload that drops EIP712Domain from types', () => {
    const data = JSON.parse(whatTheWalletSigns(ZERO_SIGNAL, depositFor('coinbase_country_attestation')).params[0] as string);
    data.types = 'nope';
    expect(metaMaskRefusal(JSON.stringify(data), '0x14a34')).toBeDefined();
  });
});

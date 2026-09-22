import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

const mockNavigate = jest.fn();
let mockCircuit = 'arc_eligibility';
const mockNavigation = {navigate: mockNavigate};
const mockT = (key: string) => key;

jest.mock('react-native', () => ({
  NativeModules: {},
  StyleSheet: {create: (styles: unknown) => styles},
  ScrollView: 'ScrollView', Text: 'Text', View: 'View', SafeAreaView: 'SafeAreaView',
  TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity',
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({params: {circuit: mockCircuit}}),
}));
jest.mock('react-i18next', () => ({useTranslation: () => ({t: mockT})}));
jest.mock('../../components/ui', () => ({
  Button: 'Button', Card: 'Card', Divider: 'Divider', Icon: 'Icon',
  KeyboardSafeScroll: 'KeyboardSafeScroll', Select: 'Select', CircuitCard: 'CircuitCard',
}));
jest.mock('../../context', () => ({
  useThemeColors: () => ({colors: {
    background: {}, text: {}, border: {}, info: {}, warning: {}, error: {},
  }}),
}));
jest.mock('../../hooks', () => ({
  useSettings: () => ({
    settings: {developerMode: true, defaultNetwork: 'giwa'}, loading: false,
    updateSettings: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock('../../config', () => ({
  ...jest.requireActual('../../config/circuitIds'),
  ...jest.requireActual('../../config/environment'),
  ...jest.requireActual('../../config/networks'),
}));
jest.mock('../../utils', () => ({
  ...jest.requireActual('../../utils/signedAction'),
  ...jest.requireActual('../../utils/walletChain'),
  getCircuitIcon: () => 'shield',
  allCircuitFilesExist: async () => true,
  loadVkFromAssets: async () => new ArrayBuffer(0),
}));
// Native proving and chain lookup are outside this UI/signing boundary test.
// The provider stops at the signature request, before proof generation.
jest.mock('mopro-ffi', () => ({}));
jest.mock('../../utils/giwaKyc', () => ({
  GIWA_AUTHORIZED_SIGNERS: ['0x1111111111111111111111111111111111111111'],
  verifyGiwaAttestationTx: () => ({valid: true, signerAddress: '0x1111111111111111111111111111111111111111'}),
}));

import {CircuitSelectionScreen} from '../proof/CircuitSelectionScreen';
import {ArcActionInputScreen} from '../proof/ArcActionInputScreen';
import {useGiwaKyc, type UseGiwaKycReturn} from '../../hooks/useGiwaKyc';
import {whatTheWalletSigns} from '../../utils/signedAction';
import type {TypedAction} from '../../utils/typedAction';

let tree: TestRenderer.ReactTestRenderer;
let errorSpy: jest.SpyInstance;
beforeEach(() => {
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
  mockCircuit = 'arc_eligibility';
  mockNavigate.mockClear();
  const original = console.error;
  errorSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
    if (String(args[0]).startsWith('react-test-renderer is deprecated.')) return;
    original(...args);
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  errorSpy.mockRestore();
});
async function mount(component: React.ComponentType) {
  await act(async () => { tree = TestRenderer.create(React.createElement(component)); });
}
function button(key: string) {
  return tree.root.findAllByType('Button' as never).find(b => b.props.title === key);
}
function generateAction(): TypedAction {
  act(() => button('host.proof.arcAction.generate')!.props.onPress());
  return mockNavigate.mock.calls.at(-1)![1].action;
}

describe('standalone GIWA action input', () => {
  it('opens action inputs directly from the GIWA circuit card', async () => {
    await mount(CircuitSelectionScreen);
    const card = tree.root.findAllByType('CircuitCard' as never).find(c => c.props.title === 'host.proof.circuitSelection.giwaKyc.title');
    expect(card).toBeDefined();
    act(() => card!.props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('ArcActionInput', {circuit: 'giwa_attestation'});
  });

  it('builds a readable Deposit request on GIWA without a relay request', async () => {
    mockCircuit = 'giwa_attestation';
    await mount(ArcActionInputScreen);
    const action = generateAction();
    const signed = whatTheWalletSigns('0x' + '00'.repeat(32), action);
    expect(mockNavigate.mock.calls.at(-1)![1].circuitId).toBe('giwa_attestation');
    expect(signed.method).toBe('eth_signTypedData_v4');
    expect(JSON.parse(signed.params[0] as string)).toMatchObject({
      domain: {name: 'MyVault', chainId: 91342},
      primaryType: 'Deposit', message: {amount: '1000000', nonce: '1'},
    });
  });

  it('rebuilds the signed domain when only the circuit selection changes', async () => {
    await mount(ArcActionInputScreen);
    expect(generateAction().domain.chainId).toBe(5042002);
    const select = tree.root.findAllByType('Select' as never).find(s => s.props.label === 'host.proof.arcAction.circuitLabel');
    act(() => select!.props.onChange('giwa_attestation'));
    expect(generateAction().domain.chainId).toBe(91342);
    act(() => select!.props.onChange('arc_eligibility'));
    expect(generateAction().domain.chainId).toBe(5042002);
  });

  it('keeps an explicit way to generate GIWA identity without an action', async () => {
    mockCircuit = 'giwa_attestation';
    await mount(ArcActionInputScreen);
    const identity = button('host.proof.arcAction.identityOnly');
    expect(identity).toBeDefined();
    act(() => identity!.props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('ProofGeneration', {circuitId: 'giwa_attestation'});
  });
});

describe('GIWA wallet request', () => {
  it('switches to GIWA before asking the wallet to sign typed action data', async () => {
    let hook!: UseGiwaKycReturn;
    function Harness() { hook = useGiwaKyc(); return null; }
    await mount(Harness);
    const calls: Array<{method: string; params?: unknown[]}> = [];
    const wallet = {
      request: async (request: {method: string; params?: unknown[]}) => {
        calls.push(request);
        if (request.method === 'eth_chainId') return '0x1';
        if (request.method === 'wallet_switchEthereumChain') return null;
        throw new Error('Signature prompt captured; test stops before signing');
      },
    };
    await act(async () => hook.generateProofWithSteps({
      userAddress: '0x2222222222222222222222222222222222222222',
      rawTransaction: 'validated-by-fixture', signerIndex: 0, scopeString: 'standalone-test',
      action: {
        domain: {name: 'MyVault', version: '1', chainId: 91342, verifyingContract: '0x0000000000000000000000000000000000000000'},
        types: {Deposit: [{name: 'amount', type: 'uint256'}, {name: 'nonce', type: 'uint256'}]},
        primaryType: 'Deposit', message: {amount: '1000000', nonce: '1'},
      },
    }, wallet, () => {}));
    expect(calls.map(c => c.method)).toEqual(['eth_chainId', 'wallet_switchEthereumChain', 'eth_signTypedData_v4']);
    expect(calls[1].params).toEqual([{chainId: '0x164ce'}]);
    expect(JSON.parse(calls[2].params![1] as string)).toMatchObject({domain: {chainId: 91342}, primaryType: 'Deposit'});
  });
});

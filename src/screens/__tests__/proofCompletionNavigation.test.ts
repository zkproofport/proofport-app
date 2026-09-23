import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {execFileSync} from 'node:child_process';
import type {ProofRequest} from '../../utils/deeplink';

const mockActions: object[] = [];
const mockResetCache = jest.fn();
const mockNavigation = {
  popToTop: () => mockActions.push({type: 'POP_TO_TOP'}),
  reset: (payload: object) => mockActions.push({type: 'RESET', payload}),
  navigate: (...args: unknown[]) => {
    const [destination, params] = args;
    mockActions.push({type: 'NAVIGATE', payload: typeof destination === 'string'
      ? {name: destination, params} : destination});
  },
};
const mockRoute = {params: {
  circuitId: 'oidc_domain_attestation', proofHex: '0x1234', timestamp: '1750000000000',
  verification: {offChain: null, onChain: null, verifierContract: '', chainName: 'Test', explorerUrl: ''},
}};
const mockProofHook = () => ({resetProofCache: mockResetCache});

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', SafeAreaView: 'SafeAreaView', ScrollView: 'ScrollView',
  TouchableOpacity: 'TouchableOpacity', ActivityIndicator: 'ActivityIndicator',
  StyleSheet: {create: (styles: unknown) => styles}, Alert: {alert: jest.fn()},
}));
jest.mock('@react-native-clipboard/clipboard', () => ({setString: jest.fn()}));
jest.mock('@react-navigation/native', () => ({useNavigation: () => mockNavigation, useRoute: () => mockRoute}));
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({Navigator: 'StackNavigator', Screen: 'StackScreen'}),
}));
jest.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key, i18n: {language: 'en'}})}));
jest.mock('../../components/ui', () => ({Icon: 'Icon', Badge: 'Badge', Button: 'Button', Card: 'Card'}));
jest.mock('../../context', () => ({useThemeColors: () => ({colors: jest.requireActual('../../theme').darkColors})}));
jest.mock('../../hooks', () => ({
  useCoinbaseKyc: () => mockProofHook(), useCoinbaseCountry: () => mockProofHook(),
  useOidcDomain: () => mockProofHook(), useGiwaKyc: () => mockProofHook(),
  useLogs: () => ({logs: [], addLog: jest.fn()}),
}));
jest.mock('../../hooks/useMdlKr', () => ({useMdlKr: () => mockProofHook()}));
jest.mock('../../stores', () => ({proofHistoryStore: {update: jest.fn()}}));
jest.mock('../../config', () => ({...jest.requireActual('../../config/circuitIds')}));
jest.mock('../../utils', () => ({getCircuitDisplayName: () => 'Organization'}));
// Native rendering and proving are outside this navigation regression. The
// registered screen names, completion callbacks and installed router stay real.
jest.mock('../proof', () => ({
  CircuitSelectionScreen: 'CircuitSelection', LaboratoryScreen: 'Laboratory',
  CountryInputScreen: 'CountryInput', DomainInputScreen: 'DomainInput', MdlKrInputScreen: 'MdlKrInput',
  ArcActionInputScreen: 'ArcActionInput', ProofGenerationScreen: 'ProofGeneration', ProofCompleteScreen: 'ProofComplete',
}));
jest.mock('../auth/OacxWebViewScreen', () => ({OacxWebViewScreen: 'OacxWebView'}));
jest.mock('../shared/InAppBrowserScreen', () => ({InAppBrowserScreen: 'InAppBrowser'}));
jest.mock('../../navigation/shared', () => ({useStackScreenOptions: () => ({})}));

import ProofStackNavigator from '../../navigation/stacks/ProofStackNavigator';
import {ProofCompleteScreen} from '../proof/ProofCompleteScreen';
import {filterProofCatalog} from '../proof/proofCatalog';
import {clearActiveProofRequest, getActiveProofRequest, setActiveProofRequest} from '../../stores/activeProofRequestStore';

let trees: ReactTestRenderer[];
let errors: jest.SpyInstance;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  trees = [];
  mockActions.length = 0;
  mockResetCache.mockClear();
  clearActiveProofRequest();
  const originalError = console.error;
  errors = jest.spyOn(console, 'error').mockImplementation((...args) => {
    if (String(args[0]).startsWith('react-test-renderer is deprecated.')) return;
    originalError(...args);
  });
});
afterEach(() => {
  act(() => trees.forEach(tree => tree.unmount()));
  clearActiveProofRequest();
  errors.mockRestore();
});
function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  act(() => {tree = create(element);});
  trees.push(tree);
  return tree;
}
function completionExit(exit: 'done' | 'another') {
  const navigator = render(React.createElement(ProofStackNavigator));
  const screens = navigator.root.findAllByType('StackScreen' as never);
  const routeNames = screens.map(screen => screen.props.name);
  if (exit === 'done') {
    const complete = screens.find(screen => screen.props.name === 'ProofComplete')!;
    const options = complete.props.options({navigation: mockNavigation});
    const header = render(options.headerRight());
    return {routeNames, press: header.root.findByType('TouchableOpacity' as never).props.onPress};
  }
  const complete = render(React.createElement(ProofCompleteScreen));
  return {routeNames, press: complete.root.findAllByType('Button' as never)
    .find(button => button.props.title === 'host.proof.complete.generateAnother')!.props.onPress};
}
function applyToStack(routeNames: string[], initialRoutes: string[], actions: object[]) {
  // Jest runs CommonJS; load the installed ESM router in Node without replacing
  // its reset/pop semantics with a hand-written navigation mock.
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import {StackRouter} from '@react-navigation/routers';
    import {readFileSync} from 'node:fs';
    const {routeNames, initialRoutes, actions} = JSON.parse(readFileSync(0, 'utf8'));
    const router = StackRouter({initialRouteName: 'CircuitSelection'});
    const options = {routeNames, routeParamList: {}, routeGetIdList: {}};
    let state = router.getRehydratedState({stale: true, index: initialRoutes.length - 1,
      routes: initialRoutes.map(name => ({name}))}, options);
    const originalGenerationKey = state.routes.find(route => route.name === 'ProofGeneration')?.key;
    const snapshots = [];
    for (const action of actions) {
      const next = router.getStateForAction(state, action, options);
      state = next ? router.getRehydratedState(next, options) : state;
      snapshots.push(state);
    }
    process.stdout.write(JSON.stringify({originalGenerationKey, snapshots}));
  `], {input: JSON.stringify({routeNames, initialRoutes, actions}), encoding: 'utf8'}));
}

const entryStacks = [
  ['standalone', ['CircuitSelection', 'ProofGeneration', 'ProofComplete']],
  ['cold deep link', ['ProofGeneration', 'ProofComplete']],
  ['single completion route', ['ProofComplete']],
  ['laboratory', ['CircuitSelection', 'Laboratory', 'ArcActionInput', 'ProofGeneration', 'ProofComplete']],
] as const;

describe.each(['done', 'another'] as const)('%s completion exit', exit => {
  it.each(entryStacks)('returns %s to the catalog and allows a fresh proof', (_entry, initialRoutes) => {
    const {routeNames, press} = completionExit(exit);
    act(() => {press(); press();});
    // Start the next proof through the real catalog's card callback.
    filterProofCatalog('home', 'identity', '', key => key)[0].open(mockNavigation);
    const result = applyToStack(routeNames, [...initialRoutes], mockActions);
    expect(result.snapshots[0].routes.map((route: any) => route.name)).toEqual(['CircuitSelection']);
    expect(result.snapshots[1].routes.map((route: any) => route.name)).toEqual(['CircuitSelection']);
    const next = result.snapshots[2];
    expect(next.routes.map((route: any) => route.name)).toEqual(['CircuitSelection', 'ProofGeneration']);
    expect(next.routes[next.index].params.circuitId).toBe('coinbase_attestation');
    expect(next.routes[next.index].key).not.toBe(result.originalGenerationKey);
    if (exit === 'another') expect(mockResetCache).toHaveBeenCalledTimes(2);
  });

  it('does not clear a newer approved request or change its callback', () => {
    const {press} = completionExit(exit);
    const next = {requestId: 'new', circuit: 'oidc_domain_attestation',
      callbackUrl: 'https://relay.example/new', createdAt: 1, inputs: {scope: 'new'}} as ProofRequest;
    setActiveProofRequest(next);
    act(() => press());
    expect(getActiveProofRequest()).toBe(next);
    expect(getActiveProofRequest()?.callbackUrl).toBe('https://relay.example/new');
  });
});

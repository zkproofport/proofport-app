import type { ProofRequest } from '../utils/deeplink';
import type { CircuitName } from '../config/circuitIds';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type TabParamList = {
  ProofTab: NavigatorScreenParams<ProofStackParamList>;
  WalletTab: NavigatorScreenParams<WalletStackParamList>;
  ScanTab: NavigatorScreenParams<ScanStackParamList>;
  // Only one of OpenStoaTab / HistoryTab is mounted at a time, gated by the
  // OPENSTOA_ENABLED build flag (see src/config/features.ts).
  OpenStoaTab: NavigatorScreenParams<OpenStoaStackParamList>;
  HistoryTab: NavigatorScreenParams<HistoryStackParamList>;
  MoreTab: NavigatorScreenParams<MoreStackParamList>;
};

// Stack for the History tab (used when OPENSTOA_ENABLED is false). Mirrors the
// HistoryMain / HistoryDetail routes that also live in MoreStackParamList.
export type HistoryStackParamList = {
  HistoryMain: undefined;
  HistoryDetail: { proofId: string };
};

export type ProofStackParamList = {
  CircuitSelection: undefined;
  CountryInput: undefined;
  DomainInput: undefined;
  MdlKrInput: { variant: 'ownership' | 'age' | 'region' };
  /**
   * Build an EIP-712 action for a circuit that can bind one.
   *
   * The circuit is a parameter, not a constant: arc_eligibility was the only
   * one when this screen was written, and giwa_attestation binds an action
   * too. Which circuits qualify comes from the SDK's action table, so the
   * screen never holds a list of its own.
   *
   * In the shipped product a dapp supplies the action through the SDK and
   * nobody reaches this screen; it exists to test circuits whose verifiers
   * live only on testnets, behind Developer Mode.
   */
  ArcActionInput: {circuit: CircuitName};
  /** OACX widget WebView screen. provider = OacxProvider string, scope = scopeString. */
  OacxWebView: { provider: string; scope: string };
  ProofGeneration: {
    circuitId: string;
    proofRequest?: ProofRequest;
    countryInputs?: { countryList: string[]; isIncluded: boolean };
    /**
     * Optional EIP-712 action for an action-capable circuit, supplied by the
     * standalone input screen or a deep link.
     */
    action?: import('../utils/typedAction').TypedAction;
    /** Scope override from an input screen. */
    scope?: string;
    domainInput?: { domain?: string; scope: string; provider?: string };
    mdlKrInputs?: {
      variant: 'ownership' | 'age' | 'region';
      /**
       * OmniOne CX document type:
       *   comdl_v1.5      = mobile driver's license
       *   comrc_v1.5      = mobile resident registration card
       *   comnh_v1.5      = mobile veterans (national-merit) card
       *   coresidence_v1.5 = alien registration card
       */
      provider?: 'comdl_v1.5' | 'comrc_v1.5' | 'comnh_v1.5' | 'coresidence_v1.5';
      discloseFlags?: number;
      expectedName?: string;
      expectedBirth?: string;
      expectedSex?: string;
      expectedTelno?: string;
      ageThreshold?: number;
      currentYear?: number;
      targetRegion?: string;
    };
  };
  ProofComplete: {
    proofHex: string;
    publicInputsHex: string[];
    numPublicInputs: number;
    circuitId: string;
    timestamp: string;
    verification: {
      offChain: boolean | null;
      onChain: boolean | null;
      verifierContract: string;
      chainName: string;
      explorerUrl: string;
    };
    walletAddress?: string;
    historyId?: string;
  };
  InAppBrowser: { url: string; title?: string };
};

// OpenStoa root stack — single screen that mounts the embedded OpenStoa
// mini-app via <HostProvider>. The mini-app owns its own bottom tab bar
// (Feed/Topics/Chat/Profile + a fake "ZKProofport" tab that calls
// host.exitToHost()).
export type OpenStoaStackParamList = {
  OpenStoaRoot: undefined;
};

export type WalletStackParamList = {
  WalletMain: undefined;
  InAppBrowser: { url: string; title?: string };
};

export type ScanStackParamList = {
  ScanMain: undefined;
  InAppBrowser: { url: string; title?: string };
};

export type MoreStackParamList = {
  MoreMain: undefined;
  About: undefined;
  HistoryMain: undefined;
  HistoryDetail: { proofId: string };
  SettingsLanguage: undefined;
  InAppBrowser: { url: string; title?: string };
};


export type OpenStoaTabScreenProps<T extends keyof OpenStoaStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<OpenStoaStackParamList, T>,
  BottomTabScreenProps<TabParamList>
>;

export type ProofTabScreenProps<T extends keyof ProofStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<ProofStackParamList, T>,
  BottomTabScreenProps<TabParamList>
>;

export type WalletTabScreenProps<T extends keyof WalletStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<WalletStackParamList, T>,
  BottomTabScreenProps<TabParamList>
>;

export type ScanTabScreenProps<T extends keyof ScanStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<ScanStackParamList, T>,
  BottomTabScreenProps<TabParamList>
>;

export type MoreTabScreenProps<T extends keyof MoreStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<MoreStackParamList, T>,
  BottomTabScreenProps<TabParamList>
>;

export type TabScreenProps<T extends keyof TabParamList> = BottomTabScreenProps<TabParamList, T>;

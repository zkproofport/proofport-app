import type { ProofRequest } from '../utils/deeplink';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type TabParamList = {
  ProofTab: NavigatorScreenParams<ProofStackParamList>;
  WalletTab: NavigatorScreenParams<WalletStackParamList>;
  ScanTab: NavigatorScreenParams<ScanStackParamList>;
  HistoryTab: NavigatorScreenParams<HistoryStackParamList>;
  MyInfoTab: NavigatorScreenParams<MyInfoStackParamList>;
};

export type ProofStackParamList = {
  CircuitSelection: undefined;
  CountryInput: undefined;
  ProofGeneration: { circuitId: string; proofRequest?: ProofRequest; countryInputs?: { countryList: string[]; isIncluded: boolean } };
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
};

export type WalletStackParamList = {
  WalletMain: undefined;
};

export type ScanStackParamList = {
  ScanMain: undefined;
};

export type HistoryStackParamList = {
  HistoryMain: undefined;
  HistoryDetail: { proofId: string };
};

export type MyInfoStackParamList = {
  MyInfoMain: undefined;
  Settings: undefined;
  Notifications: {type: string};
  Security: {type: string};
  Legal: undefined;
  About: {type: string};
};

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

export type HistoryTabScreenProps<T extends keyof HistoryStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<HistoryStackParamList, T>,
  BottomTabScreenProps<TabParamList>
>;

export type MyInfoTabScreenProps<T extends keyof MyInfoStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<MyInfoStackParamList, T>,
  BottomTabScreenProps<TabParamList>
>;

export type TabScreenProps<T extends keyof TabParamList> = BottomTabScreenProps<TabParamList, T>;

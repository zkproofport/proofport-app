import {
  createAppKit,
  type AppKitNetwork,
  type Storage,
} from '@reown/appkit-react-native';
import {EthersAdapter} from '@reown/appkit-ethers-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {mainnet as viemMainnet, base as viemBase} from 'viem/chains';

const projectId = '9a54a0419fc6c86a2bde3d44c4f1615c';

const metadata = {
  name: 'ZKProofport',
  description: 'ZK Proof Mobile App',
  url: 'https://zkproofport.com',
  icons: ['https://avatars.githubusercontent.com/u/37784886'],
  redirect: {
    native: 'zkproofport://',
  },
};

const mainnet: AppKitNetwork = {
  id: 1,
  name: 'Ethereum',
  chainNamespace: 'eip155',
  caipNetworkId: 'eip155:1',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ['https://cloudflare-eth.com'] },
  },
  blockExplorers: {
    default: { name: 'Etherscan', url: 'https://etherscan.io' },
  },
};

const base: AppKitNetwork = {
  id: 8453,
  name: 'Base',
  chainNamespace: 'eip155',
  caipNetworkId: 'eip155:8453',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ['https://mainnet.base.org'] },
  },
  blockExplorers: {
    default: { name: 'BaseScan', url: 'https://basescan.org' },
  },
};

const networks: AppKitNetwork[] = [mainnet, base];

const storage: Storage = {
  getItem: async <T = string>(key: string): Promise<T | undefined> => {
    try {
      const value = await AsyncStorage.getItem(key);
      if (value === null) return undefined;
      // Try to parse as JSON, fallback to raw value
      try {
        return JSON.parse(value) as T;
      } catch {
        return value as unknown as T;
      }
    } catch {
      return undefined;
    }
  },
  setItem: async <T = string>(key: string, value: T): Promise<void> => {
    try {
      // Serialize to JSON for storage
      const serialized =
        typeof value === 'string' ? value : JSON.stringify(value);
      await AsyncStorage.setItem(key, serialized);
    } catch (error) {
      console.warn('AppKit storage setItem error:', error);
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // Ignore removal errors
    }
  },
  getKeys: async (): Promise<string[]> => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      return [...keys];
    } catch {
      return [];
    }
  },
  getEntries: async <T = string>(): Promise<[string, T][]> => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const entries = await AsyncStorage.multiGet([...keys]);
      return entries.map(([key, value]) => {
        if (value === null) return [key, '' as unknown as T] as [string, T];
        try {
          return [key, JSON.parse(value) as T] as [string, T];
        } catch {
          return [key, value as unknown as T] as [string, T];
        }
      });
    } catch {
      return [];
    }
  },
};

export const appKit = createAppKit({
  projectId,
  networks: [viemMainnet, viemBase],
  adapters: [new EthersAdapter()],
  metadata,
  storage,
  debug: true,
  enableAnalytics: false,
});

export { projectId, metadata, networks };

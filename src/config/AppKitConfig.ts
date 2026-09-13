import {createAppKit, type Storage} from '@reown/appkit-react-native';
import {EthersAdapter} from '@reown/appkit-ethers-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {walletNetworks} from './walletNetworks';

const projectId = 'c1194f0c45c964d20fb24a52b2432af4';

const metadata = {
  name: 'ZKProofport',
  description: 'ZK Proof Mobile App',
  url: 'https://zkproofport.com',
  icons: ['https://avatars.githubusercontent.com/u/37784886'],
  redirect: {
    native: 'zkproofport://',
  },
};

/**
 * Every chain a circuit is pinned to, plus this build's own network.
 *
 * A WalletConnect session approves its chains once, at connection time, and
 * nothing outside that set can be signed for afterwards. This was `[mainnet,
 * base]` typed out by hand while circuits were pinned to Arc, GIWA and a Korea
 * mobile-ID network — so a wallet could never sign for any of them, and adding
 * the network inside MetaMask changed nothing because the session had not
 * asked for it. The symptom was an alert reading "Active chainId is 0x1 but
 * received 0x4cef52" with no way forward.
 */
const networks = walletNetworks();

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
  networks,
  adapters: [new EthersAdapter()],
  metadata,
  storage,
  debug: true,
  enableAnalytics: false,
});

export { projectId, metadata, networks };

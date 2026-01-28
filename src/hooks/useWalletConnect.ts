import {useState, useCallback, useEffect, useRef} from 'react';
import {Linking, Platform} from 'react-native';
import {
  useAppKit,
  useAccount,
  useProvider,
  useAppKitState,
  useAppKitEventSubscription,
} from '@reown/appkit-react-native';
import {ethers} from 'ethers';

// Store URLs for wallet apps
const WALLET_STORE_URLS = {
  metamask: {
    ios: 'https://apps.apple.com/app/metamask/id1438144202',
    android: 'https://play.google.com/store/apps/details?id=io.metamask',
  },
};

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface UseWalletConnectReturn {
  account: string | null;
  chainId: number | null;
  status: ConnectionStatus;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  isConnected: boolean;
  formattedAddress: string;
  signMessage: (message: string) => Promise<string>;
  getProvider: () => Promise<ethers.providers.Web3Provider | null>;
  getSigner: () => Promise<ethers.Signer | null>;
  openWalletStore: () => Promise<void>;
}

export const useWalletConnect = (addLog?: (msg: string) => void): UseWalletConnectReturn => {
  const {open, disconnect: appKitDisconnect} = useAppKit();
  const {address, isConnected, chainId: accountChainId} = useAccount();
  const {provider: walletProvider} = useProvider();
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const log = useCallback((msg: string) => {
    console.log(`🔗 ${msg}`);
    addLog?.(msg);
  }, [addLog]);

  // Track modal state to detect when modal closes
  const {isOpen: isModalOpen} = useAppKitState();
  const wasModalOpen = useRef(false);

  // Detect modal close and update connecting state
  useEffect(() => {
    if (wasModalOpen.current && !isModalOpen) {
      // Modal was open and now closed
      log('Modal closed');
      setIsConnecting(false);

      // If connected after modal close, clear any errors
      if (isConnected && address) {
        log('Connection successful!');
        setError(null);
      }
    }
    wasModalOpen.current = isModalOpen;
  }, [isModalOpen, isConnected, address, log]);

  // Subscribe to CONNECT_ERROR events
  useAppKitEventSubscription('CONNECT_ERROR', useCallback((event) => {
    log(`Connection error event: ${JSON.stringify(event.data)}`);
    setIsConnecting(false);
    setError('Failed to connect wallet');
  }, [log]));

  // chainId from useAccount - may be number or undefined
  const chainId = accountChainId ? Number(accountChainId) : null;

  function getStatus(): ConnectionStatus {
    if (isConnected && address) return 'connected';
    if (isConnecting) return 'connecting';
    if (error) return 'error';
    return 'disconnected';
  }

  const openWalletStore = useCallback(async () => {
    const storeUrl = Platform.OS === 'ios'
      ? WALLET_STORE_URLS.metamask.ios
      : WALLET_STORE_URLS.metamask.android;

    try {
      await Linking.openURL(storeUrl);
    } catch (e) {
      log('Failed to open store URL');
    }
  }, [log]);

  const connect = useCallback(async () => {
    // Clear previous error before new attempt
    setError(null);
    setIsConnecting(true);
    try {
      log('Opening WalletConnect modal...');
      await open();
      log('Modal opened - waiting for connection...');
      // Modal handles the connection flow
      // Errors are caught via useAppKitEvents subscription
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect';
      log(`Connect error: ${errorMessage}`);
      // Error will also be caught by event subscription
      setError(errorMessage);
      setIsConnecting(false);
    }
  }, [open, log]);

  const disconnect = useCallback(async () => {
    try {
      log('Disconnecting wallet...');
      await appKitDisconnect();
      setError(null);
      log('Disconnected');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to disconnect';
      log(`Disconnect error: ${errorMessage}`);
      setError(errorMessage);
    }
  }, [appKitDisconnect, log]);

  const getProvider = useCallback(async (): Promise<ethers.providers.Web3Provider | null> => {
    if (!walletProvider) {
      log('No wallet provider available');
      return null;
    }
    return new ethers.providers.Web3Provider(walletProvider as ethers.providers.ExternalProvider);
  }, [walletProvider, log]);

  const getSigner = useCallback(async (): Promise<ethers.Signer | null> => {
    if (!walletProvider || !address) {
      log('No provider or address available');
      return null;
    }
    const provider = new ethers.providers.Web3Provider(walletProvider as ethers.providers.ExternalProvider);
    return provider.getSigner(address);
  }, [walletProvider, address, log]);

  const signMessage = useCallback(async (message: string): Promise<string> => {
    if (!isConnected || !walletProvider || !address) {
      throw new Error('Wallet not connected');
    }

    log(`Signing message: ${message.slice(0, 30)}...`);

    const provider = new ethers.providers.Web3Provider(walletProvider as ethers.providers.ExternalProvider);
    const signer = provider.getSigner(address);
    const signature = await signer.signMessage(message);

    log(`Signature received: ${signature.slice(0, 20)}...`);
    return signature;
  }, [isConnected, walletProvider, address, log]);

  function formatAddress(addr: string | undefined): string {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  return {
    account: address ?? null,
    chainId,
    status: getStatus(),
    error,
    connect,
    disconnect,
    isConnected: isConnected && !!address,
    formattedAddress: formatAddress(address),
    signMessage,
    getProvider,
    getSigner,
    openWalletStore,
  };
};

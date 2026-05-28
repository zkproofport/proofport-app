import {useState, useCallback} from 'react';
import {useAppKit, useAccount, useProvider} from '@reown/appkit-react-native';
import {ethers} from 'ethers';

export type PrivyConnectionStatus =
  | 'initializing'
  | 'disconnected'
  | 'connecting'
  | 'wallet_connected'
  | 'authenticated'
  | 'error';

interface UsePrivyWalletReturn {
  account: string | null;
  chainId: number | null;
  status: PrivyConnectionStatus;
  error: string | null;
  isReady: boolean;
  isWalletConnected: boolean;
  isProviderReady: boolean;
  isAuthenticated: boolean;

  formattedAddress: string;

  connect: () => Promise<void>;
  signInWithWallet: () => Promise<void>;
  disconnect: () => Promise<void>;
  signMessage: (message: string) => Promise<string>;
  getProvider: () => Promise<ethers.providers.Web3Provider | null>;
  getSigner: () => Promise<ethers.Signer | null>;
}

// Privy-free implementation: AppKit (Reown/WalletConnect) only.
// `isAuthenticated` is treated as "wallet connected" since SIWE-backed
// Privy user records are no longer required for the proof flow.
export const usePrivyWallet = (
  addLog?: (msg: string) => void,
): UsePrivyWalletReturn => {
  const log = useCallback(
    (msg: string) => {
      console.log(`🔐 ${msg}`);
      addLog?.(msg);
    },
    [addLog],
  );

  const appKit = useAppKit() ?? ({} as ReturnType<typeof useAppKit>);
  const {open, disconnect: appKitDisconnect} = appKit;
  const appKitAccount = useAccount() ?? ({} as ReturnType<typeof useAccount>);
  const {address, isConnected, chainId: accountChainId} = appKitAccount;
  const providerCtx = useProvider() ?? ({} as ReturnType<typeof useProvider>);
  const {provider: walletProvider} = providerCtx;

  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const chainId = accountChainId ? Number(accountChainId) : null;
  const account = address || null;
  const isWalletConnected = !!(isConnected && address);
  // AppKit mounts synchronously; surface as "ready" immediately.
  const isReady = true;
  // Privy SIWE removed — wallet connection itself is the authenticated state.
  const isAuthenticated = isWalletConnected;

  function getStatus(): PrivyConnectionStatus {
    if (error) return 'error';
    if (isConnecting) return 'connecting';
    if (isWalletConnected) return 'wallet_connected';
    return 'disconnected';
  }

  function formatAddress(addr: string | undefined): string {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  const connect = useCallback(async () => {
    setError(null);
    setIsConnecting(true);
    try {
      log('Opening wallet selector...');
      await open();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to connect';
      log(`Connect error: ${errorMessage}`);
      setError(errorMessage);
    } finally {
      setIsConnecting(false);
    }
  }, [open, log]);

  // SIWE login removed. Kept as a no-op so callers don't need refactoring;
  // wallet connection alone is sufficient for the proof generation flow.
  const signInWithWallet = useCallback(async () => {
    if (!address) {
      log('signInWithWallet called without a connected wallet — ignored');
    }
  }, [address, log]);

  const disconnect = useCallback(async () => {
    try {
      log('Disconnecting...');
      if (isConnected) {
        await appKitDisconnect();
        log('Wallet disconnected');
      }
      setError(null);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Disconnect failed';
      log(`Disconnect error: ${errorMessage}`);
      setError(errorMessage);
    }
  }, [isConnected, appKitDisconnect, log]);

  const signMessage = useCallback(
    async (message: string): Promise<string> => {
      if (!isConnected || !walletProvider || !address) {
        throw new Error('Wallet not connected');
      }

      log(`Signing message: ${message}`);

      const provider = new ethers.providers.Web3Provider(
        walletProvider as ethers.providers.ExternalProvider,
      );
      const signer = provider.getSigner(address);
      const signature = await signer.signMessage(message);

      log(`Signature received: ${signature}`);
      return signature;
    },
    [isConnected, walletProvider, address, log],
  );

  const getProvider =
    useCallback(async (): Promise<ethers.providers.Web3Provider | null> => {
      if (!walletProvider) {
        log('No wallet provider available');
        return null;
      }
      return new ethers.providers.Web3Provider(
        walletProvider as ethers.providers.ExternalProvider,
      );
    }, [walletProvider, log]);

  const getSigner = useCallback(async (): Promise<ethers.Signer | null> => {
    if (!walletProvider || !address) {
      log('No provider or address available');
      return null;
    }
    const provider = new ethers.providers.Web3Provider(
      walletProvider as ethers.providers.ExternalProvider,
    );
    return provider.getSigner(address);
  }, [walletProvider, address, log]);

  // No global "Wallet connected" log here: this hook is circuit-agnostic, so
  // logging the globally-connected address (e.g. the Coinbase wallet) on the
  // GIWA screen is misleading. Per-circuit connection state is logged by the
  // wallet gate (`[Gate]`/`[Wallet]`) instead.

  return {
    account,
    chainId,
    status: getStatus(),
    error,
    isReady,
    isWalletConnected,
    isProviderReady: isWalletConnected && !!walletProvider,
    isAuthenticated,
    formattedAddress: formatAddress(account || undefined),
    connect,
    signInWithWallet,
    disconnect,
    signMessage,
    getProvider,
    getSigner,
  };
};

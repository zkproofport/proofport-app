import {useState, useCallback, useEffect} from 'react';
import {usePrivy, useLoginWithSiwe} from '@privy-io/expo';
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
  // Connection state
  account: string | null;
  chainId: number | null;
  status: PrivyConnectionStatus;
  error: string | null;
  isReady: boolean;
  isWalletConnected: boolean;
  isProviderReady: boolean;
  isAuthenticated: boolean;

  // Formatted display
  formattedAddress: string;

  // Actions
  connect: () => Promise<void>;
  signInWithWallet: () => Promise<void>;
  disconnect: () => Promise<void>;
  signMessage: (message: string) => Promise<string>;
  getProvider: () => Promise<ethers.providers.Web3Provider | null>;
  getSigner: () => Promise<ethers.Signer | null>;
}

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

  // Privy hooks
  const { isReady, user, logout: privyLogout } = usePrivy();
  const { generateSiweMessage, loginWithSiwe } = useLoginWithSiwe({
    onSuccess: privyUser => {
      log(`Privy login success! User ID: ${privyUser.id}`);
    },
    onError: err => {
      log(`Privy error: ${err.message}`);
      setError(err.message);
    },
  });

  // AppKit hooks for wallet connection
  const { open, disconnect: appKitDisconnect } = useAppKit();
  const { address, isConnected, chainId: accountChainId } = useAccount();
  const { provider: walletProvider } = useProvider();

  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSigning, setIsSigning] = useState(false);

  const isAuthenticated = !!user;
  const chainId = accountChainId ? Number(accountChainId) : null;

  // Get wallet address from Privy user (for authenticated state)
  const privyWalletAddress = user?.linked_accounts?.find(
    account => account.type === 'wallet',
  )?.address;

  // Use AppKit address when connected, or Privy wallet address when authenticated
  const account = address || privyWalletAddress || null;

  function getStatus(): PrivyConnectionStatus {
    if (!isReady) return 'initializing';
    if (error) return 'error';
    if (isConnecting || isSigning) return 'connecting';
    if (isAuthenticated) return 'authenticated';
    if (isConnected && address) return 'wallet_connected';
    return 'disconnected';
  }

  function formatAddress(addr: string | undefined): string {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  // Connect wallet via AppKit modal
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

  // Sign in with wallet (SIWE) to authenticate with Privy
  const signInWithWallet = useCallback(async () => {
    if (!address) {
      const msg = 'Please connect your wallet first';
      log(msg);
      setError(msg);
      return;
    }

    if (!walletProvider) {
      const msg = 'No wallet provider available';
      log(msg);
      setError(msg);
      return;
    }

    setError(null);
    setIsSigning(true);

    try {
      log('Generating SIWE message...');
      const chainIdValue = chainId || 1;

      // Debug: Log wallet info
      log(`Wallet address: ${address}`);
      log(`Chain ID: eip155:${chainIdValue}`);

      // For mobile apps, use the bundle identifier as domain
      const domain = 'zkproofport.com';
      const message = await generateSiweMessage({
        wallet: {
          address,
          chainId: `eip155:${chainIdValue}`,
        },
        from: {
          domain,
          uri: `https://${domain}`,
        },
      });

      log('SIWE message generated, requesting signature...');
      // Debug: Log full message for debugging
      log(`=== SIWE Message ===`);
      log(message);
      log(`=== End Message ===`);

      // Sign the SIWE message using ethers signer for proper encoding
      const provider = new ethers.providers.Web3Provider(
        walletProvider as ethers.providers.ExternalProvider,
      );
      const signer = provider.getSigner(address);

      // Debug: Verify signer address matches
      const signerAddress = await signer.getAddress();
      log(`Signer address: ${signerAddress}`);

      const signature = await signer.signMessage(message);
      log(`Signature received: ${signature}`);

      log('Logging in with Privy...');

      // Login with signature and messageOverride (in case cache doesn't match)
      await loginWithSiwe({ signature, messageOverride: message });
      log('Successfully authenticated with Privy!');
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Sign-in failed';
      log(`Sign-in error: ${errorMessage}`);
      setError(errorMessage);
    } finally {
      setIsSigning(false);
    }
  }, [
    address,
    chainId,
    walletProvider,
    generateSiweMessage,
    loginWithSiwe,
    log,
  ]);

  // Disconnect from both Privy and AppKit
  const disconnect = useCallback(async () => {
    try {
      log('Disconnecting...');
      if (isAuthenticated) {
        await privyLogout();
        log('Privy logged out');
      }
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
  }, [isAuthenticated, isConnected, privyLogout, appKitDisconnect, log]);

  // Sign a message (requires wallet connection)
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

  // Get ethers provider
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

  // Get ethers signer
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

  // Log connection changes
  useEffect(() => {
    if (isConnected && address) {
      log(`Wallet connected: ${formatAddress(address)}`);
    }
  }, [isConnected, address, log]);

  return {
    account,
    chainId,
    status: getStatus(),
    error,
    isReady,
    isWalletConnected: isConnected && !!address,
    isProviderReady: isConnected && !!address && !!walletProvider,
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

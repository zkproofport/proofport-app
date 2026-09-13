import {useState, useCallback, useEffect} from 'react';
import {useAppKit, useAccount, useProvider} from '@reown/appkit-react-native';
import {ethers} from 'ethers';

export type WalletConnectionStatus =
  | 'initializing'
  | 'disconnected'
  | 'connecting'
  | 'wallet_connected'
  | 'authenticated'
  | 'error';

interface UseWalletReturn {
  account: string | null;
  chainId: number | null;
  status: WalletConnectionStatus;
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

// AppKit (Reown/WalletConnect) is the only wallet path this app has.
// `isAuthenticated` is treated as "wallet connected" since SIWE-backed
// The proof flow needs a connected wallet and nothing else.
export const useWallet = (
  addLog?: (msg: string) => void,
): UseWalletReturn => {
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

  /**
   * The chain the wallet reports, as a number.
   *
   * AppKit types this `string | number`, and a CAIP form ("eip155:8453") turns
   * into NaN through `Number()`. Taking the part after the colon first means a
   * wallet on Arc reads as 5042002 rather than "Chain NaN".
   */
  const chainId = (() => {
    if (accountChainId === undefined || accountChainId === null) return null;
    const raw = String(accountChainId);
    const n = Number(raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1) : raw);
    return Number.isFinite(n) ? n : null;
  })();

  /**
   * The address, asked of the provider when the account state has none.
   *
   * The proof flow signs through `useProvider()` and the Wallet tab read
   * `useAccount()`, so the app had two answers to "is a wallet connected".
   * They disagreed: a person could produce a proof — the wallet prompted, the
   * signature came back — while the Wallet tab showed nothing connected and
   * offered no way to disconnect. Whatever can sign is what is connected, so
   * the provider is asked when the account is empty rather than trusted to
   * agree.
   */
  const [providerAddress, setProviderAddress] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!walletProvider || address) {
      setProviderAddress(null);
      return;
    }
    (async () => {
      try {
        const accounts = (await (
          walletProvider as {request: (a: {method: string}) => Promise<unknown>}
        ).request({method: 'eth_accounts'})) as string[] | undefined;
        if (!cancelled) setProviderAddress(accounts?.[0] ?? null);
      } catch {
        if (!cancelled) setProviderAddress(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletProvider, address]);

  const account = address || providerAddress || null;
  const isWalletConnected = !!(account && (isConnected || walletProvider));
  // AppKit mounts synchronously; surface as "ready" immediately.
  const isReady = true;
  // Wallet connection itself is the authenticated state; there is no
  // separate sign-in step.
  const isAuthenticated = isWalletConnected;

  function getStatus(): WalletConnectionStatus {
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

  /**
   * Drop the session, and fail loudly when it does not drop.
   *
   * Three things made this look like a dead button:
   *
   *   - It was skipped entirely when `isConnected` was false, and reported
   *     success — but a session the provider still holds is still a session.
   *   - AppKit's `disconnect` returns `void`, not a promise, so `await` on it
   *     resolved before anything had happened.
   *   - Every failure was caught and written to a `setError` that no screen
   *     renders, so a refusal and a success looked identical: nothing.
   *
   * Now it always asks, waits for the provider to actually let go, and throws
   * when it does not — so the caller can show the person something.
   */
  const disconnect = useCallback(async () => {
    log('Disconnecting...');
    setError(null);
    try {
      // No `isConnected` guard: that state is the one that was already wrong.
      await appKitDisconnect();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Disconnect failed';
      log(`Disconnect error: ${message}`);
      setError(message);
      throw new Error(message);
    }
    log('Disconnect requested');
  }, [appKitDisconnect, log]);

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

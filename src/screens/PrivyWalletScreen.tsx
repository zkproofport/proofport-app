import React, {useState, useCallback, useEffect, useRef} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Linking,
  Platform,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {usePrivy} from '@privy-io/expo';
import {
  useAppKit,
  useAccount,
  useWalletInfo,
  useAppKitState,
} from '@reown/appkit-react-native';
import {useLogs} from '../hooks';
import {LogViewer} from '../components';

const CONNECTION_TIMEOUT = 30000;

const WALLET_STORE_URLS = {
  metamask: {
    ios: 'https://apps.apple.com/app/metamask/id1438144202',
    android: 'https://play.google.com/store/apps/details?id=io.metamask',
  },
};

export const PrivyWalletScreen: React.FC = () => {
  const { logs, addLog, clearLogs, logScrollRef } = useLogs();
  const privy = usePrivy();
  const { isReady, user, logout: privyLogout, error: privyError } = privy;
  const isAuthenticated = !!user;
  const [initTimeout, setInitTimeout] = useState(false);

  // Debug: Log Privy initialization state and errors
  useEffect(() => {
    console.log('[Privy] state:', {
      isReady,
      hasUser: !!user,
      userId: user?.id,
      error: privyError?.message,
    });
    if (privyError) {
      console.error('[Privy] error:', privyError);
    }
  }, [isReady, user, privyError]);

  // Set a timeout for Privy initialization
  useEffect(() => {
    if (isReady) {
      return;
    }

    const timeout = setTimeout(() => {
      console.log('[Privy] initialization timeout after 10 seconds');
      setInitTimeout(true);
    }, 10000);

    return () => clearTimeout(timeout);
  }, [isReady]);

  // AppKit hooks for wallet connection
  const { open, disconnect } = useAppKit();
  const { address, isConnected } = useAccount();
  const { walletInfo } = useWalletInfo();
  const { isOpen: isModalOpen } = useAppKitState();

  const [isConnecting, setIsConnecting] = useState(false);
  const [noWalletDetected, setNoWalletDetected] = useState(false);
  const wasModalOpen = useRef(false);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Get wallet address from Privy user
  const privyWalletAddress = user?.linked_accounts?.find(
    account => account.type === 'wallet',
  )?.address;

  const clearConnectionTimeout = useCallback(() => {
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
  }, []);

  const handleConnectWallet = useCallback(async () => {
    clearLogs();
    addLog('Opening wallet selector...');
    setIsConnecting(true);
    setNoWalletDetected(false);

    connectionTimeoutRef.current = setTimeout(() => {
      addLog('Connection timeout - resetting state');
      setIsConnecting(false);
      setNoWalletDetected(true);
    }, CONNECTION_TIMEOUT);

    try {
      await open();
      addLog('Modal opened - waiting for connection...');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      addLog(`Connect error: ${msg}`);
      clearConnectionTimeout();
      setIsConnecting(false);
      setNoWalletDetected(true);
    }
  }, [open, addLog, clearLogs, clearConnectionTimeout]);

  const handleDisconnect = useCallback(async () => {
    addLog('Disconnecting...');
    clearConnectionTimeout();
    setNoWalletDetected(false);
    try {
      if (isAuthenticated) {
        await privyLogout();
        addLog('Privy logged out');
      }
      if (isConnected) {
        await disconnect();
        addLog('Wallet disconnected');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      addLog(`Disconnect error: ${msg}`);
    }
  }, [isAuthenticated, isConnected, privyLogout, disconnect, addLog, clearConnectionTimeout]);

  const openWalletStore = useCallback(async () => {
    const storeUrl =
      Platform.OS === 'ios'
        ? WALLET_STORE_URLS.metamask.ios
        : WALLET_STORE_URLS.metamask.android;

    try {
      await Linking.openURL(storeUrl);
      addLog('Opening wallet store...');
    } catch (error) {
      addLog('Failed to open store URL');
    }
  }, [addLog]);

  function formatAddress(addr: string): string {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  function getStatusColor(): string {
    if (isAuthenticated) return '#4CAF50';
    if (isConnected) return '#FF9800';
    return '#9E9E9E';
  }

  function getStatusText(): string {
    if (isAuthenticated) return 'Authenticated with Privy';
    if (isConnected) return 'Wallet Connected';
    return 'Not connected';
  }

  // Track modal state to detect when modal closes
  useEffect(() => {
    if (wasModalOpen.current && !isModalOpen) {
      addLog('Modal closed');
      clearConnectionTimeout();
      setIsConnecting(false);

      if (isConnected && address) {
        addLog('Connection successful!');
        setNoWalletDetected(false);
      } else {
        addLog('Modal closed without connection');
        setNoWalletDetected(true);
      }
    }
    wasModalOpen.current = isModalOpen;
  }, [isModalOpen, isConnected, address, addLog, clearConnectionTimeout]);

  // Log wallet connection changes
  useEffect(() => {
    if (isConnected && address) {
      addLog(`Wallet connected: ${formatAddress(address)}`);
      if (walletInfo?.name) {
        addLog(`Wallet: ${walletInfo.name}`);
      }
      clearConnectionTimeout();
      setIsConnecting(false);
      setNoWalletDetected(false);
    }
  }, [isConnected, address, walletInfo, addLog, clearConnectionTimeout]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      clearConnectionTimeout();
    };
  }, [clearConnectionTimeout]);

  // Show error/timeout message but don't block UI - allow wallet connection via AppKit
  const showPrivyStatus = !isReady && (privyError || initTimeout);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Text style={styles.icon}>P</Text>
          </View>

          <Text style={styles.title}>Privy Wallet</Text>
          <Text style={styles.subtitle}>Connect external wallet via Privy</Text>

          <View style={styles.statusRow}>
            <View
              style={[styles.statusDot, { backgroundColor: getStatusColor() }]}
            />
            <Text style={styles.statusText}>{getStatusText()}</Text>
          </View>

          {/* Privy Status Banner */}
          {showPrivyStatus && (
            <View style={styles.warningBanner}>
              <Text style={styles.warningText}>
                {privyError
                  ? `Privy error: ${privyError.message}`
                  : 'Privy initialization timeout - SIWE auth unavailable'}
              </Text>
              <Text style={styles.warningSubtext}>
                Wallet connection via WalletConnect still works.
                For SIWE auth, verify bundle ID (com.zkproofport.app) is configured in Privy Dashboard.
              </Text>
            </View>
          )}

          {/* Privy Initializing */}
          {!isReady && !showPrivyStatus && (
            <View style={styles.initBanner}>
              <ActivityIndicator size="small" color="#6366F1" />
              <Text style={styles.initText}>Initializing Privy...</Text>
            </View>
          )}

          {/* Info Card */}
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Connected Wallet</Text>
              <Text
                style={
                  isConnected ? styles.infoValue : styles.infoValueDisabled
                }
              >
                {isConnected && address
                  ? formatAddress(address)
                  : 'Not connected'}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Wallet Name</Text>
              <Text
                style={
                  isConnected ? styles.infoValue : styles.infoValueDisabled
                }
              >
                {walletInfo?.name || 'N/A'}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Privy User</Text>
              <Text
                style={
                  isAuthenticated ? styles.infoValue : styles.infoValueDisabled
                }
              >
                {isAuthenticated && privyWalletAddress
                  ? formatAddress(privyWalletAddress)
                  : 'Not isAuthenticated'}
              </Text>
            </View>
          </View>

          {/* Error/Info Messages */}
          {noWalletDetected && !isConnected && (
            <View style={styles.infoContainer}>
              <Text style={styles.infoText}>
                No wallet app detected. Install MetaMask to connect.
              </Text>
              <TouchableOpacity
                style={styles.installWalletButton}
                onPress={openWalletStore}
              >
                <Text style={styles.installWalletText}>Install MetaMask</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Action Buttons */}
          <View style={styles.buttonContainer}>
            {!isConnected ? (
              <TouchableOpacity
                style={[styles.button, styles.primaryButton]}
                onPress={handleConnectWallet}
                disabled={isConnecting}
              >
                {isConnecting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.buttonText}>Connect Wallet</Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={handleDisconnect}
              >
                <Text style={styles.buttonText}>Disconnect</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Full Address */}
          {isConnected && address && (
            <View style={styles.fullAddressContainer}>
              <Text style={styles.fullAddressLabel}>Full Address</Text>
              <Text style={styles.fullAddressValue} selectable>
                {address}
              </Text>
            </View>
          )}
        </View>

        <LogViewer logs={logs} scrollRef={logScrollRef} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  errorIcon: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#FF5252',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FFEBEE',
    textAlign: 'center',
    lineHeight: 80,
    overflow: 'hidden',
  },
  errorSubtext: {
    marginTop: 12,
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  warningBanner: {
    backgroundColor: '#FFF3CD',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    width: '100%',
  },
  warningText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#856404',
    marginBottom: 4,
  },
  warningSubtext: {
    fontSize: 12,
    color: '#856404',
    lineHeight: 18,
  },
  initBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E3F2FD',
    padding: 10,
    borderRadius: 8,
    marginBottom: 16,
    width: '100%',
    gap: 8,
  },
  initText: {
    fontSize: 13,
    color: '#1565C0',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  content: {
    alignItems: 'center',
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#6366F1',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  icon: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusText: {
    fontSize: 16,
    color: '#666',
  },
  infoCard: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderRadius: 16,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  infoRow: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  infoLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  infoValueDisabled: {
    fontSize: 16,
    color: '#9E9E9E',
    textAlign: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: '#E0E0E0',
    marginVertical: 12,
  },
  buttonContainer: {
    width: '100%',
    marginTop: 24,
    gap: 12,
  },
  button: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: '#6366F1',
  },
  secondaryButton: {
    backgroundColor: '#757575',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  fullAddressContainer: {
    marginTop: 20,
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    width: '100%',
  },
  fullAddressLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  fullAddressValue: {
    fontSize: 12,
    color: '#333',
    fontFamily: 'monospace',
    lineHeight: 20,
  },
  infoContainer: {
    backgroundColor: '#FFF3CD',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    width: '100%',
    alignItems: 'center',
  },
  infoText: {
    fontSize: 14,
    color: '#856404',
    textAlign: 'center',
    marginBottom: 12,
  },
  installWalletButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#F5841F',
    borderRadius: 8,
  },
  installWalletText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Clipboard,
  Alert,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useWalletConnect, useLogs} from '../hooks';
import {LogViewer} from '../components';

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum Mainnet',
  137: 'Polygon',
  43114: 'Avalanche',
  42161: 'Arbitrum One',
  10: 'Optimism',
  56: 'BNB Smart Chain',
  8453: 'Base',
  11155111: 'Sepolia Testnet',
};

export const WalletScreen: React.FC = () => {
  const {logs, addLog, clearLogs, logScrollRef} = useLogs();

  const {
    account,
    chainId,
    status,
    error,
    connect,
    disconnect,
    isConnected,
    formattedAddress,
    openWalletStore,
  } = useWalletConnect(addLog);

  const isWalletNotFoundError = error?.includes('wallet app') || error?.includes('LINKING_ERROR');

  async function handleConnect(): Promise<void> {
    clearLogs();
    addLog('Connect button pressed');
    await connect();
  }

  async function handleDisconnect(): Promise<void> {
    addLog('Disconnect button pressed');
    await disconnect();
  }

  function handleCopyAddress(): void {
    if (account) {
      Clipboard.setString(account);
      Alert.alert('Copied', 'Wallet address copied to clipboard');
    }
  }

  async function handleClearCache(): Promise<void> {
    try {
      addLog('Clearing WalletConnect cache...');
      const allKeys = await AsyncStorage.getAllKeys();
      const wcKeys = allKeys.filter(
        key => key.includes('wc@') || key.includes('appkit') || key.includes('walletconnect')
      );
      addLog(`Found ${wcKeys.length} WalletConnect keys`);
      if (wcKeys.length > 0) {
        await AsyncStorage.multiRemove(wcKeys);
        addLog('Cache cleared successfully');
        Alert.alert('Success', 'WalletConnect cache cleared. Please restart the app.');
      } else {
        addLog('No WalletConnect cache found');
        Alert.alert('Info', 'No WalletConnect cache to clear');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      addLog(`Clear cache error: ${msg}`);
      Alert.alert('Error', msg);
    }
  }

  function getChainName(id: number | null): string {
    if (!id) return 'Unknown';
    return CHAIN_NAMES[id] || `Chain ${id}`;
  }

  function getStatusColor(): string {
    switch (status) {
      case 'connected':
        return '#4CAF50';
      case 'connecting':
        return '#FF9800';
      case 'error':
        return '#F44336';
      default:
        return '#9E9E9E';
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Text style={styles.icon}>🔗</Text>
          </View>

          <Text style={styles.title}>WalletConnect</Text>

          <View style={styles.statusRow}>
            <View style={[styles.statusDot, {backgroundColor: getStatusColor()}]} />
            <Text style={styles.statusText}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Text>
          </View>

          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
              {isWalletNotFoundError && (
                <TouchableOpacity
                  style={styles.installWalletButton}
                  onPress={openWalletStore}>
                  <Text style={styles.installWalletText}>Install MetaMask</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {!isConnected ? (
            <TouchableOpacity
              style={[styles.button, styles.connectButton]}
              onPress={handleConnect}
              disabled={status === 'connecting'}>
              {status === 'connecting' ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.buttonText}>Connect Wallet</Text>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.button, styles.disconnectButton]}
              onPress={handleDisconnect}>
              <Text style={styles.buttonText}>Disconnect</Text>
            </TouchableOpacity>
          )}

          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Wallet Address</Text>
              {isConnected ? (
                <TouchableOpacity onPress={handleCopyAddress}>
                  <Text style={styles.infoValue}>{formattedAddress}</Text>
                  <Text style={styles.copyHint}>Tap to copy</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.infoValueDisabled}>Not connected</Text>
              )}
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Network</Text>
              <Text style={isConnected ? styles.infoValue : styles.infoValueDisabled}>
                {isConnected ? getChainName(chainId) : 'Not connected'}
              </Text>
            </View>

            {isConnected && chainId && (
              <>
                <View style={styles.divider} />
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Chain ID</Text>
                  <Text style={styles.infoValue}>{chainId}</Text>
                </View>
              </>
            )}
          </View>

          {isConnected && (
            <View style={styles.fullAddressContainer}>
              <Text style={styles.fullAddressLabel}>Full Address</Text>
              <Text style={styles.fullAddressValue} selectable>
                {account}
              </Text>
            </View>
          )}

          {/* Clear Cache Button */}
          <TouchableOpacity
            style={styles.clearCacheButton}
            onPress={handleClearCache}>
            <Text style={styles.clearCacheText}>Clear WalletConnect Cache</Text>
          </TouchableOpacity>
        </View>

        {/* Log Viewer */}
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
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  icon: {
    fontSize: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
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
  errorContainer: {
    backgroundColor: '#FFEBEE',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    width: '100%',
  },
  errorText: {
    color: '#C62828',
    fontSize: 14,
    textAlign: 'center',
  },
  installWalletButton: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#F5841F',
    borderRadius: 8,
    alignSelf: 'center',
  },
  installWalletText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  button: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 24,
    minWidth: 200,
    alignItems: 'center',
  },
  connectButton: {
    backgroundColor: '#3396FF',
  },
  disconnectButton: {
    backgroundColor: '#757575',
  },
  buttonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  infoCard: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderRadius: 16,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
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
  },
  copyHint: {
    fontSize: 12,
    color: '#3396FF',
    textAlign: 'center',
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: '#E0E0E0',
    marginVertical: 12,
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
  clearCacheButton: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  clearCacheText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
});

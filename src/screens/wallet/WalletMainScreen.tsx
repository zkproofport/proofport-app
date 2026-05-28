import React from 'react';
import {usePrivyWallet} from '../../hooks/usePrivyWallet';
import {WalletNoConnectionScreen} from './WalletNoConnectionScreen';
import {WalletConnectedScreen} from './WalletConnectedScreen';
import {useThemeColors} from '../../context';

const NETWORK_NAMES: Record<number, string> = {
  1: 'Ethereum Mainnet',
  5: 'Goerli Testnet',
  11155111: 'Sepolia Testnet',
  137: 'Polygon Mainnet',
  80001: 'Mumbai Testnet',
  8453: 'Base Mainnet',
  84531: 'Base Goerli',
  91342: 'GIWA Sepolia',
};

export const WalletMainScreen: React.FC = () => {
  const {colors: themeColors} = useThemeColors();
  const {isWalletConnected, account, chainId, disconnect} = usePrivyWallet();

  const handleDisconnect = async () => {
    try {
      await disconnect();
    } catch (error) {
      console.error('Failed to disconnect wallet:', error);
    }
  };

  if (!isWalletConnected) {
    // Per-circuit Connect actions live in the CircuitWalletsCard rendered
    // inside WalletNoConnectionScreen. There is no global "Connect Wallet"
    // entry point anymore — binding requires picking the target circuit.
    return <WalletNoConnectionScreen />;
  }

  return (
    <WalletConnectedScreen
      walletIcon="link-2"
      walletName="WalletConnect"
      address={account || ''}
      network={chainId ? NETWORK_NAMES[chainId] || `Chain ${chainId}` : 'Unknown'}
      brandColor={themeColors.wallets.walletconnect}
      isActive={true}
      onDisconnect={handleDisconnect}
    />
  );
};

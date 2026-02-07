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
};

const getWalletMetadata = (themeColors: any): Record<
  string,
  {icon: string; name: string; color: string}
> => ({
  metamask: {
    icon: 'activity',
    name: 'MetaMask',
    color: themeColors.wallets.metamask,
  },
  coinbase: {
    icon: 'circle',
    name: 'Coinbase Wallet',
    color: themeColors.wallets.coinbase,
  },
  trust: {
    icon: 'shield',
    name: 'Trust Wallet',
    color: themeColors.wallets.trust,
  },
  walletconnect: {
    icon: 'link-2',
    name: 'WalletConnect',
    color: themeColors.wallets.walletconnect,
  },
});

export const WalletMainScreen: React.FC = () => {
  const { colors: themeColors } = useThemeColors();
  const {isWalletConnected, account, chainId, connect, disconnect} =
    usePrivyWallet();

  const handleConnect = async () => {
    try {
      await connect();
    } catch (error) {
      console.error('Failed to connect wallet:', error);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
    } catch (error) {
      console.error('Failed to disconnect wallet:', error);
    }
  };

  if (!isWalletConnected) {
    return <WalletNoConnectionScreen onConnectPress={handleConnect} />;
  }

  const walletMetadata = getWalletMetadata(themeColors).walletconnect;

  return (
    <WalletConnectedScreen
      walletIcon={walletMetadata.icon}
      walletName={walletMetadata.name}
      address={account || ''}
      network={chainId ? NETWORK_NAMES[chainId] || `Chain ${chainId}` : 'Unknown'}
      brandColor={walletMetadata.color}
      isActive={true}
      onDisconnect={handleDisconnect}
    />
  );
};

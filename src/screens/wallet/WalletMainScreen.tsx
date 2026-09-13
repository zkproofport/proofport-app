import React from 'react';
import {useWallet} from '../../hooks/useWallet';
import {ALL_CIRCUIT_IDS, getNetworkConfigForCircuit} from '../../config';
import {useError} from '../../context';
import {WalletNoConnectionScreen} from './WalletNoConnectionScreen';
import {WalletConnectedScreen} from './WalletConnectedScreen';
import {useThemeColors} from '../../context';

/**
 * The name of a chain, from the chains this app already knows.
 *
 * This was a hand-typed map of eight chain numbers. It had Goerli and Mumbai —
 * both long dead — and neither Arc (5042002) nor Base Sepolia (84532), which
 * are the two a developer build actually connects to. A wallet on Arc read
 * "Chain 5042002".
 */
function networkName(chainId: number): string {
  for (const circuit of ALL_CIRCUIT_IDS) {
    const net = getNetworkConfigForCircuit(circuit);
    if (net.chainId === chainId) return net.name;
  }
  // Ethereum is not a chain any circuit verifies on, but a wallet opens there.
  if (chainId === 1) return 'Ethereum';
  return `Chain ${chainId}`;
}

export const WalletMainScreen: React.FC = () => {
  const {colors: themeColors} = useThemeColors();
  const {isWalletConnected, account, chainId, disconnect} = useWallet();
  const {showError} = useError();

  const handleDisconnect = async () => {
    try {
      await disconnect();
    } catch (error) {
      // A failure used to go to the console and nowhere else, so a refused
      // disconnect and a successful one looked identical to the person: the
      // button did nothing either way.
      showError('E4004', error instanceof Error ? error.message : String(error));
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
      network={chainId ? networkName(chainId) : 'Unknown'}
      brandColor={themeColors.wallets.walletconnect}
      isActive={true}
      onDisconnect={handleDisconnect}
    />
  );
};

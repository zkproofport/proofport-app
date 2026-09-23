import React from 'react';
import {CircuitWalletsCard} from './CircuitWalletsCard';
import {WalletScreenLayout} from './WalletScreenLayout';
import {WalletSessionCard, type WalletSessionCardProps} from './WalletSessionCard';

export function WalletConnectedScreen(props: WalletSessionCardProps) {
  return <WalletScreenLayout>
    <WalletSessionCard {...props} />
    <CircuitWalletsCard />
  </WalletScreenLayout>;
}

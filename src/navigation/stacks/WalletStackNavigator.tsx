import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { WalletStackParamList } from '../types';
import {WalletMainScreen} from '../../screens/wallet';
import {useStackScreenOptions} from '../shared';

const Stack = createNativeStackNavigator<WalletStackParamList>();

const WalletStackNavigator: React.FC = () => {
  const stackScreenOptions = useStackScreenOptions();
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="WalletMain"
        component={WalletMainScreen}
        options={{ title: 'Wallet' }}
      />
    </Stack.Navigator>
  );
};

export default WalletStackNavigator;

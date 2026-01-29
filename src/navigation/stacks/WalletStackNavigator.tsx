import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { WalletStackParamList } from '../types';
import {WalletMainScreen} from '../../screens/wallet';

const Stack = createNativeStackNavigator<WalletStackParamList>();

const WalletStackNavigator: React.FC = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: '#0F1419',
        },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: {
          fontWeight: '600',
        },
        contentStyle: {
          backgroundColor: '#0F1419',
        },
      }}
    >
      <Stack.Screen
        name="WalletMain"
        component={WalletMainScreen}
        options={{ title: 'Wallet' }}
      />
    </Stack.Navigator>
  );
};

export default WalletStackNavigator;

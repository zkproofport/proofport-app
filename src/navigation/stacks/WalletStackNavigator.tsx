import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import type { WalletStackParamList } from '../types';
import {WalletMainScreen} from '../../screens/wallet';
import {useStackScreenOptions} from '../shared';

const Stack = createNativeStackNavigator<WalletStackParamList>();

const WalletStackNavigator: React.FC = () => {
  const stackScreenOptions = useStackScreenOptions();
  const { t, i18n } = useTranslation();
  return (
    <Stack.Navigator key={i18n.language} screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="WalletMain"
        component={WalletMainScreen}
        options={{ title: t('host.tabs.wallet') }}
      />
    </Stack.Navigator>
  );
};

export default WalletStackNavigator;

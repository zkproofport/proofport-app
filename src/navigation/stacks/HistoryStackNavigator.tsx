import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import type { HistoryStackParamList } from '../types';
import { ProofHistoryScreen, HistoryDetailScreen } from '../../screens/history';
import { useStackScreenOptions } from '../shared';

const Stack = createNativeStackNavigator<HistoryStackParamList>();

// Used only when OPENSTOA_ENABLED is false: History is promoted from the
// "More" menu back to a top-level tab (its original placement before the
// OpenStoa mini-app took the 4th tab slot). The screens are the same ones
// MoreStackNavigator registers.
const HistoryStackNavigator: React.FC = () => {
  const stackScreenOptions = useStackScreenOptions();
  const { t, i18n } = useTranslation();
  return (
    <Stack.Navigator key={i18n.language} screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="HistoryMain"
        component={ProofHistoryScreen}
        options={{ title: t('host.more.history') }}
      />
      <Stack.Screen
        name="HistoryDetail"
        component={HistoryDetailScreen}
        options={{ title: t('host.history.detail.title') }}
      />
    </Stack.Navigator>
  );
};

export default HistoryStackNavigator;

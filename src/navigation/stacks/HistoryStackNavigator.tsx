import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import type { HistoryStackParamList } from '../types';
import {ProofHistoryScreen, HistoryDetailScreen} from '../../screens/history';
import {useStackScreenOptions} from '../shared';

const Stack = createNativeStackNavigator<HistoryStackParamList>();

const HistoryStackNavigator: React.FC = () => {
  const { t, i18n } = useTranslation();
  const stackScreenOptions = useStackScreenOptions();
  return (
    <Stack.Navigator key={i18n.language} screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="HistoryMain"
        component={ProofHistoryScreen}
        options={{ title: t('host.tabs.history') }}
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

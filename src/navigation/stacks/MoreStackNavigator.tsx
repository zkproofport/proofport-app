import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import type { MoreStackParamList } from '../types';
import {
  MoreMainScreen,
  AboutScreen,
} from '../../screens/more';
import {ProofHistoryScreen, HistoryDetailScreen} from '../../screens/history';
import SettingsLanguageScreen from '../../screens/more/SettingsLanguageScreen';
import {useStackScreenOptions} from '../shared';

const Stack = createNativeStackNavigator<MoreStackParamList>();

const MoreStackNavigator: React.FC = () => {
  const stackScreenOptions = useStackScreenOptions();
  const { t, i18n } = useTranslation();
  return (
    <Stack.Navigator key={i18n.language} screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="MoreMain"
        component={MoreMainScreen}
        options={{ title: t('host.more.title') }}
      />
      <Stack.Screen
        name="About"
        component={AboutScreen}
        options={{ title: t('host.more.about') }}
      />
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
      <Stack.Screen
        name="SettingsLanguage"
        component={SettingsLanguageScreen}
        options={{ title: t('host.more.language') }}
      />
    </Stack.Navigator>
  );
};

export default MoreStackNavigator;

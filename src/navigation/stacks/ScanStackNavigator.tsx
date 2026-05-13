import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import type { ScanStackParamList } from '../types';
import QRScanScreen from '../../screens/scan/QRScanScreen';
import {useStackScreenOptions} from '../shared';

const Stack = createNativeStackNavigator<ScanStackParamList>();

const ScanStackNavigator: React.FC = () => {
  const stackScreenOptions = useStackScreenOptions();
  const { t, i18n } = useTranslation();
  return (
    <Stack.Navigator key={i18n.language} screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="ScanMain"
        component={QRScanScreen}
        options={{ title: t('host.tabs.scan'), headerShown: false }}
      />
    </Stack.Navigator>
  );
};

export default ScanStackNavigator;

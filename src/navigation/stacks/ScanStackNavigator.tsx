import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ScanStackParamList } from '../types';
import QRScanScreen from '../../screens/scan/QRScanScreen';
import {useStackScreenOptions} from '../shared';

const Stack = createNativeStackNavigator<ScanStackParamList>();

const ScanStackNavigator: React.FC = () => {
  const stackScreenOptions = useStackScreenOptions();
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="ScanMain"
        component={QRScanScreen}
        options={{ title: 'Scan', headerShown: false }}
      />
    </Stack.Navigator>
  );
};

export default ScanStackNavigator;

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ScanStackParamList } from '../types';
import QRScanScreen from '../../screens/scan/QRScanScreen';

const Stack = createNativeStackNavigator<ScanStackParamList>();

const ScanStackNavigator: React.FC = () => {
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
        name="ScanMain"
        component={QRScanScreen}
        options={{ title: 'Scan', headerShown: false }}
      />
    </Stack.Navigator>
  );
};

export default ScanStackNavigator;

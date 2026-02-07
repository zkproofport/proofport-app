import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { HistoryStackParamList } from '../types';
import {ProofHistoryScreen, HistoryDetailScreen} from '../../screens/history';
import {useStackScreenOptions} from '../shared';

const Stack = createNativeStackNavigator<HistoryStackParamList>();

const HistoryStackNavigator: React.FC = () => {
  const stackScreenOptions = useStackScreenOptions();
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="HistoryMain"
        component={ProofHistoryScreen}
        options={{ title: 'History' }}
      />
      <Stack.Screen
        name="HistoryDetail"
        component={HistoryDetailScreen}
        options={{ title: 'Proof Detail' }}
      />
    </Stack.Navigator>
  );
};

export default HistoryStackNavigator;

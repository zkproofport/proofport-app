import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { HistoryStackParamList } from '../types';
import {ProofHistoryScreen, HistoryDetailScreen} from '../../screens/history';
import {stackScreenOptions, headerBackButton} from '../shared';

const Stack = createNativeStackNavigator<HistoryStackParamList>();

const HistoryStackNavigator: React.FC = () => {
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
        options={({navigation}) => ({
          title: 'Proof Detail',
          headerLeft: () => headerBackButton(navigation),
        })}
      />
    </Stack.Navigator>
  );
};

export default HistoryStackNavigator;

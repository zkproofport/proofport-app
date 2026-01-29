import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ProofStackParamList } from '../types';
import {
  CircuitSelectionScreen,
  ProofGenerationScreen,
  ProofCompleteScreen,
} from '../../screens/proof';
import {stackScreenOptions, headerBackButton} from '../shared';

const Stack = createNativeStackNavigator<ProofStackParamList>();

const ProofStackNavigator: React.FC = () => {
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="CircuitSelection"
        component={CircuitSelectionScreen}
        options={{ title: 'Select Circuit' }}
      />
      <Stack.Screen
        name="ProofGeneration"
        component={ProofGenerationScreen}
        options={({navigation}) => ({
          title: 'Generate Proof',
          headerLeft: () => headerBackButton(navigation),
        })}
      />
      <Stack.Screen
        name="ProofComplete"
        component={ProofCompleteScreen}
        options={{
          title: 'Proof Complete',
          headerBackVisible: false,
        }}
      />
    </Stack.Navigator>
  );
};

export default ProofStackNavigator;

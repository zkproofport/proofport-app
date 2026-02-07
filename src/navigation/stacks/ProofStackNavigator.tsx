import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ProofStackParamList } from '../types';
import {
  CircuitSelectionScreen,
  CountryInputScreen,
  ProofGenerationScreen,
  ProofCompleteScreen,
} from '../../screens/proof';
import {useStackScreenOptions} from '../shared';

const Stack = createNativeStackNavigator<ProofStackParamList>();

const ProofStackNavigator: React.FC = () => {
  const stackScreenOptions = useStackScreenOptions();
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="CircuitSelection"
        component={CircuitSelectionScreen}
        options={{ title: 'Verify' }}
      />
      <Stack.Screen
        name="CountryInput"
        component={CountryInputScreen}
        options={{ title: 'Country Verification' }}
      />
      <Stack.Screen
        name="ProofGeneration"
        component={ProofGenerationScreen}
        options={{ title: 'Generate Proof' }}
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

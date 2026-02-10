import React from 'react';
import { TouchableOpacity, Text } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ProofStackParamList } from '../types';
import {
  CircuitSelectionScreen,
  CountryInputScreen,
  ProofGenerationScreen,
  ProofCompleteScreen,
} from '../../screens/proof';
import {useStackScreenOptions} from '../shared';
import {useThemeColors} from '../../context';

const Stack = createNativeStackNavigator<ProofStackParamList>();

const ProofStackNavigator: React.FC = () => {
  const stackScreenOptions = useStackScreenOptions();
  const {colors: themeColors} = useThemeColors();
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
        options={({navigation}) => ({
          title: 'Proof Complete',
          headerBackVisible: false,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => navigation.popToTop()}
              hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
              <Text style={{fontSize: 16, fontWeight: '600', color: themeColors.info[500]}}>Done</Text>
            </TouchableOpacity>
          ),
        })}
      />
    </Stack.Navigator>
  );
};

export default ProofStackNavigator;

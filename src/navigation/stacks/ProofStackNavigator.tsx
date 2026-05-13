import React from 'react';
import { TouchableOpacity, Text } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import type { ProofStackParamList } from '../types';
import {
  CircuitSelectionScreen,
  CountryInputScreen,
  DomainInputScreen,
  ProofGenerationScreen,
  ProofCompleteScreen,
} from '../../screens/proof';
import {useStackScreenOptions} from '../shared';
import {useThemeColors} from '../../context';

const Stack = createNativeStackNavigator<ProofStackParamList>();

const ProofStackNavigator: React.FC = () => {
  const { t, i18n } = useTranslation();
  const stackScreenOptions = useStackScreenOptions();
  const {colors: themeColors} = useThemeColors();
  return (
    <Stack.Navigator key={i18n.language} screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="CircuitSelection"
        component={CircuitSelectionScreen}
        options={{ title: t('host.tabs.verify') }}
      />
      <Stack.Screen
        name="CountryInput"
        component={CountryInputScreen}
        options={{ title: t('host.proof.country.stackTitle') }}
      />
      <Stack.Screen
        name="DomainInput"
        component={DomainInputScreen}
        options={{ title: t('host.proof.domain.stackTitle') }}
      />
      <Stack.Screen
        name="ProofGeneration"
        component={ProofGenerationScreen}
        options={{ title: t('host.proof.generation.stackTitle') }}
      />
      <Stack.Screen
        name="ProofComplete"
        component={ProofCompleteScreen}
        options={({navigation}) => ({
          title: t('host.proof.complete.stackTitle'),
          headerBackVisible: false,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => navigation.popToTop()}
              hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
              <Text style={{fontSize: 16, fontWeight: '600', color: themeColors.info[500]}}>{t('host.proof.complete.done')}</Text>
            </TouchableOpacity>
          ),
        })}
      />
    </Stack.Navigator>
  );
};

export default ProofStackNavigator;

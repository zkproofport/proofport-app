import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MoreStackParamList } from '../types';
import {
  MoreMainScreen,
  AboutScreen,
} from '../../screens/more';
import {useStackScreenOptions} from '../shared';

const Stack = createNativeStackNavigator<MoreStackParamList>();

const MoreStackNavigator: React.FC = () => {
  const stackScreenOptions = useStackScreenOptions();
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="MoreMain"
        component={MoreMainScreen}
        options={{ title: 'More' }}
      />
      <Stack.Screen
        name="About"
        component={AboutScreen}
        options={{ title: 'About' }}
      />
    </Stack.Navigator>
  );
};

export default MoreStackNavigator;

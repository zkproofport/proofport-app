import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MyInfoStackParamList } from '../types';
import {
  MyInfoMainScreen,
  SettingsScreen,
  LegalScreen,
  PlaceholderScreen,
} from '../../screens/myinfo';
import {useStackScreenOptions} from '../shared';

const Stack = createNativeStackNavigator<MyInfoStackParamList>();

const MyInfoStackNavigator: React.FC = () => {
  const stackScreenOptions = useStackScreenOptions();
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="MyInfoMain"
        component={MyInfoMainScreen}
        options={{ title: 'My Info' }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Settings' }}
      />
      <Stack.Screen
        name="Notifications"
        component={PlaceholderScreen}
        options={{ title: 'Notifications' }}
      />
      <Stack.Screen
        name="Security"
        component={PlaceholderScreen}
        options={{ title: 'Security' }}
      />
      <Stack.Screen
        name="Legal"
        component={LegalScreen}
        options={{ title: 'Legal' }}
      />
      <Stack.Screen
        name="About"
        component={PlaceholderScreen}
        options={{ title: 'About' }}
      />
    </Stack.Navigator>
  );
};

export default MyInfoStackNavigator;

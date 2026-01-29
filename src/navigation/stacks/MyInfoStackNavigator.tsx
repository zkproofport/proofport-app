import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MyInfoStackParamList } from '../types';
import {
  MyInfoMainScreen,
  SettingsScreen,
  LegalScreen,
  PlaceholderScreen,
} from '../../screens/myinfo';
import {stackScreenOptions, headerBackButton} from '../shared';

const Stack = createNativeStackNavigator<MyInfoStackParamList>();

const makeOptions = (title: string) => ({navigation}: {navigation: any}) => ({
  title,
  headerLeft: () => headerBackButton(navigation),
});

const MyInfoStackNavigator: React.FC = () => {
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
        options={makeOptions('Settings')}
      />
      <Stack.Screen
        name="Notifications"
        component={PlaceholderScreen}
        options={makeOptions('Notifications')}
      />
      <Stack.Screen
        name="Security"
        component={PlaceholderScreen}
        options={makeOptions('Security')}
      />
      <Stack.Screen
        name="Legal"
        component={LegalScreen}
        options={makeOptions('Legal')}
      />
      <Stack.Screen
        name="About"
        component={PlaceholderScreen}
        options={makeOptions('About')}
      />
    </Stack.Navigator>
  );
};

export default MyInfoStackNavigator;

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import i18n from 'i18next';
import type { OpenStoaStackParamList } from '../types';
import OpenStoaRootScreen from '../../screens/openstoa/OpenStoaRootScreen';

const Stack = createNativeStackNavigator<OpenStoaStackParamList>();

// Single-screen stack — the screen mounts the embedded OpenStoa mini-app,
// which owns its own bottom tab bar (Feed/Topics/Chat/Profile + fake
// "ZKProofport" exit tab). The host TabNavigator hides its own tab bar
// while this screen is focused (see TabNavigator.tsx isInsideOpenStoa).
const OpenStoaStackNavigator: React.FC = () => (
  <Stack.Navigator key={i18n.language} screenOptions={{ headerShown: false }}>
    <Stack.Screen name="OpenStoaRoot" component={OpenStoaRootScreen} />
  </Stack.Navigator>
);

export default OpenStoaStackNavigator;

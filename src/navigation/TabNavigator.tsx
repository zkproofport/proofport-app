import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Platform, StyleSheet, View, TouchableOpacity, Text } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { TabParamList } from './types';
import OpenStoaStackNavigator from './stacks/OpenStoaStackNavigator';
import ProofStackNavigator from './stacks/ProofStackNavigator';
import HistoryStackNavigator from './stacks/HistoryStackNavigator';
import ScanStackNavigator from './stacks/ScanStackNavigator';
import MoreStackNavigator from './stacks/MoreStackNavigator';
import OpenStoaMarkIcon from '../components/icons/OpenStoaMarkIcon';
import { useThemeColors } from '../context';
import { useCurrentLanguage } from '../i18n';

const Tab = createBottomTabNavigator<TabParamList>();

const ScanTabButton: React.FC<any> = ({ onPress, accessibilityState }) => {
  const focused = accessibilityState?.selected;
  const { mode, colors: themeColors } = useThemeColors();
  const { t } = useTranslation();
  const inactiveTintColor = mode === 'dark' ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.4)';

  return (
    <TouchableOpacity
      style={styles.scanButtonContainer}
      onPress={onPress}
      activeOpacity={0.8}>
      <View style={[styles.scanButton, !focused && [styles.scanButtonInactive, { backgroundColor: themeColors.background.tertiary }]]}>
        <Feather name="camera" size={24} color={focused ? '#FFFFFF' : themeColors.text.secondary} />
      </View>
      <Text style={[
        styles.scanLabel,
        { color: focused ? themeColors.text.primary : inactiveTintColor }
      ]}>{t('host.tabs.scan')}</Text>
    </TouchableOpacity>
  );
};

// While the user is inside the embedded OpenStoa mini-app the inner
// navigator owns the bottom tab bar (Feed/Topics/Chat/Profile + a fake
// "ZKProofport" tab that calls host.exitToHost()). Hide the host tab bar
// so only one bottom bar is visible at any time.
function isInsideOpenStoa(route: any): boolean {
  const focused = getFocusedRouteNameFromRoute(route);
  if (!focused) return true; // default landing screen of OpenStoa stack
  return focused === 'OpenStoaRoot';
}

const TabNavigator: React.FC = () => {
  const { mode, colors: themeColors } = useThemeColors();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  // Explicit subscription to languageChanged events; using useTranslation's
  // i18n.language alone has been observed to skip re-renders when the
  // navigator tree cascades remounts via key prop.
  const lang = useCurrentLanguage();

  const baseTabBarStyle = {
    backgroundColor: themeColors.background.primary,
    borderTopWidth: 1,
    borderTopColor: themeColors.background.secondary,
    paddingTop: 8,
    paddingBottom: Math.max(insets.bottom, 16),
    height: 60 + Math.max(insets.bottom, 16),
  };

  return (
    <Tab.Navigator
      key={lang}
      initialRouteName="ProofTab"
      screenOptions={{
        headerShown: false,
        tabBarStyle: baseTabBarStyle,
        tabBarActiveTintColor: themeColors.text.primary,
        tabBarInactiveTintColor: mode === 'dark' ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.4)',
        tabBarLabelStyle: styles.tabBarLabel,
      }}
    >
      <Tab.Screen
        name="OpenStoaTab"
        component={OpenStoaStackNavigator}
        options={({ route }) => ({
          tabBarLabel: t('host.tabs.openstoa'),
          // OpenStoa brand mark instead of a generic Feather glyph.
          // Same SVG path as openstoa.xyz / the OG card, so the tab
          // visually matches the destination's identity.
          tabBarIcon: ({ size, color }) => (
            <OpenStoaMarkIcon size={size} color={color} />
          ),
          tabBarStyle: isInsideOpenStoa(route)
            ? { display: 'none' }
            : baseTabBarStyle,
        })}
      />
      <Tab.Screen
        name="ProofTab"
        component={ProofStackNavigator}
        options={{
          tabBarLabel: t('host.tabs.verify'),
          tabBarIcon: ({ size, color }) => (
            <Feather name="shield" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="ScanTab"
        component={ScanStackNavigator}
        options={{
          tabBarLabel: () => null,
          tabBarIcon: () => null,
          tabBarButton: (props) => <ScanTabButton {...props} />,
        }}
      />
      <Tab.Screen
        name="HistoryTab"
        component={HistoryStackNavigator}
        options={{
          tabBarLabel: t('host.tabs.history'),
          tabBarIcon: ({ size, color }) => (
            <Feather name="clock" size={size} color={color} />
          ),
        }}
        listeners={({ navigation }) => ({
          tabPress: () => {
            navigation.navigate('HistoryTab', { screen: 'HistoryMain' });
          },
        })}
      />
      <Tab.Screen
        name="MoreTab"
        component={MoreStackNavigator}
        options={{
          tabBarLabel: t('host.tabs.more'),
          tabBarIcon: ({ size, color }) => (
            <Feather name="more-horizontal" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  tabBarLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  scanButtonContainer: {
    top: -28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  scanLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
  },
  scanButtonInactive: {
    backgroundColor: '#2D3748',
    shadowOpacity: 0,
  },
});

export default TabNavigator;

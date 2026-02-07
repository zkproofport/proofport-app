import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Platform, StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import type { TabParamList } from './types';
import ProofStackNavigator from './stacks/ProofStackNavigator';
import WalletStackNavigator from './stacks/WalletStackNavigator';
import HistoryStackNavigator from './stacks/HistoryStackNavigator';
import ScanStackNavigator from './stacks/ScanStackNavigator';
import MyInfoStackNavigator from './stacks/MyInfoStackNavigator';
import { useThemeColors } from '../context';

const ICON_MAP: Record<string, string> = {
  'shield': '🛡',
  'credit-card': '💳',
  'clock': '🕐',
  'scan': '📷',
  'user': '👤',
};

const Tab = createBottomTabNavigator<TabParamList>();

const ScanTabButton: React.FC<any> = ({ onPress, accessibilityState }) => {
  const focused = accessibilityState?.selected;
  const { mode, colors: themeColors } = useThemeColors();
  const inactiveTintColor = mode === 'dark' ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.4)';

  return (
    <TouchableOpacity
      style={styles.scanButtonContainer}
      onPress={onPress}
      activeOpacity={0.8}>
      <View style={[styles.scanButton, !focused && [styles.scanButtonInactive, { backgroundColor: themeColors.background.tertiary }]]}>
        <Text style={styles.scanIcon}>📷</Text>
      </View>
      <Text style={[
        styles.scanLabel,
        { color: focused ? themeColors.text.primary : inactiveTintColor }
      ]}>Scan</Text>
    </TouchableOpacity>
  );
};

const TabNavigator: React.FC = () => {
  const { mode, colors: themeColors } = useThemeColors();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: themeColors.background.primary,
          borderTopWidth: 1,
          borderTopColor: themeColors.background.secondary,
          height: Platform.OS === 'ios' ? 83 : 60,
          paddingBottom: Platform.OS === 'ios' ? 34 : 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: themeColors.text.primary,
        tabBarInactiveTintColor: mode === 'dark' ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.4)',
        tabBarLabelStyle: styles.tabBarLabel,
      }}
    >
      <Tab.Screen
        name="ProofTab"
        component={ProofStackNavigator}
        options={{
          tabBarLabel: 'Verify',
          tabBarIcon: ({ focused, size }) => (
            <Text style={{ fontSize: size, textAlign: 'center', opacity: focused ? 1 : 0.4 }}>
              {ICON_MAP['shield']}
            </Text>
          ),
        }}
      />
      <Tab.Screen
        name="WalletTab"
        component={WalletStackNavigator}
        options={{
          tabBarLabel: 'Wallet',
          tabBarIcon: ({ focused, size }) => (
            <Text style={{ fontSize: size, textAlign: 'center', opacity: focused ? 1 : 0.4 }}>
              {ICON_MAP['credit-card']}
            </Text>
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
          tabBarLabel: 'History',
          tabBarIcon: ({ focused, size }) => (
            <Text style={{ fontSize: size, textAlign: 'center', opacity: focused ? 1 : 0.4 }}>
              {ICON_MAP['clock']}
            </Text>
          ),
        }}
        listeners={({ navigation }) => ({
          tabPress: () => {
            navigation.navigate('HistoryTab', { screen: 'HistoryMain' });
          },
        })}
      />
      <Tab.Screen
        name="MyInfoTab"
        component={MyInfoStackNavigator}
        options={{
          tabBarLabel: 'MyInfo',
          tabBarIcon: ({ focused, size }) => (
            <Text style={{ fontSize: size, textAlign: 'center', opacity: focused ? 1 : 0.4 }}>
              {ICON_MAP['user']}
            </Text>
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
  scanIcon: {
    fontSize: 24,
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

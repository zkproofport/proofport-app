import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Platform, StyleSheet, View, TouchableOpacity, Text } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TabParamList } from './types';
import ProofStackNavigator from './stacks/ProofStackNavigator';
import WalletStackNavigator from './stacks/WalletStackNavigator';
import HistoryStackNavigator from './stacks/HistoryStackNavigator';
import ScanStackNavigator from './stacks/ScanStackNavigator';
import MoreStackNavigator from './stacks/MoreStackNavigator';
import { useThemeColors } from '../context';

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
        <Feather name="camera" size={24} color={focused ? '#FFFFFF' : themeColors.text.secondary} />
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
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: themeColors.background.primary,
          borderTopWidth: 1,
          borderTopColor: themeColors.background.secondary,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 16),
          height: 60 + Math.max(insets.bottom, 16),
        },
        tabBarActiveTintColor: themeColors.text.primary,
        tabBarInactiveTintColor: mode === 'dark' ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.4)',
        tabBarLabelStyle: styles.tabBarLabel,
      }}
    >
      <Tab.Screen
        name="ProofTab"
        component={ProofStackNavigator}
        options={({ navigation }) => ({
          tabBarLabel: 'Verify',
          tabBarIcon: ({ focused, size, color }) => (
            <Feather
              name="shield"
              size={size}
              color={color}
            />
          ),
        })}
      />
      <Tab.Screen
        name="WalletTab"
        component={WalletStackNavigator}
        options={{
          tabBarLabel: 'Wallet',
          tabBarIcon: ({ focused, size, color }) => (
            <Feather
              name="credit-card"
              size={size}
              color={color}
            />
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
          tabBarIcon: ({ focused, size, color }) => (
            <Feather
              name="clock"
              size={size}
              color={color}
            />
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
          tabBarLabel: 'More',
          tabBarIcon: ({ focused, size, color }) => (
            <Feather
              name="more-horizontal"
              size={size}
              color={color}
            />
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

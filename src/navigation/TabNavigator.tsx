import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Platform, StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import type { TabParamList } from './types';
import ProofStackNavigator from './stacks/ProofStackNavigator';
import WalletStackNavigator from './stacks/WalletStackNavigator';
import HistoryStackNavigator from './stacks/HistoryStackNavigator';
import ScanStackNavigator from './stacks/ScanStackNavigator';
import MyInfoStackNavigator from './stacks/MyInfoStackNavigator';

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
  return (
    <TouchableOpacity
      style={styles.scanButtonContainer}
      onPress={onPress}
      activeOpacity={0.8}>
      <View style={[styles.scanButton, !focused && styles.scanButtonInactive]}>
        <Text style={styles.scanIcon}>📷</Text>
      </View>
      <Text style={[styles.scanLabel, !focused && styles.scanLabelInactive]}>Scan</Text>
    </TouchableOpacity>
  );
};

const TabNavigator: React.FC = () => {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: '#FFFFFF',
        tabBarInactiveTintColor: 'rgba(255, 255, 255, 0.4)',
        tabBarLabelStyle: styles.tabBarLabel,
      }}
    >
      <Tab.Screen
        name="ProofTab"
        component={ProofStackNavigator}
        options={{
          tabBarLabel: 'Proof',
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
  tabBar: {
    backgroundColor: '#0F1419',
    borderTopWidth: 1,
    borderTopColor: '#1A2332',
    height: Platform.OS === 'ios' ? 83 : 60,
    paddingBottom: Platform.OS === 'ios' ? 34 : 8,
    paddingTop: 8,
  },
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
    color: '#FFFFFF',
    marginTop: 4,
  },
  scanButtonInactive: {
    backgroundColor: '#2D3748',
    shadowOpacity: 0,
  },
  scanLabelInactive: {
    color: 'rgba(255, 255, 255, 0.4)',
  },
});

export default TabNavigator;

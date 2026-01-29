import React from 'react';
import {View, Text, StyleSheet, SafeAreaView, ScrollView} from 'react-native';
import {MenuItem} from '../../components/ui/molecules/MenuItem';
import type {MyInfoTabScreenProps} from '../../navigation/types';

const MyInfoMainScreen: React.FC<MyInfoTabScreenProps<'MyInfoMain'>> = ({
  navigation,
}) => {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}>
        <Text style={styles.header}>MyInfo</Text>

        <MenuItem
          icon="settings"
          title="Settings"
          subtitle="App preferences & configuration"
          onPress={() => navigation.navigate('Settings')}
        />

        <MenuItem
          icon="bell"
          title="Notifications"
          subtitle="Manage alerts & updates (Coming Soon)"
          onPress={() =>
            navigation.navigate('Notifications', {type: 'notifications'})
          }
        />

        <MenuItem
          icon="lock"
          title="Security"
          subtitle="Biometric lock, backup (Coming Soon)"
          onPress={() => navigation.navigate('Security', {type: 'security'})}
        />

        <MenuItem
          icon="file-text"
          title="Legal"
          subtitle="Terms, Privacy, Licenses"
          onPress={() => navigation.navigate('Legal')}
        />

        <MenuItem
          icon="info"
          title="About"
          subtitle="Version, Support, Feedback (Coming Soon)"
          onPress={() => navigation.navigate('About', {type: 'about'})}
        />

        <Text style={styles.version}>Version 1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F1419',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  header: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 24,
  },
  version: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 32,
    marginBottom: 16,
  },
});

export default MyInfoMainScreen;

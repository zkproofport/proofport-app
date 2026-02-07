import React from 'react';
import {View, Text, StyleSheet, SafeAreaView, ScrollView} from 'react-native';
import {MenuItem} from '../../components/ui/molecules/MenuItem';
import type {MyInfoTabScreenProps} from '../../navigation/types';
import {useThemeColors} from '../../context';

const MyInfoMainScreen: React.FC<MyInfoTabScreenProps<'MyInfoMain'>> = ({
  navigation,
}) => {
  const { colors: themeColors } = useThemeColors();

  return (
    <SafeAreaView style={[styles.container, {backgroundColor: themeColors.background.primary}]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}>
        <Text style={[styles.header, {color: themeColors.text.primary}]}>MyInfo</Text>

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

        <Text style={[styles.version, {color: themeColors.text.tertiary}]}>Version 1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    marginBottom: 24,
  },
  version: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 32,
    marginBottom: 16,
  },
});

export default MyInfoMainScreen;

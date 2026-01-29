import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Alert,
  Share,
  ActivityIndicator,
} from 'react-native';
import {Toggle} from '../../components/ui/molecules/Toggle';
import {MenuItem} from '../../components/ui/molecules/MenuItem';
import {useSettings} from '../../hooks/useSettings';
import {useProofHistory} from '../../hooks/useProofHistory';
import type {MyInfoTabScreenProps} from '../../navigation/types';

const SettingsScreen: React.FC<MyInfoTabScreenProps<'Settings'>> = () => {
  const {settings, loading, updateSettings} = useSettings();
  const {exportToJSON, clearAll} = useProofHistory();

  const handleExportHistory = async () => {
    Alert.alert(
      'Export Proof History',
      'Export your proof history as JSON file?',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Export',
          onPress: async () => {
            try {
              const json = await exportToJSON();
              await Share.share({
                message: json,
                title: 'Proof History Export',
              });
            } catch (error) {
              Alert.alert('Error', 'Failed to export proof history');
            }
          },
        },
      ],
    );
  };

  const handleClearData = async () => {
    Alert.alert(
      'Clear Local Data',
      'This will delete all locally stored proofs and settings. This action cannot be undone.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearAll();
              Alert.alert('Success', 'Local data cleared');
            } catch (error) {
              Alert.alert('Error', 'Failed to clear local data');
            }
          },
        },
      ],
    );
  };

  if (loading || !settings) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading settings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>GENERAL</Text>
          <View style={styles.settingItem}>
            <Text style={styles.settingLabel}>Language</Text>
            <Text style={styles.settingValue}>English</Text>
          </View>
          <View style={styles.settingItem}>
            <Text style={styles.settingLabel}>Theme</Text>
            <Text style={styles.settingValue}>Dark</Text>
          </View>
          <View style={styles.settingItem}>
            <Text style={styles.settingLabel}>Default Network</Text>
            <Text style={styles.settingValue}>Base</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PROOF SETTINGS</Text>
          <View style={styles.toggleItem}>
            <Toggle
              value={settings.autoSaveProofs}
              onValueChange={(value) => updateSettings({autoSaveProofs: value})}
              label="Auto-save proofs"
            />
          </View>
          <View style={styles.toggleItem}>
            <Toggle
              value={settings.showLiveLogs}
              onValueChange={(value) => updateSettings({showLiveLogs: value})}
              label="Show live logs"
            />
          </View>
          <View style={styles.toggleItem}>
            <Toggle
              value={settings.confirmBeforeGenerate}
              onValueChange={(value) => updateSettings({confirmBeforeGenerate: value})}
              label="Confirm before generate"
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>DATA</Text>
          <MenuItem
            icon="download"
            title="Export Proof History"
            onPress={handleExportHistory}
          />
          <MenuItem
            icon="trash-2"
            title="Clear Local Data"
            onPress={handleClearData}
          />
        </View>
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
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 14,
    color: '#9CA3AF',
    fontWeight: '600',
    marginBottom: 12,
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: '#1A2332',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2D3748',
    marginBottom: 8,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  settingValue: {
    fontSize: 15,
    color: '#9CA3AF',
  },
  toggleItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#1A2332',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2D3748',
    marginBottom: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: '#9CA3AF',
  },
});

export default SettingsScreen;

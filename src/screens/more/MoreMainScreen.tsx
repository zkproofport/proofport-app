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
  Pressable,
} from 'react-native';
import {Toggle} from '../../components/ui/molecules/Toggle';
import {MenuItem} from '../../components/ui/molecules/MenuItem';
import {useSettings} from '../../hooks/useSettings';
import {useProofHistory} from '../../hooks/useProofHistory';
import {useThemeColors} from '../../context';
import type {MoreTabScreenProps} from '../../navigation/types';

const MoreMainScreen: React.FC<MoreTabScreenProps<'MoreMain'>> = ({
  navigation,
}) => {
  const {settings, loading, updateSettings} = useSettings();
  const {exportToJSON, clearAll} = useProofHistory();
  const {mode, colors: themeColors, setThemeMode} = useThemeColors();

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
      <SafeAreaView style={[styles.container, {backgroundColor: themeColors.background.primary}]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={[styles.loadingText, {color: themeColors.text.secondary}]}>Loading settings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, {backgroundColor: themeColors.background.primary}]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}>
        <Text style={[styles.header, {color: themeColors.text.primary}]}>More</Text>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, {color: themeColors.text.secondary}]}>GENERAL</Text>
          <View style={[styles.settingItem, {backgroundColor: themeColors.background.secondary, borderColor: themeColors.border.primary}]}>
            <Text style={[styles.settingLabel, {color: themeColors.text.primary}]}>Language</Text>
            <Text style={[styles.settingValue, {color: themeColors.text.secondary}]}>English</Text>
          </View>
          <View style={[styles.settingItem, {backgroundColor: themeColors.background.secondary, borderColor: themeColors.border.primary}]}>
            <Text style={[styles.settingLabel, {color: themeColors.text.primary}]}>Theme</Text>
            <View style={styles.themeOptions}>
              <Pressable
                style={[
                  styles.themeOption,
                  {borderColor: mode === 'dark' ? '#3B82F6' : themeColors.border.primary},
                  mode === 'dark' && styles.themeOptionActive,
                ]}
                onPress={() => setThemeMode('dark')}>
                <Text style={[
                  styles.themeOptionText,
                  {color: mode === 'dark' ? '#3B82F6' : themeColors.text.secondary},
                ]}>Dark</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.themeOption,
                  {borderColor: mode === 'light' ? '#3B82F6' : themeColors.border.primary},
                  mode === 'light' && styles.themeOptionActive,
                ]}
                onPress={() => setThemeMode('light')}>
                <Text style={[
                  styles.themeOptionText,
                  {color: mode === 'light' ? '#3B82F6' : themeColors.text.secondary},
                ]}>Light</Text>
              </Pressable>
            </View>
          </View>
          <View style={[styles.settingItem, {backgroundColor: themeColors.background.secondary, borderColor: themeColors.border.primary}]}>
            <Text style={[styles.settingLabel, {color: themeColors.text.primary}]}>Default Network</Text>
            <Text style={[styles.settingValue, {color: themeColors.text.secondary}]}>Base</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, {color: themeColors.text.secondary}]}>PROOF SETTINGS</Text>
          <View style={[styles.toggleItem, {backgroundColor: themeColors.background.secondary, borderColor: themeColors.border.primary}]}>
            <Toggle
              value={settings.autoSaveProofs}
              onValueChange={(value) => updateSettings({autoSaveProofs: value})}
              label="Auto-save proofs"
            />
          </View>
          <View style={[styles.toggleItem, {backgroundColor: themeColors.background.secondary, borderColor: themeColors.border.primary}]}>
            <Toggle
              value={settings.showLiveLogs}
              onValueChange={(value) => updateSettings({showLiveLogs: value})}
              label="Show live logs"
            />
          </View>
          <View style={[styles.toggleItem, {backgroundColor: themeColors.background.secondary, borderColor: themeColors.border.primary}]}>
            <Toggle
              value={settings.confirmBeforeGenerate}
              onValueChange={(value) => updateSettings({confirmBeforeGenerate: value})}
              label="Confirm before generate"
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, {color: themeColors.text.secondary}]}>DATA</Text>
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

        <View style={[styles.separator, {backgroundColor: themeColors.border.primary}]} />

        <MenuItem
          icon="info"
          title="About"
          subtitle="Version, Support"
          onPress={() => navigation.navigate('About')}
        />

        <Text style={[styles.version, {color: themeColors.text.tertiary}]}>Version 0.0.1</Text>
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
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  settingValue: {
    fontSize: 15,
  },
  toggleItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  separator: {
    height: 1,
    marginBottom: 16,
  },
  version: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 32,
    marginBottom: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
  },
  themeOptions: {
    flexDirection: 'row',
    gap: 8,
  },
  themeOption: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  themeOptionActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.16)',
  },
  themeOptionText: {
    fontSize: 14,
    fontWeight: '500',
  },
});

export default MoreMainScreen;

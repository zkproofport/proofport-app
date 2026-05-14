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
  TouchableOpacity,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {Toggle} from '../../components/ui/molecules/Toggle';
import {MenuItem} from '../../components/ui/molecules/MenuItem';
import {useSettings} from '../../hooks/useSettings';
import {useProofHistory} from '../../hooks/useProofHistory';
import {useThemeColors} from '../../context';
import type {MoreTabScreenProps} from '../../navigation/types';
import {getVersionDisplay} from '../../utils/version';

const MoreMainScreen: React.FC<MoreTabScreenProps<'MoreMain'>> = ({
  navigation,
}) => {
  const { t } = useTranslation();
  const {settings, loading, updateSettings} = useSettings();
  const {exportToJSON, clearAll} = useProofHistory();
  const {mode, colors: themeColors, setThemeMode} = useThemeColors();

  const handleExportHistory = async () => {
    Alert.alert(
      t('host.more.exportTitle'),
      t('host.more.exportMessage'),
      [
        {text: t('common.cancel'), style: 'cancel'},
        {
          text: t('host.more.export'),
          onPress: async () => {
            try {
              const json = await exportToJSON();
              await Share.share({
                message: json,
                title: t('host.more.exportTitle'),
              });
            } catch (error) {
              Alert.alert(t('common.ok'), t('host.more.exportError'));
            }
          },
        },
      ],
    );
  };

  const handleClearData = async () => {
    Alert.alert(
      t('host.more.clearTitle'),
      t('host.more.clearMessage'),
      [
        {text: t('common.cancel'), style: 'cancel'},
        {
          text: t('host.more.clear'),
          style: 'destructive',
          onPress: async () => {
            try {
              await clearAll();
              Alert.alert(t('common.ok'), t('host.more.clearSuccess'));
            } catch (error) {
              Alert.alert(t('common.ok'), t('host.more.clearError'));
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
          <Text style={[styles.loadingText, {color: themeColors.text.secondary}]}>{t('common.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, {backgroundColor: themeColors.background.primary}]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}>
        <Text style={[styles.header, {color: themeColors.text.primary}]}>{t('host.more.title')}</Text>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, {color: themeColors.text.secondary}]}>{t('host.more.sectionGeneral')}</Text>
          <TouchableOpacity
            style={[styles.settingItem, {backgroundColor: themeColors.background.secondary, borderColor: themeColors.border.primary}]}
            onPress={() => navigation.navigate('SettingsLanguage')}
            activeOpacity={0.7}
          >
            <Text style={[styles.settingLabel, {color: themeColors.text.primary}]}>{t('host.more.language')}</Text>
            <Text style={[styles.settingValue, {color: themeColors.text.secondary}]}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.settingItem, {backgroundColor: themeColors.background.secondary, borderColor: themeColors.border.primary}]}
            onPress={() => navigation.navigate('HistoryMain')}
            activeOpacity={0.7}
          >
            <Text style={[styles.settingLabel, {color: themeColors.text.primary}]}>{t('host.more.history')}</Text>
            <Text style={[styles.settingValue, {color: themeColors.text.secondary}]}>›</Text>
          </TouchableOpacity>
          <View style={[styles.settingItem, {backgroundColor: themeColors.background.secondary, borderColor: themeColors.border.primary}]}>
            <Text style={[styles.settingLabel, {color: themeColors.text.primary}]}>{t('host.more.theme')}</Text>
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
                ]}>{t('host.more.themeDark')}</Text>
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
                ]}>{t('host.more.themeLight')}</Text>
              </Pressable>
            </View>
          </View>
          <View style={[styles.settingItem, {backgroundColor: themeColors.background.secondary, borderColor: themeColors.border.primary}]}>
            <Text style={[styles.settingLabel, {color: themeColors.text.primary}]}>{t('host.more.defaultNetwork')}</Text>
            <Text style={[styles.settingValue, {color: themeColors.text.secondary}]}>Base</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, {color: themeColors.text.secondary}]}>{t('host.more.sectionProofSettings')}</Text>
          <View style={[styles.toggleItem, {backgroundColor: themeColors.background.secondary, borderColor: themeColors.border.primary}]}>
            <Toggle
              value={settings.autoSaveProofs}
              onValueChange={(value) => updateSettings({autoSaveProofs: value})}
              label={t('host.more.autoSaveProofs')}
            />
          </View>
          <View style={[styles.toggleItem, {backgroundColor: themeColors.background.secondary, borderColor: themeColors.border.primary}]}>
            <Toggle
              value={settings.confirmBeforeGenerate}
              onValueChange={(value) => updateSettings({confirmBeforeGenerate: value})}
              label={t('host.more.confirmBeforeGenerate')}
            />
          </View>
        </View>

        {settings.developerMode && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, {color: themeColors.text.secondary}]}>{t('host.more.sectionDeveloper')}</Text>
            <View style={[styles.toggleItem, {backgroundColor: themeColors.background.secondary, borderColor: themeColors.border.primary}]}>
              <Toggle
                value={settings.showLiveLogs}
                onValueChange={(value) => updateSettings({showLiveLogs: value})}
                label={t('host.more.showLiveLogs')}
              />
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, {color: themeColors.text.secondary}]}>{t('host.more.sectionData')}</Text>
          <MenuItem
            icon="download"
            title={t('host.more.exportProofHistory')}
            onPress={handleExportHistory}
          />
          <MenuItem
            icon="trash-2"
            title={t('host.more.clearLocalData')}
            onPress={handleClearData}
          />
        </View>

        <View style={[styles.separator, {backgroundColor: themeColors.border.primary}]} />

        <MenuItem
          icon="info"
          title={t('host.more.about')}
          subtitle={t('host.more.versionSupport')}
          onPress={() => navigation.navigate('About')}
        />

        <Text style={[styles.version, {color: themeColors.text.tertiary}]}>{getVersionDisplay()}</Text>
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

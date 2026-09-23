import React from 'react';
import {ActivityIndicator, Alert, NativeModules, Pressable, ScrollView, Share, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useTranslation} from 'react-i18next';
import {Select} from '../../components/ui/molecules/Select';
import {ProofUiIcon} from '../../components/ProofUiIcon';
import {visibleNetworkCategories, OPENSTOA_ENABLED, type NetworkCategoryId} from '../../config';
import {useSettings} from '../../hooks/useSettings';
import {useProofHistory} from '../../hooks/useProofHistory';
import {useError, useThemeColors} from '../../context';
import {useProofUiColors} from '../../theme/proofUi';
import type {MoreTabScreenProps} from '../../navigation/types';
import type {AppSettings} from '../../stores/settingsStore';
import {getVersionDisplay} from '../../utils/version';
import {SettingsGroup, SettingsRow, SettingsToggle} from './SettingsParts';
import {languageOption} from './languages';

const MoreMainScreen: React.FC<MoreTabScreenProps<'MoreMain'>> = ({navigation}) => {
  const {t, i18n} = useTranslation();
  const colors = useProofUiColors();
  const {showError} = useError();
  const {settings, loading, error, updateSettings, refresh} = useSettings();
  const {exportToJSON, clearAll} = useProofHistory();
  const {mode, setThemeMode} = useThemeColors();
  const [openStoaOverride, setOpenStoaOverride] = React.useState(OPENSTOA_ENABLED);
  const [restartRequired, setRestartRequired] = React.useState(false);
  const [dataNotice, setDataNotice] = React.useState(false);
  const [dataBusy, setDataBusy] = React.useState(false);
  const dataOperation = React.useRef(false);

  React.useEffect(() => {
    if (error && !settings) showError('E5002', t('host.more.loadError'));
  }, [error, settings, showError, t]);

  const saveSetting = async (partial: Partial<AppSettings>) => {
    try {await updateSettings(partial);}
    catch {showError('E5001', t('host.more.saveError'));}
  };

  const handleOpenStoaOverride = async (next: boolean) => {
    try {
      // This native preference is read before JS starts; apply it next launch.
      const write = NativeModules.AppEnv?.setOpenStoaOverride;
      if (!write) throw new Error('OpenStoa override is unavailable');
      await write(next);
      setOpenStoaOverride(next);
      setRestartRequired(true);
    } catch {showError('E5001', t('host.more.saveError'));}
  };

  const runDataAction = async (action: 'export' | 'clear') => {
    if (dataOperation.current) return;
    dataOperation.current = true;
    setDataBusy(true);
    setDataNotice(false);
    try {
      if (action === 'clear') {
        await clearAll();
        setDataNotice(true);
      } else {
        const json = await exportToJSON();
        await Share.share({message: json, title: t('host.more.exportTitle')});
      }
    } catch {
      showError(action === 'clear' ? 'E5001' : 'E9999', t(action === 'clear' ? 'host.more.clearError' : 'host.more.exportError'));
    } finally {
      dataOperation.current = false;
      setDataBusy(false);
    }
  };

  const handleExportHistory = () => Alert.alert(t('host.more.exportTitle'), t('host.more.exportMessage'), [
    {text: t('common.cancel'), style: 'cancel'},
    {text: t('host.more.export'), onPress: () => runDataAction('export')},
  ]);
  const handleClearData = () => Alert.alert(t('host.more.clearTitle'), t('host.more.clearMessage'), [
    {text: t('common.cancel'), style: 'cancel'},
    {text: t('host.more.clear'), style: 'destructive', onPress: () => runDataAction('clear')},
  ]);

  if (loading || !settings) {
    return <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, {backgroundColor: colors.background}]}>
      <View style={styles.loading}>
        {loading ? <ActivityIndicator color={colors.blue} /> : <ProofUiIcon name="info" color={colors.secondary} />}
        <Text style={[styles.subtitle, {color: colors.secondary}]}>{t(loading ? 'common.loading' : 'host.more.loadError')}</Text>
        {!loading && <Pressable accessibilityRole="button" onPress={refresh} style={styles.retry}>
          <Text style={[styles.label, {color: colors.blue}]}>{t('common.retry')}</Text>
        </Pressable>}
      </View>
    </SafeAreaView>;
  }

  return <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, {backgroundColor: colors.background}]}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={[styles.brand, {color: colors.secondary}]}>ZKProofport</Text>
        <Text accessibilityRole="header" style={[styles.title, {color: colors.text}]}>{t('host.more.title')}</Text>
        <Text style={[styles.subtitle, {color: colors.secondary}]}>{t('host.more.subtitle')}</Text>
      </View>

      <SettingsGroup title={t('host.more.sectionGeneral')}>
        <SettingsRow testID="more-language" icon="country" title={t('host.more.language')}
          value={languageOption(i18n.language).label} onPress={() => navigation.navigate('SettingsLanguage')} />
        <View style={[styles.themeRow, {borderColor: colors.border}]}>
          <View style={styles.themeLabel}><ProofUiIcon name={mode === 'dark' ? 'moon' : 'sun'} size={21} color={colors.secondary} />
            <Text style={[styles.label, {color: colors.text}]}>{t('host.more.theme')}</Text></View>
          <View style={[styles.themeOptions, {backgroundColor: colors.inset}]}>
            {(['dark', 'light'] as const).map(choice => <Pressable key={choice} testID={`more-theme-${choice}`}
              accessibilityRole="radio" accessibilityState={{selected: mode === choice}}
              onPress={() => setThemeMode(choice)} style={[styles.themeOption, mode === choice && {backgroundColor: colors.card}]}>
              <Text style={[styles.themeOptionText, {color: mode === choice ? colors.text : colors.secondary}]}>{t(choice === 'dark' ? 'host.more.themeDark' : 'host.more.themeLight')}</Text>
            </Pressable>)}
          </View>
        </View>
        <View style={[styles.divider, {borderColor: colors.border}]}>
          <Select<NetworkCategoryId> testID="more-network" icon="country" label={t('host.more.defaultNetwork')}
            value={settings.defaultNetwork as NetworkCategoryId}
            options={visibleNetworkCategories(settings.developerMode, settings.defaultNetwork).map(network => ({value: network.id, label: t(network.labelKey)}))}
            onChange={next => saveSetting({defaultNetwork: next})} pickerTitle={t('host.more.defaultNetwork')} />
        </View>
        {/* OpenStoa owns the fourth tab when enabled; only then keep History here. */}
        {OPENSTOA_ENABLED && <SettingsRow testID="more-history" icon="history" title={t('host.more.history')} separated onPress={() => navigation.navigate('HistoryMain')} />}
      </SettingsGroup>

      <SettingsGroup title={t('host.more.sectionProofSettings')}>
        <SettingsToggle testID="more-auto-save" label={t('host.more.autoSaveProofs')} value={settings.autoSaveProofs} onValueChange={value => saveSetting({autoSaveProofs: value})} />
        <SettingsToggle testID="more-confirm" label={t('host.more.confirmBeforeGenerate')} value={settings.confirmBeforeGenerate} onValueChange={value => saveSetting({confirmBeforeGenerate: value})} separated />
      </SettingsGroup>

      {settings.developerMode && <SettingsGroup title={t('host.more.sectionDeveloper')}>
        <SettingsToggle testID="more-live-logs" label={t('host.more.showLiveLogs')} value={settings.showLiveLogs} onValueChange={value => saveSetting({showLiveLogs: value})} />
        <SettingsToggle testID="more-omnione" label={t('host.more.useOmniOneCxUi')} value={settings.useOmniOneCxUi} onValueChange={value => saveSetting({useOmniOneCxUi: value})} separated />
        <SettingsToggle testID="more-openstoa" label={t('host.more.openStoaEnabled')} value={openStoaOverride} onValueChange={handleOpenStoaOverride}
          description={t('host.more.openStoaEnabledHint')} separated />
        {restartRequired && <Text accessibilityLiveRegion="polite" style={[styles.notice, {color: colors.blue}]}>{t('host.more.openStoaRestartRequired')}</Text>}
      </SettingsGroup>}

      <View style={styles.dataSection}>
        <SettingsGroup title={t('host.more.sectionData')}>
          <SettingsRow testID="more-export-history" icon="download" title={t('host.more.exportProofHistory')} onPress={handleExportHistory} disabled={dataBusy} />
          <SettingsRow testID="more-clear-history" icon="trash" title={t('host.more.clearLocalData')} onPress={handleClearData} destructive disabled={dataBusy} separated />
        </SettingsGroup>
        {dataBusy && <ActivityIndicator color={colors.blue} accessibilityLabel={t('common.loading')} />}
        {dataNotice && <Text testID="more-data-notice" accessibilityLiveRegion="polite" style={[styles.notice, {color: colors.blue}]}>{t('host.more.clearSuccess')}</Text>}
      </View>

      <SettingsGroup title={t('host.more.sectionAbout')}>
        <SettingsRow testID="more-about" icon="info" title={t('host.more.about')} description={t('host.more.versionSupport')}
          value={getVersionDisplay()} onPress={() => navigation.navigate('About')} />
      </SettingsGroup>
    </ScrollView>
  </SafeAreaView>;
};

const styles = StyleSheet.create({
  screen: {flex: 1}, content: {paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36, gap: 24},
  header: {gap: 8}, brand: {fontSize: 17, fontWeight: '600', marginBottom: 12},
  title: {fontSize: 27, lineHeight: 35, fontWeight: '700'}, subtitle: {fontSize: 14, lineHeight: 21},
  label: {fontSize: 15, lineHeight: 21, fontWeight: '500'},
  themeRow: {paddingHorizontal: 16, paddingVertical: 11, gap: 12, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth},
  themeLabel: {flexDirection: 'row', alignItems: 'center', gap: 13}, themeOptions: {flexDirection: 'row', padding: 3, borderRadius: 10},
  themeOption: {minHeight: 38, minWidth: 58, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center'},
  themeOptionText: {fontSize: 13, fontWeight: '600'}, divider: {borderTopWidth: StyleSheet.hairlineWidth},
  notice: {fontSize: 13, lineHeight: 19, paddingHorizontal: 16, paddingBottom: 12}, dataSection: {gap: 12},
  loading: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14}, retry: {padding: 16},
});
export default MoreMainScreen;

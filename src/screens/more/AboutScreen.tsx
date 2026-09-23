import React, {useEffect, useRef, useState} from 'react';
import {Image, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTranslation} from 'react-i18next';
import {useError} from '../../context';
import {useProofUiColors} from '../../theme/proofUi';
import type {MoreTabScreenProps, MoreStackParamList} from '../../navigation/types';
import {getVersionDisplay} from '../../utils/version';
import {useSettings} from '../../hooks/useSettings';
import {SettingsGroup, SettingsRow} from './SettingsParts';

const PRIVACY_POLICY_URL = 'https://github.com/zkproofport/proofport-app/blob/main/docs/legal/privacy-policy.md';
type MoreNavigation = NativeStackNavigationProp<MoreStackParamList>;

const AboutScreen: React.FC<MoreTabScreenProps<'About'>> = () => {
  const {t} = useTranslation();
  const colors = useProofUiColors();
  const {showError} = useError();
  const {settings, updateSettings} = useSettings();
  const navigation = useNavigation<MoreNavigation>();
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingDeveloperMode = useRef(false);
  const [notice, setNotice] = useState<boolean | null>(null);

  useEffect(() => () => {if (tapTimer.current) clearTimeout(tapTimer.current);}, []);
  const handleVersionTap = async () => {
    if (!settings || savingDeveloperMode.current) return;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => {tapCount.current = 0;}, 2000);
    tapCount.current += 1;
    if (tapCount.current < 7) return;
    tapCount.current = 0;
    savingDeveloperMode.current = true;
    setNotice(null);
    try {
      const next = !settings.developerMode;
      await updateSettings({developerMode: next});
      setNotice(next);
    } catch {showError('E5001', t('host.more.saveError'));}
    finally {savingDeveloperMode.current = false;}
  };

  const openURL = (url: string, title: string) => navigation.navigate('InAppBrowser', {url, title});
  return <SafeAreaView edges={['left', 'right', 'bottom']} style={[styles.screen, {backgroundColor: colors.background}]}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={[styles.brandCard, {backgroundColor: colors.card, borderColor: colors.border}]}>
        <Image source={require('../../../assets/logo.png')} style={styles.appIcon} resizeMode="contain" accessible={false} />
        <View style={styles.brandBody}>
          <Text style={[styles.appName, {color: colors.text}]}>ZKProofport</Text>
          <Pressable testID="about-version" accessibilityRole="button" accessibilityLabel={t('host.about.version', {version: getVersionDisplay()})}
            onPress={handleVersionTap} style={styles.versionButton}>
            <Text style={[styles.version, {color: colors.secondary}]}>{getVersionDisplay()}</Text>
          </Pressable>
        </View>
        <Text style={[styles.tagline, {color: colors.secondary}]}>{t('host.about.tagline')}</Text>
      </View>
      {notice !== null && <Text accessibilityLiveRegion="polite" style={[styles.notice, {color: colors.blue}]}>
        {t(notice ? 'host.about.devModeEnabled' : 'host.about.devModeDisabled')}{'\n'}
        {t(notice ? 'host.about.devModeEnabledMsg' : 'host.about.devModeDisabledMsg')}
      </Text>}
      <SettingsGroup title={t('host.about.sectionLinks')}>
        <SettingsRow testID="about-masse" icon="country" title="Masse Labs" description="www.masselabs.com" onPress={() => openURL('https://www.masselabs.com', 'Masse Labs')} />
        <SettingsRow testID="about-proofport" icon="country" title="ZKProofport" description="www.zkproofport.com" onPress={() => openURL('https://www.zkproofport.com', 'ZKProofport')} separated />
        <SettingsRow testID="about-openstoa" icon="country" title="OpenStoa" description="www.openstoa.xyz" onPress={() => openURL('https://www.openstoa.xyz', 'OpenStoa')} separated />
      </SettingsGroup>
      <SettingsGroup title={t('host.about.sectionPoweredBy')}>
        <SettingsRow testID="about-aztec" icon="shield" title="Aztec" description={t('host.about.aztecSubtitle')} onPress={() => openURL('https://aztec.network', 'Aztec')} />
      </SettingsGroup>
      <SettingsGroup title={t('host.about.sectionLegal')}>
        <SettingsRow testID="about-privacy" icon="document" title={t('host.about.privacyPolicy')} onPress={() => openURL(PRIVACY_POLICY_URL, t('host.about.privacyPolicy'))} />
      </SettingsGroup>
    </ScrollView>
  </SafeAreaView>;
};
const styles = StyleSheet.create({
  screen: {flex: 1}, content: {paddingHorizontal: 20, paddingTop: 20, paddingBottom: 32, gap: 24},
  brandCard: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', borderRadius: 14, borderWidth: 1, padding: 18, columnGap: 15, rowGap: 8},
  appIcon: {width: 52, height: 52, borderRadius: 12}, brandBody: {flex: 1, minWidth: 160},
  appName: {fontSize: 21, lineHeight: 27, fontWeight: '700'}, versionButton: {minHeight: 44, justifyContent: 'center'},
  version: {fontSize: 13, lineHeight: 19}, tagline: {width: '100%', fontSize: 13, lineHeight: 20}, notice: {fontSize: 13, lineHeight: 20},
});
export default AboutScreen;

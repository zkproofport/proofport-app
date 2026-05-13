import React, {useState, useRef} from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Linking,
  Alert,
  Pressable,
} from 'react-native';
import {useTranslation} from 'react-i18next';
import {MenuItem} from '../../components/ui/molecules/MenuItem';
import {useThemeColors} from '../../context';

import type {MoreTabScreenProps} from '../../navigation/types';
import {getVersionDisplay} from '../../utils/version';
import {useSettings} from '../../hooks/useSettings';

const MASSE_LABS_URL = 'https://www.masselabs.com';
const OPENSTOA_URL = 'https://www.openstoa.xyz';
const ZKPROOFPORT_URL = 'https://www.zkproofport.com';
const AZTEC_URL = 'https://aztec.network';

const AboutScreen: React.FC<MoreTabScreenProps<'About'>> = () => {
  const {t} = useTranslation();
  const {colors: themeColors} = useThemeColors();
  const {settings, updateSettings} = useSettings();
  const [tapCount, setTapCount] = useState(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleVersionTap = () => {
    const newCount = tapCount + 1;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => setTapCount(0), 2000);

    if (newCount >= 7) {
      const newValue = !settings?.developerMode;
      updateSettings({developerMode: newValue});
      Alert.alert(
        newValue ? t('host.about.devModeEnabled') : t('host.about.devModeDisabled'),
        newValue ? t('host.about.devModeEnabledMsg') : t('host.about.devModeDisabledMsg'),
      );
      setTapCount(0);
    } else {
      setTapCount(newCount);
    }
  };

  const openURL = async (url: string, title: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert(t('common.ok'), t('host.about.openURLError', {title}));
      }
    } catch (error) {
      Alert.alert(t('common.ok'), t('host.about.openURLFailed', {title}));
    }
  };

  return (
    <SafeAreaView style={[styles.container, {backgroundColor: themeColors.background.primary}]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}>
        <View style={styles.headerSection}>
          <Image
            source={require('../../../assets/logo.png')}
            style={styles.appIcon}
            resizeMode="contain"
          />
          <Text style={[styles.appName, {color: themeColors.text.primary}]}>
            ZKProofport
          </Text>
          <Pressable onPress={handleVersionTap}>
            <Text style={[styles.version, {color: themeColors.text.secondary}]}>
              {getVersionDisplay()}
            </Text>
          </Pressable>
          <Text style={[styles.tagline, {color: themeColors.text.tertiary}]}>
            {t('host.about.tagline')}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, {color: themeColors.text.secondary}]}>
            {t('host.about.sectionLinks')}
          </Text>
          <MenuItem
            icon="globe"
            title="Masse Labs"
            subtitle="www.masselabs.com"
            onPress={() => openURL(MASSE_LABS_URL, 'Masse Labs')}
          />
          <MenuItem
            icon="globe"
            title="ZKProofport"
            subtitle="www.zkproofport.com"
            onPress={() => openURL(ZKPROOFPORT_URL, 'ZKProofport')}
          />
          <MenuItem
            icon="globe"
            title="OpenStoa"
            subtitle="www.openstoa.xyz"
            onPress={() => openURL(OPENSTOA_URL, 'OpenStoa')}
          />
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, {color: themeColors.text.secondary}]}>
            {t('host.about.sectionPoweredBy')}
          </Text>
          <MenuItem
            icon="link"
            title="Aztec"
            subtitle={t('host.about.aztecSubtitle')}
            onPress={() => openURL(AZTEC_URL, 'Aztec')}
          />
        </View>
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
  headerSection: {
    alignItems: 'center',
    paddingVertical: 32,
    marginBottom: 16,
  },
  appIcon: {
    width: 80,
    height: 80,
    borderRadius: 18,
    marginBottom: 16,
  },
  appName: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  version: {
    fontSize: 14,
    marginBottom: 8,
  },
  tagline: {
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
});

export default AboutScreen;

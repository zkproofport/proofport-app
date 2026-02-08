import React from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Linking,
  Alert,
} from 'react-native';
import {MenuItem} from '../../components/ui/molecules/MenuItem';
import {useThemeColors} from '../../context';
import {getEnvironment} from '../../config/environment';
import type {MoreTabScreenProps} from '../../navigation/types';

const getWebsiteUrl = (): string => {
  const env = getEnvironment();
  return env === 'development'
    ? 'https://stg.zkproofport.app'
    : 'https://zkproofport.app';
};

const getWebsiteDisplayHost = (): string => {
  const env = getEnvironment();
  return env === 'development' ? 'stg.zkproofport.app' : 'zkproofport.app';
};

const AZTEC_URL = 'https://aztec.network';

const AboutScreen: React.FC<MoreTabScreenProps<'About'>> = () => {
  const {colors: themeColors} = useThemeColors();

  const openURL = async (url: string, title: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert('Error', `Cannot open ${title}`);
      }
    } catch (error) {
      Alert.alert('Error', `Failed to open ${title}`);
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
          <Text style={[styles.version, {color: themeColors.text.secondary}]}>
            Version 0.0.1
          </Text>
          <Text style={[styles.tagline, {color: themeColors.text.tertiary}]}>
            Privacy-first zero-knowledge proof generation
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, {color: themeColors.text.secondary}]}>
            LINKS
          </Text>
          <MenuItem
            icon="globe"
            title="Website"
            subtitle={getWebsiteDisplayHost()}
            onPress={() => openURL(getWebsiteUrl(), 'Website')}
          />
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, {color: themeColors.text.secondary}]}>
            POWERED BY
          </Text>
          <MenuItem
            icon="link"
            title="Aztec"
            subtitle="Zero-knowledge proof infrastructure"
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

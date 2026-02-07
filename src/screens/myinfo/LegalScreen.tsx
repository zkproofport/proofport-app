import React from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Linking,
  Alert,
} from 'react-native';
import {MenuItem} from '../../components/ui/molecules/MenuItem';
import type {MyInfoTabScreenProps} from '../../navigation/types';
import {useThemeColors} from '../../context';

const LEGAL_URLS = {
  terms: 'https://zkproofport.io/terms',
  privacy: 'https://zkproofport.io/privacy',
  licenses: 'https://zkproofport.io/licenses',
  disclaimer: 'https://zkproofport.io/disclaimer',
  gdpr: 'https://zkproofport.io/gdpr',
};

const LegalScreen: React.FC<MyInfoTabScreenProps<'Legal'>> = () => {
  const { colors: themeColors } = useThemeColors();

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
        <View style={styles.section}>
          <MenuItem
            icon="file-text"
            title="Terms of Service"
            subtitle="User agreement and terms"
            onPress={() => openURL(LEGAL_URLS.terms, 'Terms of Service')}
          />
          <MenuItem
            icon="shield"
            title="Privacy Policy"
            subtitle="How we protect your data"
            onPress={() => openURL(LEGAL_URLS.privacy, 'Privacy Policy')}
          />
          <MenuItem
            icon="book"
            title="Open Source Licenses"
            subtitle="Third-party software licenses"
            onPress={() =>
              openURL(LEGAL_URLS.licenses, 'Open Source Licenses')
            }
          />
          <MenuItem
            icon="alert-triangle"
            title="Disclaimer"
            subtitle="Important legal notices"
            onPress={() => openURL(LEGAL_URLS.disclaimer, 'Disclaimer')}
          />
          <MenuItem
            icon="lock"
            title="GDPR Information"
            subtitle="Data protection rights"
            onPress={() => openURL(LEGAL_URLS.gdpr, 'GDPR Information')}
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
  section: {
    marginBottom: 24,
  },
});

export default LegalScreen;

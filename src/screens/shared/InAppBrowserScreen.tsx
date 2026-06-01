/**
 * InAppBrowserScreen — opens any http(s) URL inside a full-screen WebView
 * so users never leave the app to Safari / system browser.
 *
 * Rule: every http(s) outbound URL in ZKProofport MUST use this screen
 * instead of Linking.openURL. Exceptions (must be documented at call site):
 *   - non-http schemes: mailto:, tel:, wc:, zkproofport:// self-deep-links
 *   - wallet handoff deep links (Privy / RainbowKit / WalletConnect)
 *   - mobileid-app:// and similar OS-level app-switching deep links
 *
 * Registration: ProofStack, WalletStack, MoreStack (any stack that surfaces
 * external URLs). See navigation/stacks/*.tsx.
 */
import React, {useCallback, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import {WebView} from 'react-native-webview';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';
import {useThemeColors} from '../../context';

// Route param shape — used by all stacks that register this screen.
export type InAppBrowserParams = {
  url: string;
  title?: string;
};

type Route = RouteProp<{InAppBrowser: InAppBrowserParams}, 'InAppBrowser'>;

export const InAppBrowserScreen: React.FC = () => {
  const {t} = useTranslation();
  const {colors: themeColors} = useThemeColors();
  const navigation = useNavigation();
  const route = useRoute<Route>();
  const {url, title} = route.params;

  const [pageTitle, setPageTitle] = useState(title ?? '');

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <SafeAreaView style={[styles.container, {backgroundColor: themeColors.background.primary}]}>
      <View style={[styles.header, {borderBottomColor: themeColors.border.primary}]}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Text style={[styles.backText, {color: themeColors.info[500]}]}>{t('common.cancel')}</Text>
        </TouchableOpacity>
        <Text
          style={[styles.title, {color: themeColors.text.primary}]}
          numberOfLines={1}
          ellipsizeMode="tail">
          {pageTitle || url}
        </Text>
        <View style={styles.backButton} />
      </View>
      <WebView
        source={{uri: url}}
        onNavigationStateChange={(state) => {
          if (state.title) setPageTitle(state.title);
        }}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={themeColors.info[400]} />
          </View>
        )}
        style={{flex: 1, backgroundColor: themeColors.background.primary}}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    marginHorizontal: 8,
  },
  backButton: {
    width: 60,
  },
  backText: {
    fontSize: 15,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

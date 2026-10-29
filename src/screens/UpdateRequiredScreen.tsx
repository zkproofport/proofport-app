/**
 * Full-screen block shown when this version is below the published minimum
 * (src/utils/forceUpdate.ts). Nothing else is rendered while it is up: no tab
 * navigator, no proof review, no way past it except the store.
 */
import React, {useCallback} from 'react';
import {Image, Linking, SafeAreaView, StyleSheet, Text, View} from 'react-native';
import {useTranslation} from 'react-i18next';
import {Button} from '../components/ui';
import {useError, useThemeColors} from '../context';
import {BRAND_SYMBOL} from '../constants/brand';
import {getVersion} from '../utils/version';
import {messageFor, type MinVersionRule} from '../utils/forceUpdate';

interface UpdateRequiredScreenProps {
  rule: MinVersionRule;
}

export function UpdateRequiredScreen({rule}: UpdateRequiredScreenProps): React.ReactElement {
  const {t, i18n} = useTranslation();
  const {colors} = useThemeColors();
  const {showError} = useError();
  const message = messageFor(rule, i18n.language) ?? t('host.updateRequired.body');

  const openStore = useCallback(async () => {
    try {
      // Opened OUTSIDE the app on purpose, the same exception as wc:/mailto:
      // links: the App Store / Play listing is where the update happens, and
      // an in-app WebView of the store page cannot install anything.
      // isAllowedStoreUrl already limited this to the platform's store host.
      await Linking.openURL(rule.storeUrl);
    } catch (error) {
      showError('E3009', `${rule.storeUrl}: ${(error as Error)?.message ?? String(error)}`);
    }
  }, [rule.storeUrl, showError]);

  return (
    <SafeAreaView style={[styles.root, {backgroundColor: colors.background.primary}]} testID="update-required">
      <View style={styles.body}>
        <Image source={BRAND_SYMBOL} style={styles.logo} resizeMode="contain" />
        <Text style={[styles.title, {color: colors.text.primary}]}>{t('host.updateRequired.title')}</Text>
        <Text style={[styles.message, {color: colors.text.secondary}]} lineBreakStrategyIOS="hangul-word">{message}</Text>
        <Text style={[styles.versions, {color: colors.text.tertiary}]}>
          {t('host.updateRequired.versions', {current: getVersion(), minimum: rule.minimum})}
        </Text>
      </View>
      <Button title={t('host.updateRequired.button')} onPress={openStore} size="large"
        style={styles.button} testID="update-required-store" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, justifyContent: 'space-between'},
  body: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32},
  logo: {width: 72, height: 72, marginBottom: 24},
  title: {fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 12},
  message: {fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 16},
  versions: {fontSize: 13, textAlign: 'center'},
  button: {marginHorizontal: 24, marginBottom: 32},
});

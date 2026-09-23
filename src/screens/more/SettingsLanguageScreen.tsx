import React, {useEffect, useReducer} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';
import {useTranslation} from 'react-i18next';
import {useError} from '../../context';
import {useProofUiColors} from '../../theme/proofUi';
import {SelectOptionList} from '../../components/ui/molecules/Select';
import {LANGUAGE_OPTIONS, languageOption, type AppLanguage} from './languages';

const LANGUAGE_KEY = 'proofport.language';

const SettingsLanguageScreen: React.FC = () => {
  const colors = useProofUiColors();
  const {showError} = useError();
  const {t} = useTranslation();
  const [, forceUpdate] = useReducer((value: number) => value + 1, 0);

  // Keep this direct subscription: it also updates the selection when a parent
  // navigator remounts during the synchronous part of changeLanguage.
  useEffect(() => {
    const handler = () => forceUpdate();
    i18n.on('languageChanged', handler);
    return () => {i18n.off('languageChanged', handler);};
  }, []);

  const currentLanguage = languageOption(i18n.language).value;
  const handlePress = (target: AppLanguage) => {
    if (target === currentLanguage) return;
    // Storage must not block the language change if its native bridge stalls.
    i18n.changeLanguage(target).then(() => {
      AsyncStorage.setItem(LANGUAGE_KEY, target).catch(() => {
        showError('E5001', t('host.settings.languageSaveError'));
      });
    }).catch(() => {
      showError('E9999', t('host.settings.languageChangeError'));
    });
    forceUpdate();
  };

  return <SafeAreaView edges={['left', 'right', 'bottom']} style={[styles.screen, {backgroundColor: colors.background}]}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={[styles.description, {color: colors.secondary}]}>{t('host.settings.languageDescription')}</Text>
      <View style={[styles.card, {backgroundColor: colors.card, borderColor: colors.border}]}>
        <SelectOptionList testID="settings-language" value={currentLanguage} options={LANGUAGE_OPTIONS} onChange={handlePress} />
      </View>
    </ScrollView>
  </SafeAreaView>;
};
const styles = StyleSheet.create({
  screen: {flex: 1}, content: {paddingHorizontal: 20, paddingTop: 20, paddingBottom: 32, gap: 20},
  description: {fontSize: 14, lineHeight: 21}, card: {borderWidth: 1, borderRadius: 14, overflow: 'hidden'},
});
export default SettingsLanguageScreen;

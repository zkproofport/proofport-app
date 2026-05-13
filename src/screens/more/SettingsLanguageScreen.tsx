import React, { useEffect, useReducer } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';
import { useThemeColors } from '../../context';

const LANGUAGE_KEY = 'proofport.language';

// Self-contained language picker that bypasses useTranslation entirely so
// that the toggle works even when react-i18next's hooks fail to re-render
// (observed in practice with key={i18n.language} cascades and Suspense
// boundary issues). The row labels are static brand names and don't need
// to be translated. The checkmark reflects i18n.language directly via an
// explicit languageChanged subscription.
const SettingsLanguageScreen: React.FC = () => {
  const { colors: themeColors } = useThemeColors();
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const handler = () => forceUpdate();
    i18n.on('languageChanged', handler);
    return () => {
      i18n.off('languageChanged', handler);
    };
  }, []);

  const currentLang: 'en' | 'ko' = i18n.language === 'ko' ? 'ko' : 'en';

  const handlePress = (target: 'en' | 'ko') => {
    if (target === currentLang) return;
    // Fire-and-forget AsyncStorage write so a slow/hung native bridge
    // can't block the language switch. The change is reflected in UI
    // immediately by i18n.changeLanguage which is synchronous-then-promise.
    AsyncStorage.setItem(LANGUAGE_KEY, target).catch((e) => {
      console.warn('[i18n] AsyncStorage write failed', e);
    });
    // i18n.changeLanguage updates i18n.language synchronously and returns
    // a promise; we don't need to await it for the UI to reflect the new
    // value on the next render.
    i18n.changeLanguage(target).catch((e) => {
      console.warn('[i18n] changeLanguage failed', e);
    });
    forceUpdate();
  };

  const options: { lang: 'en' | 'ko'; label: string }[] = [
    { lang: 'en', label: 'English' },
    { lang: 'ko', label: '한국어' },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: themeColors.background.primary }]}>
      <View style={styles.content}>
        {options.map(({ lang, label }) => {
          const isSelected = currentLang === lang;
          return (
            <TouchableOpacity
              key={lang}
              style={[
                styles.row,
                {
                  backgroundColor: themeColors.background.secondary,
                  borderColor: themeColors.border.primary,
                },
              ]}
              onPress={() => void handlePress(lang)}
              activeOpacity={0.7}
            >
              <Text style={[styles.label, { color: themeColors.text.primary }]}>{label}</Text>
              {isSelected && (
                <Text style={styles.checkmark}>✓</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
  },
  checkmark: {
    fontSize: 18,
    color: '#3B82F6',
    fontWeight: '700',
  },
});

export default SettingsLanguageScreen;

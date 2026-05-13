import { useEffect, useReducer } from 'react';
import i18n from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import en from './locales/en.json';
import ko from './locales/ko.json';

const LANGUAGE_KEY = 'proofport.language';

type Language = 'en' | 'ko';

function getDeviceLanguage(): Language {
  try {
    const locale: string | undefined =
      Platform.OS === 'ios'
        ? NativeModules.SettingsManager?.settings?.AppleLocale ||
          NativeModules.SettingsManager?.settings?.AppleLanguages?.[0]
        : NativeModules.I18nManager?.localeIdentifier;
    if (locale && locale.startsWith('ko')) return 'ko';
  } catch {
    // ignore
  }
  return 'en';
}

// Initialize synchronously with the device locale as default; AsyncStorage
// override is applied as soon as we read it (before any render matters).
i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ko: { translation: ko },
    },
    lng: getDeviceLanguage(),
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
    react: {
      // useSuspense=true (library default) requires a Suspense boundary;
      // without one, useTranslation hooks may fail to re-render after
      // i18n.changeLanguage. Disabling suspense forces synchronous
      // subscription to languageChanged events so the in-app language
      // toggle correctly updates all consumers.
      useSuspense: false,
    },
  });

// Async: read persisted language preference and apply it.
AsyncStorage.getItem(LANGUAGE_KEY).then((stored) => {
  if (stored === 'en' || stored === 'ko') {
    i18n.changeLanguage(stored);
  }
}).catch(() => {/* ignore */});

export function setLanguage(lang: Language): void {
  // Fire-and-forget both writes. AsyncStorage on the native bridge has been
  // observed to occasionally hang or block the calling JS frame; awaiting
  // it before i18n.changeLanguage prevented the language switch from taking
  // effect when the user toggled languages back and forth in-app.
  AsyncStorage.setItem(LANGUAGE_KEY, lang).catch((e) => {
    console.warn('[i18n] AsyncStorage write failed', e);
  });
  i18n.changeLanguage(lang).catch((e) => {
    console.warn('[i18n] changeLanguage failed', e);
  });
}

export function getLanguage(): Language {
  const lang = i18n.language;
  if (lang === 'ko') return 'ko';
  return 'en';
}

export function useLanguage(): { language: Language; setLanguage: (lang: Language) => void } {
  const { i18n: i18nInstance } = useTranslation();
  // Belt-and-suspenders: subscribe directly to languageChanged so consumers
  // re-render even if useTranslation's internal forceUpdate is lost across
  // navigator remounts (observed when key={i18n.language} cascades).
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const handler = () => forceUpdate();
    i18n.on('languageChanged', handler);
    return () => {
      i18n.off('languageChanged', handler);
    };
  }, []);
  const language: Language = i18nInstance.language === 'ko' ? 'ko' : 'en';
  return { language, setLanguage };
}

/**
 * Hook for any component that needs to re-render when the language changes
 * but only consumes the resolved language string. Equivalent to a
 * minimal useTranslation that bypasses the suspense / event-subscription
 * gotchas of react-i18next under heavy navigator remounting.
 */
export function useCurrentLanguage(): Language {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const handler = () => forceUpdate();
    i18n.on('languageChanged', handler);
    return () => {
      i18n.off('languageChanged', handler);
    };
  }, []);
  return i18n.language === 'ko' ? 'ko' : 'en';
}

export default i18n;

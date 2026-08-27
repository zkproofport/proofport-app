import { NativeModules, Platform } from 'react-native';

export type Language = 'en' | 'ko';

/**
 * The phone's language, as the phone reports it.
 *
 * `Intl` FIRST, and that is the fix rather than a preference. This used to read
 * `NativeModules` alone, and on this app's architecture (`fabric: true`) the
 * fields it wanted are not there. Measured on a ko-KR device, 2026-08-27:
 *
 *   {"i18nManager":null,"settingsManager":null,"intlLocale":"ko-KR"}
 *   {"appEnv":0,"i18nManager":"present","settingsManager":"missing"}
 *
 * Read those together, because the first line alone misleads — it did mislead
 * me. The module OBJECT is there (`I18nManager: present`); what is missing is
 * `localeIdentifier` ON it, and `SettingsManager` (an iOS module) is absent on
 * Android entirely. So both lookups returned null, the function fell through to
 * its `'en'` default, and EVERY Korean-language user saw an English app. The
 * translations were complete the whole time; nothing could reach them.
 *
 * `Object.keys(NativeModules).length === 0` is NOT evidence of an empty bridge
 * either: the new architecture resolves modules through a lazy proxy, so keys do
 * not enumerate while access still works. Custom modules (`AppEnv`,
 * `OpenStoaTak`) are unaffected and keep working.
 *
 * Hermes here is built with `intl`, so `resolvedOptions().locale` answers with
 * the real locale and needs no new dependency. The `NativeModules` path is kept
 * BELOW it rather than deleted: it is what an older-architecture build would
 * still answer with, and it costs nothing when the first path succeeds.
 */
export function getDeviceLanguage(): Language {
  try {
    const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (intlLocale && intlLocale.toLowerCase().startsWith('ko')) return 'ko';
    // A locale that resolved to something else is an ANSWER, not a miss — do not
    // fall through to the bridge and risk contradicting it.
    if (intlLocale) return 'en';
  } catch {
    // No `intl` in this Hermes build; fall through to the bridge.
  }

  try {
    const locale: string | undefined =
      Platform.OS === 'ios'
        ? NativeModules.SettingsManager?.settings?.AppleLocale ||
          NativeModules.SettingsManager?.settings?.AppleLanguages?.[0]
        : NativeModules.I18nManager?.localeIdentifier;
    if (locale && locale.toLowerCase().startsWith('ko')) return 'ko';
  } catch {
    // ignore
  }
  return 'en';
}

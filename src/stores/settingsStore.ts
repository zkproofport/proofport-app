import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTINGS_KEY = '@zkproofport:settings:app';

export interface AppSettings {
  autoSaveProofs: boolean;
  showLiveLogs: boolean;
  confirmBeforeGenerate: boolean;
  developerMode: boolean;
  theme: 'dark' | 'light';
  /* No `language` here on purpose. The app's language lives in i18n, keyed
   * `proofport.language` (src/i18n/index.ts) — the phone's language at first
   * run, overridden by whatever the user picks in More > Language. A second
   * field of the same name in this store read like the language setting and
   * was wired to nothing: no screen wrote it, no screen read it. Anyone
   * "fixing" the picker to write here would silently break the setting. */
  defaultNetwork: string;
  /**
   * Developer-mode toggle for the Korea mDL flow. When true (default),
   * OmniOne CX runs through the RAON standard widget (WebView) which
   * owns app selection. When false, the app drives the raw 4-stage
   * OACX HTTP API and deep-links into the mobile-ID app directly
   * (oacxClient.ts::runAppAuthFlow). Only surfaced in Developer Mode.
   */
  useOmniOneCxUi: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  autoSaveProofs: true,
  showLiveLogs: true,
  confirmBeforeGenerate: true,
  developerMode: false,
  theme: 'dark',
  defaultNetwork: 'base',
  useOmniOneCxUi: true,
};

export const settingsStore = {
  async get(): Promise<AppSettings> {
    try {
      const json = await AsyncStorage.getItem(SETTINGS_KEY);
      if (!json) {
        return DEFAULT_SETTINGS;
      }
      return { ...DEFAULT_SETTINGS, ...JSON.parse(json) };
    } catch (error) {
      console.error('Failed to load settings:', error);
      return DEFAULT_SETTINGS;
    }
  },

  async update(partial: Partial<AppSettings>): Promise<AppSettings> {
    try {
      const current = await this.get();
      const updated = { ...current, ...partial };
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
      return updated;
    } catch (error) {
      console.error('Failed to update settings:', error);
      throw error;
    }
  },

  async reset(): Promise<AppSettings> {
    try {
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(DEFAULT_SETTINGS));
      return DEFAULT_SETTINGS;
    } catch (error) {
      console.error('Failed to reset settings:', error);
      throw error;
    }
  },
};

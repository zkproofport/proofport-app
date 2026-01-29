import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTINGS_KEY = '@zkproofport:settings:app';

export interface AppSettings {
  autoSaveProofs: boolean;
  showLiveLogs: boolean;
  confirmBeforeGenerate: boolean;
  theme: 'dark' | 'light';
  language: string;
  defaultNetwork: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  autoSaveProofs: true,
  showLiveLogs: true,
  confirmBeforeGenerate: true,
  theme: 'dark',
  language: 'en',
  defaultNetwork: 'base',
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

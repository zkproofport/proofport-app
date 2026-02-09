import { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { settingsStore, AppSettings } from '../stores';

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await settingsStore.get();
      setSettings(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load settings'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Refresh settings whenever the screen gains focus so changes from other screens are picked up
  useFocusEffect(
    useCallback(() => {
      loadSettings();
    }, [loadSettings])
  );

  const updateSettings = useCallback(async (partial: Partial<AppSettings>) => {
    try {
      const updated = await settingsStore.update(partial);
      setSettings(updated);
      return updated;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to update settings'));
      throw err;
    }
  }, []);

  const resetSettings = useCallback(async () => {
    try {
      const defaults = await settingsStore.reset();
      setSettings(defaults);
      return defaults;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to reset settings'));
      throw err;
    }
  }, []);

  return {
    settings,
    loading,
    error,
    updateSettings,
    resetSettings,
    refresh: loadSettings,
  };
}

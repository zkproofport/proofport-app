import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getColors, type ThemeMode, type ThemeColors } from '../theme';
import { settingsStore } from '../stores';

interface ThemeContextType {
  mode: ThemeMode;
  colors: ThemeColors;
  setThemeMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  mode: 'dark',
  colors: getColors('dark'),
  setThemeMode: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setMode] = useState<ThemeMode>('dark');

  useEffect(() => {
    settingsStore.get().then(settings => {
      setMode(settings.theme);
    });
  }, []);

  const setThemeMode = useCallback((newMode: ThemeMode) => {
    setMode(newMode);
    settingsStore.update({ theme: newMode });
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, colors: getColors(mode), setThemeMode }}>
      {children}
    </ThemeContext.Provider>
  );
};

export function useThemeColors() {
  return useContext(ThemeContext);
}

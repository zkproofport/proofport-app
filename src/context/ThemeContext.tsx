import React, {createContext, useCallback, useContext, useEffect, useRef, useState} from 'react';
import i18n from 'i18next';
import {getColors, type ThemeMode, type ThemeColors} from '../theme';
import {settingsStore} from '../stores';
import {showGlobalError} from '../utils/errorBridge';

interface ThemeContextType {
  mode: ThemeMode;
  colors: ThemeColors;
  setThemeMode: (mode: ThemeMode) => void;
}
const ThemeContext = createContext<ThemeContextType>({
  mode: 'dark', colors: getColors('dark'), setThemeMode: () => {},
});

export const ThemeProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [mode, setMode] = useState<ThemeMode>('dark');
  const savedMode = useRef<ThemeMode>('dark');
  const selection = useRef(0);
  const pendingWrite = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    pendingWrite.current = settingsStore.get().then(settings => {
      savedMode.current = settings.theme;
      if (mounted.current && selection.current === 0) setMode(settings.theme);
    }).catch(() => {
      // ThemeProvider wraps ErrorProvider, so use the bridge that can hold an
      // error until the modal has mounted instead of reading ErrorContext.
      showGlobalError('E5002', i18n.t('host.more.loadError'));
    });
    return () => {mounted.current = false;};
  }, []);

  const setThemeMode = useCallback((newMode: ThemeMode) => {
    const request = ++selection.current;
    setMode(newMode);
    // Keep the visual response immediate while saving in selection order.
    // A failed older save must not undo a more recent tap.
    pendingWrite.current = pendingWrite.current.then(async () => {
      try {
        await settingsStore.update({theme: newMode});
        savedMode.current = newMode;
      } catch {
        if (mounted.current && request === selection.current) setMode(savedMode.current);
        showGlobalError('E5001', i18n.t('host.more.saveError'));
      }
    });
  }, []);

  return <ThemeContext.Provider value={{mode, colors: getColors(mode), setThemeMode}}>{children}</ThemeContext.Provider>;
};
export function useThemeColors() {return useContext(ThemeContext);}

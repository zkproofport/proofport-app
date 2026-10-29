import AsyncStorage from '@react-native-async-storage/async-storage';
import {NETWORK_CATEGORIES} from '../config/networks';

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
   * The Laboratory: GIWA and the Dojang Playground
   * (`surface: 'laboratory'` in src/screens/proof/proofCatalog.ts).
   * Off until the person turns it on in More. Off hides the Proof-tab entry
   * and the lab-only wallet rows, skips their startup download, and refuses a
   * dApp request for one of them with E1008. It is an ordinary setting, not a
   * Developer Mode tool -- Developer Mode gates no circuit
   * (src/__tests__/developerModeGatesNoCircuit.test.ts).
   */
  laboratoryEnabled: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  autoSaveProofs: true,
  showLiveLogs: true,
  confirmBeforeGenerate: true,
  developerMode: false,
  theme: 'dark',
  defaultNetwork: 'base',
  laboratoryEnabled: false,
};

// Every partial update reads after the preceding write settles. More, theme,
// and developer settings share this queue even when they use separate hooks.
let pendingMutation: Promise<void> = Promise.resolve();
function serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingMutation.then(operation);
  pendingMutation = result.then(() => {}, () => {});
  return result;
}

export const settingsStore = {
  async get(): Promise<AppSettings> {
    const json = await AsyncStorage.getItem(SETTINGS_KEY);
    if (json === null) return {...DEFAULT_SETTINGS};
    const saved: unknown = JSON.parse(json);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
      throw new Error('Saved settings must be a JSON object.');
    }
    // Missing keys in older versions acquire their initial defaults. A failed
    // read or corrupt payload must reject, so an update cannot erase it.
    const merged: AppSettings = {...DEFAULT_SETTINGS, ...saved};
    // The default network is a picker preference with no behaviour behind it
    // (CLAUDE.md's display-value exception). A saved network the app no
    // longer has -- `arc` (2026-10-13), `omnione` (2026-10-29) -- would
    // otherwise sit in the More picker as a raw id with no option to match it.
    if (!NETWORK_CATEGORIES.some(n => n.id === merged.defaultNetwork)) {
      console.log(
        `[settings] saved defaultNetwork '${merged.defaultNetwork}' is not a known network ` +
          `(${NETWORK_CATEGORIES.map(n => n.id).join(', ')}); showing '${DEFAULT_SETTINGS.defaultNetwork}'`,
      );
      merged.defaultNetwork = DEFAULT_SETTINGS.defaultNetwork;
    }
    // Only a real `true` turns the Laboratory on. A hand-edited or migrated
    // value such as the string "false" is truthy and would open it; throwing
    // instead would leave the setting unreadable AND unrepairable, because
    // every update reads first. So it reads as off, which the switch shows.
    if (typeof merged.laboratoryEnabled !== 'boolean') {
      console.log(
        `[settings] saved laboratoryEnabled ${JSON.stringify(merged.laboratoryEnabled)} is not a boolean; reading it as off`,
      );
      merged.laboratoryEnabled = false;
    }
    return merged;
  },

  update(partial: Partial<AppSettings>): Promise<AppSettings> {
    const requested = {...partial};
    return serializeMutation(async () => {
      const current = await settingsStore.get();
      const updated = {...current, ...requested};
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
      return updated;
    });
  },

  reset(): Promise<AppSettings> {
    return serializeMutation(async () => {
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(DEFAULT_SETTINGS));
      return {...DEFAULT_SETTINGS};
    });
  },
};

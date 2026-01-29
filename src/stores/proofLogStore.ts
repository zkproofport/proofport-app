import AsyncStorage from '@react-native-async-storage/async-storage';

const LOG_KEY_PREFIX = '@zkproofport:proofLogs:';

export const proofLogStore = {
  async save(historyId: string, logs: string[]): Promise<void> {
    try {
      await AsyncStorage.setItem(`${LOG_KEY_PREFIX}${historyId}`, JSON.stringify(logs));
    } catch (error) {
      console.error('Failed to save proof logs:', error);
    }
  },

  async get(historyId: string): Promise<string[]> {
    try {
      const json = await AsyncStorage.getItem(`${LOG_KEY_PREFIX}${historyId}`);
      return json ? JSON.parse(json) : [];
    } catch (error) {
      console.error('Failed to load proof logs:', error);
      return [];
    }
  },

  async append(historyId: string, newLogs: string[]): Promise<void> {
    try {
      const existing = await this.get(historyId);
      const combined = [...existing, ...newLogs];
      await AsyncStorage.setItem(`${LOG_KEY_PREFIX}${historyId}`, JSON.stringify(combined));
    } catch (error) {
      console.error('Failed to append proof logs:', error);
    }
  },

  async remove(historyId: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(`${LOG_KEY_PREFIX}${historyId}`);
    } catch (error) {
      console.error('Failed to remove proof logs:', error);
    }
  },
};

import AsyncStorage from '@react-native-async-storage/async-storage';

const PROOF_HISTORY_KEY = '@zkproofport:proofHistory:items';

export interface ProofHistoryItem {
  id: string;
  circuitId: string;
  circuitName: string;
  proofHash: string;
  offChainStatus: 'verified' | 'pending' | 'failed' | 'generated';
  onChainStatus: 'verified' | 'pending' | 'failed' | 'generated';
  overallStatus: 'started' | 'generating' | 'failed' | 'pending' | 'generated' | 'verified' | 'verified_failed';
  timestamp: string;
  network: string;
  walletAddress: string;
  verifierAddress?: string;
  source?: 'manual' | 'deeplink';
  dappName?: string;
  requestId?: string;
}

export const proofHistoryStore = {
  async getAll(): Promise<ProofHistoryItem[]> {
    try {
      const json = await AsyncStorage.getItem(PROOF_HISTORY_KEY);
      if (!json) {
        return [];
      }
      const items = JSON.parse(json);
      return items.map((item: any) => {
        if (!item.offChainStatus && !item.onChainStatus) {
          const oldStatus = item.status || 'pending';
          const legacy = {
            ...item,
            offChainStatus: oldStatus,
            onChainStatus: oldStatus,
            overallStatus: item.overallStatus || (item.status === 'verified' ? 'verified' : item.status === 'failed' ? 'failed' : 'pending'),
          };
          if (legacy.proofHash && legacy.proofHash.length > 0) {
            if (legacy.offChainStatus === 'pending') legacy.offChainStatus = 'generated';
            if (legacy.onChainStatus === 'pending') legacy.onChainStatus = 'generated';
            if (legacy.overallStatus === 'pending') legacy.overallStatus = 'generated';
          }
          if (!legacy.source) legacy.source = 'manual';
          return legacy;
        }
        const migrated = {
          ...item,
          offChainStatus: item.offChainStatus || 'pending',
          onChainStatus: item.onChainStatus || 'pending',
          overallStatus: item.overallStatus || (item.status === 'verified' ? 'verified' : item.status === 'failed' ? 'failed' : 'pending'),
        };
        // Migrate: pending with proof -> generated
        if (migrated.proofHash && migrated.proofHash.length > 0) {
          if (migrated.offChainStatus === 'pending') migrated.offChainStatus = 'generated';
          if (migrated.onChainStatus === 'pending') migrated.onChainStatus = 'generated';
          if (migrated.overallStatus === 'pending') migrated.overallStatus = 'generated';
        }
        if (!migrated.source) migrated.source = 'manual';
        return migrated;
      });
    } catch (error) {
      console.error('Failed to load proof history:', error);
      return [];
    }
  },

  async add(item: Omit<ProofHistoryItem, 'id'>): Promise<ProofHistoryItem> {
    try {
      const items = await this.getAll();
      const newItem: ProofHistoryItem = {
        ...item,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      };
      items.unshift(newItem);
      await AsyncStorage.setItem(PROOF_HISTORY_KEY, JSON.stringify(items));
      return newItem;
    } catch (error) {
      console.error('Failed to add proof history item:', error);
      throw error;
    }
  },

  async update(id: string, updates: Partial<Omit<ProofHistoryItem, 'id'>>): Promise<void> {
    try {
      const items = await this.getAll();
      const index = items.findIndex(item => item.id === id);
      if (index !== -1) {
        items[index] = {...items[index], ...updates};
        await AsyncStorage.setItem(PROOF_HISTORY_KEY, JSON.stringify(items));
      }
    } catch (error) {
      console.error('Failed to update proof history item:', error);
      throw error;
    }
  },

  async remove(id: string): Promise<void> {
    try {
      const items = await this.getAll();
      const filtered = items.filter(item => item.id !== id);
      await AsyncStorage.setItem(PROOF_HISTORY_KEY, JSON.stringify(filtered));
    } catch (error) {
      console.error('Failed to remove proof history item:', error);
      throw error;
    }
  },

  async clear(): Promise<void> {
    try {
      await AsyncStorage.removeItem(PROOF_HISTORY_KEY);
    } catch (error) {
      console.error('Failed to clear proof history:', error);
      throw error;
    }
  },

  async exportToJSON(): Promise<string> {
    try {
      const items = await this.getAll();
      return JSON.stringify(items, null, 2);
    } catch (error) {
      console.error('Failed to export proof history:', error);
      throw error;
    }
  },
};

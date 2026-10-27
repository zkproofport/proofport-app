import type {HistoryReviewSnapshot} from '../utils/historyReview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {capLogText, fitLogBudget, scrubLogText} from '../utils/proofLog';

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
  review?: HistoryReviewSnapshot;
  /**
   * The text History shows, written when the record is saved, so the list
   * never has to look a circuit up (src/screens/history/historyRecordText.ts).
   * Absent on records saved before 2026-10-23; those show their raw values.
   */
  display?: {title: string; icon: string; conditions: {label?: string; value: unknown}[]};
  /**
   * The attempt's log, kept only when Developer Mode and live logs were on
   * (src/utils/proofLog.ts). Plain text, scrubbed of secrets, size-capped per
   * record and across all records. Absent otherwise and on older records.
   */
  log?: string;
}

// Every write reads the list first, so two writes in flight (the generation
// screen's and the completion screen's) would otherwise drop one another's
// fields. Writes run one after another.
let pendingWrite: Promise<unknown> = Promise.resolve();
function serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingWrite.then(operation);
  pendingWrite = result.then(() => {}, () => {});
  return result;
}

/** A `log` update, scrubbed and capped here so no caller can store a raw one. */
function storableUpdates(updates: Partial<Omit<ProofHistoryItem, 'id'>>): Partial<Omit<ProofHistoryItem, 'id'>> {
  if (!Object.prototype.hasOwnProperty.call(updates, 'log')) return updates;
  const {log, ...rest} = updates;
  if (typeof log !== 'string' || log.trim() === '') return rest;
  return {...rest, log: capLogText(scrubLogText(log))};
}

export const proofHistoryStore = {
  async getAll(): Promise<ProofHistoryItem[]> {
    try {
      const json = await AsyncStorage.getItem(PROOF_HISTORY_KEY);
      if (!json) {
        return [];
      }
      const items = JSON.parse(json);
      if (!Array.isArray(items)) throw new Error('Invalid proof history storage.');
      return items.map((item: any) => {
        // A damaged entry is passed through untouched: History shows it as
        // raw text rather than failing the whole list on it.
        if (typeof item !== 'object' || item === null || Array.isArray(item)) return item;
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
      throw error;
    }
  },

  add(item: Omit<ProofHistoryItem, 'id'>): Promise<ProofHistoryItem> {
    return serializeWrite(async () => {
      try {
        const items = await proofHistoryStore.getAll();
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
    });
  },

  update(id: string, updates: Partial<Omit<ProofHistoryItem, 'id'>>): Promise<void> {
    return serializeWrite(async () => {
      try {
        const items = await proofHistoryStore.getAll();
        // `items` may hold damaged entries (non-objects); only a record can match.
        const index = items.findIndex(item => typeof item === 'object' && item !== null && item.id === id);
        if (index !== -1) {
          const safe = storableUpdates(updates);
          items[index] = {...items[index], ...safe};
          // A new log may push the total over the budget; older records give theirs up.
          const fitted = Object.prototype.hasOwnProperty.call(safe, 'log') ? fitLogBudget(items, id) : items;
          await AsyncStorage.setItem(PROOF_HISTORY_KEY, JSON.stringify(fitted));
        }
      } catch (error) {
        console.error('Failed to update proof history item:', error);
        throw error;
      }
    });
  },

  remove(id: string): Promise<void> {
    return serializeWrite(async () => {
      try {
        const items = await proofHistoryStore.getAll();
        // A damaged entry (not an object) is never the one being removed.
        const filtered = items.filter(item => typeof item !== 'object' || item === null || item.id !== id);
        await AsyncStorage.setItem(PROOF_HISTORY_KEY, JSON.stringify(filtered));
      } catch (error) {
        console.error('Failed to remove proof history item:', error);
        throw error;
      }
    });
  },

  clear(): Promise<void> {
    return serializeWrite(async () => {
      try {
        await AsyncStorage.removeItem(PROOF_HISTORY_KEY);
      } catch (error) {
        console.error('Failed to clear proof history:', error);
        throw error;
      }
    });
  },

  async exportToJSON(): Promise<string> {
    try {
      const items = await proofHistoryStore.getAll();
      // Proof logs are left out: the export is shared as a whole, a log
      // leaves the phone only through its own "Copy log" in History.
      const withoutLogs = items.map(item => {
        if (typeof item !== 'object' || item === null || !Object.prototype.hasOwnProperty.call(item, 'log')) return item;
        const {log: _log, ...rest} = item;
        return rest;
      });
      return JSON.stringify(withoutLogs, null, 2);
    } catch (error) {
      console.error('Failed to export proof history:', error);
      throw error;
    }
  },
};

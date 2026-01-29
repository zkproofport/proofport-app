import { useState, useEffect, useCallback } from 'react';
import { proofHistoryStore, ProofHistoryItem } from '../stores';

export function useProofHistory() {
  const [items, setItems] = useState<ProofHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadItems = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await proofHistoryStore.getAll();
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load proof history'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const addItem = useCallback(
    async (item: Omit<ProofHistoryItem, 'id'>) => {
      try {
        const newItem = await proofHistoryStore.add(item);
        setItems(prev => [newItem, ...prev]);
        return newItem;
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to add proof'));
        throw err;
      }
    },
    []
  );

  const removeItem = useCallback(async (id: string) => {
    try {
      await proofHistoryStore.remove(id);
      setItems(prev => prev.filter(item => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to remove proof'));
      throw err;
    }
  }, []);

  const clearAll = useCallback(async () => {
    try {
      await proofHistoryStore.clear();
      setItems([]);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to clear proof history'));
      throw err;
    }
  }, []);

  const exportToJSON = useCallback(async () => {
    try {
      return await proofHistoryStore.exportToJSON();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to export proof history'));
      throw err;
    }
  }, []);

  return {
    items,
    loading,
    error,
    addItem,
    removeItem,
    clearAll,
    exportToJSON,
    refresh: loadItems,
  };
}

import {useCallback, useRef, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {useError} from '../../context';
import {proofHistoryStore, type ProofHistoryItem} from '../../stores';

/** Focus refresh and retry share one guarded read; a late result cannot revive a departed screen. */
export function useHistoryRecords() {
  const {showError} = useError();
  const [items, setItems] = useState<ProofHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const read = ++generation.current;
    setLoading(true);
    setFailed(false);
    try {
      const records = await proofHistoryStore.getAll();
      // No per-record checks. A record is plain text (historyRecordText.ts):
      // one from a removed circuit, or a damaged one, is still shown, and must
      // not take every other record down with it.
      if (read === generation.current) setItems(records);
    } catch (error) {
      if (read === generation.current) {
        setFailed(true);
        showError('E5002', error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (read === generation.current) setLoading(false);
    }
  }, [showError]);
  useFocusEffect(useCallback(() => {
    void refresh();
    return () => {generation.current += 1;};
  }, [refresh]));
  return {items, loading, failed, refresh};
}

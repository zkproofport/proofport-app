import {useState, useRef, useEffect, useCallback} from 'react';
import {ScrollView} from 'react-native';
import {getTimestamp} from '../utils';

export interface UseLogsReturn {
  logs: string[];
  addLog: (message: string) => void;
  clearLogs: () => void;
  logScrollRef: React.RefObject<ScrollView | null>;
}

/**
 * Custom hook for managing log messages with auto-scroll functionality
 */
export const useLogs = (): UseLogsReturn => {
  const [logs, setLogs] = useState<string[]>([]);
  const logScrollRef = useRef<ScrollView>(null);

  // Auto-scroll to bottom when logs change
  useEffect(() => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollToEnd({animated: true});
    }
  }, [logs]);

  const addLog = useCallback((message: string) => {
    const timestamp = getTimestamp();
    setLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  return {
    logs,
    addLog,
    clearLogs,
    logScrollRef,
  };
};

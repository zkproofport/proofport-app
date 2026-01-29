import {useState, useRef, useEffect, useCallback} from 'react';
import {ScrollView} from 'react-native';
import {getTimestamp} from '../utils';

export interface UseLogsReturn {
  logs: string[];
  addLog: (message: string) => void;
  clearLogs: () => void;
  getLatestLogs: () => string[];
  logScrollRef: React.RefObject<ScrollView | null>;
}

/**
 * Custom hook for managing log messages with auto-scroll functionality
 */
export const useLogs = (): UseLogsReturn => {
  const [logs, setLogs] = useState<string[]>([]);
  const logsRef = useRef<string[]>([]);
  const logScrollRef = useRef<ScrollView>(null);

  // Auto-scroll to bottom when logs change
  useEffect(() => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollToEnd({animated: true});
    }
  }, [logs]);

  const addLog = useCallback((message: string) => {
    const timestamp = getTimestamp();
    const entry = `[${timestamp}] ${message}`;
    logsRef.current = [...logsRef.current, entry];
    setLogs(logsRef.current);
  }, []);

  const clearLogs = useCallback(() => {
    logsRef.current = [];
    setLogs([]);
  }, []);

  const getLatestLogs = useCallback(() => {
    return logsRef.current;
  }, []);

  return {
    logs,
    addLog,
    clearLogs,
    getLatestLogs,
    logScrollRef,
  };
};

import React, {useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Platform,
  TouchableOpacity,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {Icon} from '../atoms/Icon';

interface LiveLogsPanelProps {
  logs: string[];
  autoScroll?: boolean;
  maxHeight?: number;
}

// Strip timestamp prefix like "[12:34:56] " from log line
const stripTimestamp = (log: string): string => {
  return log.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '');
};

// Determine line color based on content
const getLineStyle = (line: string): { color: string; fontWeight?: string } => {
  if (line.includes('✓')) {
    return { color: '#10B981', fontWeight: '600' };
  }
  if (line.includes('✗') || line.startsWith('Error') || line.includes('INVALID')) {
    return { color: '#EF4444' };
  }
  if (line.startsWith('#') || line.includes('===')) {
    return { color: '#F59E0B' };
  }
  if (line.startsWith('[')) {
    return { color: '#60A5FA' };
  }
  return { color: '#D1D5DB' };
};

export const LiveLogsPanel: React.FC<LiveLogsPanelProps> = ({
  logs,
  autoScroll = true,
  maxHeight = 250,
}) => {
  const scrollRef = useRef<ScrollView>(null);
  const [copied, setCopied] = useState(false);

  const filteredLogs = logs.filter(log => {
    const clean = stripTimestamp(log).trim();
    return clean.length > 0 && !/^[=\-]+$/.test(clean);
  });

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollToEnd({animated: true});
    }
  }, [logs, autoScroll]);

  const handleCopyLogs = () => {
    const logText = filteredLogs.map(stripTimestamp).join('\n');
    Clipboard.setString(logText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (filteredLogs.length === 0) {
    return null;
  }

  return (
    <View style={[styles.container, {maxHeight}]}>
      <TouchableOpacity
        onPress={handleCopyLogs}
        style={styles.copyButton}
        activeOpacity={0.7}>
        {copied ? (
          <Text style={styles.copiedText}>✓</Text>
        ) : (
          <Icon name="copy" size="sm" color="#6B7280" />
        )}
      </TouchableOpacity>
      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}>
        {filteredLogs.map((log, index) => {
          const cleanLine = stripTimestamp(log);
          const lineStyle = getLineStyle(cleanLine);
          return (
            <Text
              key={index}
              style={[
                styles.logText,
                { color: lineStyle.color },
                lineStyle.fontWeight ? { fontWeight: lineStyle.fontWeight as any } : null,
              ]}>
              {cleanLine}
            </Text>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0F1419',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1F2937',
    overflow: 'hidden',
    position: 'relative',
  },
  copyButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 10,
    padding: 6,
    backgroundColor: 'rgba(15, 20, 25, 0.8)',
    borderRadius: 6,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    paddingRight: 40,  // space for copy button
  },
  logText: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 20,
    color: '#D1D5DB',
  },
  copiedText: {
    fontSize: 14,
    color: '#10B981',
    fontWeight: '600',
  },
});

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
import {useThemeColors} from '../../../context';

interface LiveLogsPanelProps {
  logs: string[];
  autoScroll?: boolean;
  maxHeight?: number;
}

// Strip timestamp prefix like "[12:34:56] " from log line
const stripTimestamp = (log: string): string => {
  return log.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '');
};

export const LiveLogsPanel: React.FC<LiveLogsPanelProps> = ({
  logs,
  autoScroll = true,
  maxHeight = 250,
}) => {
  const scrollRef = useRef<ScrollView>(null);
  const [copied, setCopied] = useState(false);
  const {colors: themeColors} = useThemeColors();

  // Determine line color based on content
  const getLineStyle = (line: string): { color: string; fontWeight?: string } => {
    if (line.includes('✓')) {
      return { color: themeColors.success[500], fontWeight: '600' };
    }
    if (line.includes('✗') || line.startsWith('Error') || line.includes('INVALID')) {
      return { color: themeColors.error[500] };
    }
    if (line.startsWith('#') || line.includes('===')) {
      return { color: themeColors.warning[500] };
    }
    if (line.startsWith('[')) {
      return { color: themeColors.info[400] };
    }
    return { color: themeColors.text.secondary };
  };

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
    <View
      style={[
        styles.container,
        {
          maxHeight,
          backgroundColor: themeColors.background.primary,
          borderColor: themeColors.border.primary,
        },
      ]}>
      <TouchableOpacity
        onPress={handleCopyLogs}
        style={[styles.copyButton, {backgroundColor: 'rgba(15, 20, 25, 0.8)'}]}
        activeOpacity={0.7}>
        {copied ? (
          <Text style={[styles.copiedText, {color: themeColors.success[500]}]}>
            ✓
          </Text>
        ) : (
          <Icon name="copy" size="sm" color={themeColors.text.tertiary} />
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
                {color: lineStyle.color},
                lineStyle.fontWeight ? ({fontWeight: lineStyle.fontWeight as any}) : null,
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
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  copyButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 10,
    padding: 6,
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
  },
  copiedText: {
    fontSize: 14,
    fontWeight: '600',
  },
});

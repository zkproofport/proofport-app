import React from 'react';
import {View, Text, ScrollView, StyleSheet, Platform, TouchableOpacity, Alert} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';

interface LogViewerProps {
  logs: string[];
  scrollRef: React.RefObject<ScrollView | null>;
}

export const LogViewer: React.FC<LogViewerProps> = ({logs, scrollRef}) => {
  const handleCopyLogs = () => {
    const logText = logs.join('\n');
    Clipboard.setString(logText);
    Alert.alert('Copied', 'Logs copied to clipboard');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Logs:</Text>
        <TouchableOpacity style={styles.copyButton} onPress={handleCopyLogs}>
          <Text style={styles.copyButtonText}>Copy All</Text>
        </TouchableOpacity>
      </View>
      <ScrollView ref={scrollRef} style={styles.scroll} nestedScrollEnabled>
        {logs.map((log, index) => (
          <Text key={index} style={styles.logText}>
            {log}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 200,
    margin: 16,
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    padding: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  copyButton: {
    backgroundColor: '#444',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
  },
  copyButtonText: {
    color: '#00FF00',
    fontSize: 12,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  logText: {
    color: '#00FF00',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 4,
  },
});

import React from 'react';
import {Modal, View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import {useError} from '../context/ErrorContext';

export const ErrorModal: React.FC = () => {
  const {error, clearError} = useError();

  if (!error) return null;

  return (
    <Modal
      visible={!!error}
      animationType="slide"
      transparent={true}
      onRequestClose={clearError}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Error Icon */}
          <View style={styles.iconContainer}>
            <View style={styles.errorCircle}>
              <Text style={styles.errorIcon}>!</Text>
            </View>
          </View>

          {/* Error Title */}
          <Text style={styles.title}>{error.title}</Text>

          {/* Error Description */}
          <Text style={styles.description}>{error.description}</Text>

          {/* Technical Details (for developers) */}
          {error.details && (
            <View style={styles.detailsBox}>
              <Text style={styles.detailsText}>{error.details}</Text>
            </View>
          )}

          {/* Error Code */}
          <Text style={styles.errorCode}>Error Code: {error.code}</Text>

          {/* Dismiss Button */}
          <TouchableOpacity style={styles.button} onPress={clearError}>
            <Text style={styles.buttonText}>OK</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: 16,
  },
  errorCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#EF4444',
  },
  errorIcon: {
    fontSize: 28,
    fontWeight: '700',
    color: '#EF4444',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f1f5f9',
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    fontSize: 15,
    color: '#94a3b8',
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  detailsBox: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    width: '100%',
  },
  detailsText: {
    fontSize: 13,
    fontFamily: 'monospace',
    color: '#94a3b8',
    lineHeight: 18,
  },
  errorCode: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#64748b',
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#334155',
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: {
    color: '#f1f5f9',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default ErrorModal;

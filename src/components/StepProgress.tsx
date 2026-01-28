import React from 'react';
import {View, Text, StyleSheet, ActivityIndicator} from 'react-native';

export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'error';

export interface Step {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

interface StepProgressProps {
  steps: Step[];
  title?: string;
}

function getStatusIcon(status: StepStatus): string | null {
  switch (status) {
    case 'completed':
      return '✓';
    case 'error':
      return '✗';
    case 'in_progress':
      return null;
    default:
      return '○';
  }
}

function getStatusColor(status: StepStatus): string {
  switch (status) {
    case 'completed':
      return '#34C759';
    case 'error':
      return '#FF3B30';
    case 'in_progress':
      return '#007AFF';
    default:
      return '#C7C7CC';
  }
}

function getStepLabelColor(status: StepStatus): string {
  switch (status) {
    case 'in_progress':
      return '#007AFF';
    case 'completed':
      return '#34C759';
    case 'error':
      return '#FF3B30';
    default:
      return '#8E8E93';
  }
}

export const StepProgress: React.FC<StepProgressProps> = ({steps, title}) => {

  return (
    <View style={styles.container}>
      {title && <Text style={styles.title}>{title}</Text>}
      {steps.map((step, index) => (
        <View key={step.id} style={styles.stepRow}>
          <View style={styles.stepIndicator}>
            {step.status === 'in_progress' ? (
              <ActivityIndicator size="small" color="#007AFF" />
            ) : (
              <View
                style={[
                  styles.statusCircle,
                  {
                    backgroundColor:
                      step.status === 'pending' ? 'transparent' : getStatusColor(step.status),
                    borderColor: getStatusColor(step.status),
                  },
                ]}>
                <Text
                  style={[
                    styles.statusIcon,
                    {
                      color: step.status === 'pending' ? '#C7C7CC' : '#FFFFFF',
                    },
                  ]}>
                  {getStatusIcon(step.status)}
                </Text>
              </View>
            )}
            {index < steps.length - 1 && (
              <View
                style={[
                  styles.connector,
                  {
                    backgroundColor:
                      step.status === 'completed' ? '#34C759' : '#E5E5EA',
                  },
                ]}
              />
            )}
          </View>
          <View style={styles.stepContent}>
            <Text
              style={[
                styles.stepLabel,
                {
                  color: getStepLabelColor(step.status),
                  fontWeight: step.status === 'in_progress' ? '600' : '400',
                },
              ]}>
              {step.label}
            </Text>
            {step.detail && (
              <Text style={styles.stepDetail}>{step.detail}</Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 40,
  },
  stepIndicator: {
    width: 24,
    alignItems: 'center',
    marginRight: 12,
  },
  statusCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusIcon: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  connector: {
    width: 2,
    flex: 1,
    minHeight: 16,
    marginVertical: 4,
  },
  stepContent: {
    flex: 1,
    paddingBottom: 8,
  },
  stepLabel: {
    fontSize: 14,
    lineHeight: 20,
  },
  stepDetail: {
    fontSize: 11,
    color: '#8E8E93',
    marginTop: 2,
    fontFamily: 'Menlo',
  },
});

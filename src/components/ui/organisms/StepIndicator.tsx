import React, {useEffect, useRef} from 'react';
import {View, Text, StyleSheet, Animated} from 'react-native';
import {Icon} from '../atoms/Icon';

export type StepStatus = 'pending' | 'active' | 'complete' | 'error';

export interface StepData {
  id: string;
  icon: string;
  label: string;
  status: StepStatus;
}

interface StepIndicatorProps {
  steps: StepData[];
}

export const mapHookStepsToUserSteps = (
  hookSteps: Array<{id: string; label: string; status: string}>,
): StepData[] => {
  const statusMap: Record<string, StepStatus> = {
    pending: 'pending',
    in_progress: 'active',
    completed: 'complete',
    error: 'error',
  };

  const iconMap: Record<string, string> = {
    generate_vk: 'key',
    load_vk: 'download',
    generate_proof: 'cpu',
    verify_proof: 'check-circle',
    on_chain_verify: 'shield',
    complete: 'check',
  };

  return hookSteps.map(step => ({
    id: step.id,
    icon: iconMap[step.id] || 'circle',
    label: step.label,
    status: statusMap[step.status] || 'pending',
  }));
};

const StepItem: React.FC<{step: StepData; isLast: boolean}> = ({
  step,
  isLast,
}) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (step.status === 'active') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [step.status, pulseAnim]);

  const getStatusColor = () => {
    switch (step.status) {
      case 'pending':
        return '#6B7280';
      case 'active':
        return '#FFFFFF';
      case 'complete':
        return '#10B981';
      case 'error':
        return '#EF4444';
    }
  };

  const getIconColor = () => {
    switch (step.status) {
      case 'pending':
        return '#6B7280';
      case 'active':
        return '#3B82F6';
      case 'complete':
        return '#10B981';
      case 'error':
        return '#EF4444';
    }
  };

  return (
    <View style={styles.stepContainer}>
      <View style={styles.stepIndicator}>
        <Animated.View
          style={[
            styles.iconCircle,
            {
              backgroundColor: `${getStatusColor()}15`,
              borderColor: getStatusColor(),
              transform: [{scale: pulseAnim}],
            },
          ]}>
          <Icon name={step.icon as any} size="sm" color={getIconColor()} />
        </Animated.View>
        {!isLast && (
          <View
            style={[
              styles.connector,
              {
                backgroundColor:
                  step.status === 'complete' ? '#10B981' : '#374151',
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
              color: getStatusColor(),
              fontWeight: step.status === 'active' ? '600' : '500',
            },
          ]}>
          {step.label}
        </Text>
      </View>
    </View>
  );
};

export const StepIndicator: React.FC<StepIndicatorProps> = ({steps}) => {
  return (
    <View style={styles.container}>
      {steps.map((step, index) => (
        <StepItem
          key={step.id}
          step={step}
          isLast={index === steps.length - 1}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 16,
  },
  stepContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stepIndicator: {
    alignItems: 'center',
    marginRight: 12,
    width: 40,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  connector: {
    width: 2,
    height: 24,
    marginTop: 4,
  },
  stepContent: {
    flex: 1,
    paddingTop: 10,
    paddingBottom: 8,
  },
  stepLabel: {
    fontSize: 14,
    letterSpacing: 0.2,
  },
});

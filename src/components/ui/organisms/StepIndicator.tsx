import React, {useEffect, useRef} from 'react';
import {View, Text, StyleSheet, Animated} from 'react-native';
import {Icon} from '../atoms/Icon';
import {useThemeColors} from '../../../context';

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
  const {mode, colors: themeColors} = useThemeColors();
  const isDark = mode === 'dark';
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
        return isDark ? '#6B7280' : '#9CA3AF';
      case 'active':
        return isDark ? '#FFFFFF' : themeColors.info[500];
      case 'complete':
        return '#10B981';
      case 'error':
        return '#EF4444';
    }
  };

  const getIconColor = () => {
    switch (step.status) {
      case 'pending':
        return isDark ? '#6B7280' : '#9CA3AF';
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
        {/* The active circle pulses to 1.2x, so it grows over the line above
            and below it. An opaque base in the card's own colour hides the line
            under it; the tint sits on top, and zIndex keeps the circle above
            its own connector, which is drawn after it. */}
        <Animated.View
          testID="step-circle"
          style={[
            styles.iconCircle,
            {
              backgroundColor: themeColors.background.secondary,
              borderColor: getStatusColor(),
              transform: [{scale: pulseAnim}],
            },
          ]}>
          <View style={[styles.iconTint, {backgroundColor: `${getStatusColor()}15`}]} />
          <Icon name={step.icon as any} size="sm" color={getIconColor()} />
        </Animated.View>
        {!isLast && (
          <View
            style={[
              styles.connector,
              {
                backgroundColor:
                  step.status === 'complete' ? '#10B981' : isDark ? '#374151' : '#E5E7EB',
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

export const CONNECTOR_MIN_HEIGHT = 28;

const styles = StyleSheet.create({
  container: {
    paddingVertical: 16,
  },
  // The row stretches so the connector can fill whatever height the label
  // takes; a fixed-height line left a gap whenever a label wrapped.
  stepContainer: {
    flexDirection: 'row',
    alignItems: 'stretch',
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
    zIndex: 1,
  },
  iconTint: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
  },
  // Touches the circle above and the circle below: no margin, and it grows.
  connector: {
    width: 2,
    flexGrow: 1,
    minHeight: CONNECTOR_MIN_HEIGHT,
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

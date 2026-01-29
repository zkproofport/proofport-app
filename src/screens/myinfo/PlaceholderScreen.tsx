import React from 'react';
import {View, Text, StyleSheet, SafeAreaView} from 'react-native';
import {Icon} from '../../components/ui/atoms/Icon';
import {Button} from '../../components/ui/molecules/Button';
import type {MyInfoTabScreenProps} from '../../navigation/types';

interface PlaceholderScreenProps {
  navigation: any;
  route: {params?: {type: string}};
}

const SCREEN_INFO: Record<
  string,
  {title: string; description: string; icon: string}
> = {
  notifications: {
    title: 'Notifications',
    description:
      'Stay updated with real-time alerts about your proof generation status, transaction confirmations, and important app updates.',
    icon: 'bell',
  },
  security: {
    title: 'Security',
    description:
      'Secure your app with biometric authentication, manage backup options, and control access to your sensitive proof data.',
    icon: 'lock',
  },
  about: {
    title: 'About',
    description:
      'Learn more about ZKProofPort, check app version, access support resources, and provide feedback to help us improve.',
    icon: 'info',
  },
};

const PlaceholderScreen: React.FC<PlaceholderScreenProps> = ({
  navigation,
  route,
}) => {
  const type = route.params?.type || 'default';
  const info = SCREEN_INFO[type] || {
    title: 'Coming Soon',
    description: 'This feature is currently under development.',
    icon: 'clock',
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Icon name={info.icon as any} size="xl" color="#3B82F6" />
        </View>
        <Text style={styles.title}>Coming Soon</Text>
        <Text style={styles.description}>{info.description}</Text>
        <Button
          title="Go Back"
          onPress={() => navigation.goBack()}
          variant="primary"
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F1419',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 12,
    textAlign: 'center',
  },
  description: {
    fontSize: 15,
    color: '#9CA3AF',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
});

export default PlaceholderScreen;

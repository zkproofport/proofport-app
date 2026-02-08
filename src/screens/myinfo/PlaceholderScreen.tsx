import React from 'react';
import {View, Text, StyleSheet, SafeAreaView} from 'react-native';
import {Icon} from '../../components/ui/atoms/Icon';
import {Button} from '../../components/ui/molecules/Button';
import type {MyInfoTabScreenProps} from '../../navigation/types';
import {useThemeColors} from '../../context';

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
      'Learn more about ZKProofport, check app version, access support resources, and provide feedback to help us improve.',
    icon: 'info',
  },
};

const PlaceholderScreen: React.FC<PlaceholderScreenProps> = ({
  navigation,
  route,
}) => {
  const { colors: themeColors } = useThemeColors();
  const type = route.params?.type || 'default';
  const info = SCREEN_INFO[type] || {
    title: 'Coming Soon',
    description: 'This feature is currently under development.',
    icon: 'clock',
  };

  return (
    <SafeAreaView style={[styles.container, {backgroundColor: themeColors.background.primary}]}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Icon name={info.icon as any} size="xl" color="#3B82F6" />
        </View>
        <Text style={[styles.title, {color: themeColors.text.primary}]}>Coming Soon</Text>
        <Text style={[styles.description, {color: themeColors.text.secondary}]}>{info.description}</Text>
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
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  description: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
});

export default PlaceholderScreen;

import React from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {NativeStackNavigationOptions, NativeStackHeaderProps} from '@react-navigation/native-stack';
import {useProofUiColors} from '../theme/proofUi';
import {ProofUiIcon} from '../components/ProofUiIcon';
import {useTranslation} from 'react-i18next';

const StackHeader = ({navigation, options, back}: NativeStackHeaderProps) => {
  const insets = useSafeAreaInsets();
  const colors = useProofUiColors();
  const {t} = useTranslation();
  const title = options.title || '';
  const showBack = !!back && options.headerBackVisible !== false;
  const HeaderRight = options.headerRight;

  return (
    <View style={[styles.headerContainer, {paddingTop: insets.top, backgroundColor: colors.background}]}>
      <View style={styles.headerContent}>
        {showBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={() => navigation.goBack()}
            style={styles.backButton}
            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <ProofUiIcon name="arrow-left" size={24} color={colors.text} />
          </Pressable>
        ) : (
          <View style={styles.headerSpacer} />
        )}
        <Text style={[styles.headerTitle, {color: colors.text}]} numberOfLines={1}>
          {title}
        </Text>
        {HeaderRight ? (
          <View style={styles.headerRight}>
            {HeaderRight({canGoBack: !!back})}
          </View>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>
    </View>
  );
};

export const stackScreenOptions: NativeStackNavigationOptions = {
  header: (props: NativeStackHeaderProps) => <StackHeader {...props} />,
};

export function useStackScreenOptions(): NativeStackNavigationOptions {
  const colors = useProofUiColors();
  return {
    header: (props: NativeStackHeaderProps) => <StackHeader {...props} />,
    contentStyle: {
      backgroundColor: colors.background,
    },
  };
}

const HEADER_HEIGHT = 44;

const styles = StyleSheet.create({
  headerContainer: {},
  headerContent: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  backButton: {
    width: 32,
    height: HEADER_HEIGHT,
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  headerSpacer: {
    width: 32,
  },
  headerRight: {
    minWidth: 32,
    alignItems: 'flex-end' as const,
    justifyContent: 'center' as const,
    height: HEADER_HEIGHT,
  },
});

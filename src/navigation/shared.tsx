import React from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {NativeStackNavigationOptions, NativeStackHeaderProps} from '@react-navigation/native-stack';
import {colors} from '../theme';

const StackHeader = ({navigation, options, back}: NativeStackHeaderProps) => {
  const insets = useSafeAreaInsets();
  const title = options.title || '';
  const showBack = !!back && options.headerBackVisible !== false;

  return (
    <View style={[styles.headerContainer, {paddingTop: insets.top}]}>
      <View style={styles.headerContent}>
        {showBack ? (
          <Pressable
            onPress={() => navigation.goBack()}
            style={styles.backButton}
            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <Text style={styles.backChevron}>{'‹'}</Text>
          </Pressable>
        ) : (
          <View style={styles.headerSpacer} />
        )}
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.headerSpacer} />
      </View>
    </View>
  );
};

export const stackScreenOptions: NativeStackNavigationOptions = {
  header: (props: NativeStackHeaderProps) => <StackHeader {...props} />,
  contentStyle: {
    backgroundColor: colors.background.primary,
  },
};

const HEADER_HEIGHT = 44;

const styles = StyleSheet.create({
  headerContainer: {
    backgroundColor: colors.background.primary,
  },
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
  backChevron: {
    color: colors.text.primary,
    fontSize: 34,
    fontWeight: '300',
    marginTop: -2,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: colors.text.primary,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 32,
  },
});

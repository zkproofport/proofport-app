import React from 'react';
import {TouchableOpacity, Text, StyleSheet} from 'react-native';
import type {NativeStackNavigationOptions} from '@react-navigation/native-stack';

export const stackScreenOptions: NativeStackNavigationOptions = {
  headerStyle: {
    backgroundColor: '#0F1419',
  },
  headerTintColor: '#FFFFFF',
  headerTitleStyle: {
    fontWeight: '600',
  },
  contentStyle: {
    backgroundColor: '#0F1419',
  },
};

export const headerBackButton = (navigation: {goBack: () => void}) => (
  <TouchableOpacity
    onPress={() => navigation.goBack()}
    style={styles.backButton}
    activeOpacity={0.7}
    hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
    <Text style={styles.backChevron}>{'‹'}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  backButton: {
    marginLeft: -8,
    paddingRight: 16,
  },
  backChevron: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '300',
  },
});

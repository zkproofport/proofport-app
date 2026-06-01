import React from 'react';
import {Platform, ScrollView} from 'react-native';
import type {ScrollViewProps} from 'react-native';

/**
 * App-wide scroll container that guarantees the focused TextInput is visible
 * above the keyboard — content rolls up under the keyboard, never z-index'd
 * over it.
 *
 *   iOS:     automaticallyAdjustKeyboardInsets makes the system add a
 *            content inset equal to the keyboard height and scroll the
 *            focused input above it (RN 0.81+).
 *   Android: windowSoftInputMode="adjustResize" (RN default) shrinks the
 *            window, so the ScrollView naturally fits above the keyboard.
 *
 * Defaults can be overridden by passing the prop explicitly.
 */
export const KeyboardSafeScroll = React.forwardRef<ScrollView, ScrollViewProps>(
  (props, ref) => (
    <ScrollView
      ref={ref}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      {...props}
    />
  ),
);
KeyboardSafeScroll.displayName = 'KeyboardSafeScroll';

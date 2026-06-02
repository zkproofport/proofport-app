/**
 * InAppBrowserScreen — opens any http(s) URL inside a full-screen WebView
 * so users never leave the app to Safari / system browser.
 *
 * Rule: every http(s) outbound URL in ZKProofport MUST use this screen
 * instead of Linking.openURL. Exceptions (must be documented at call site):
 *   - non-http schemes: mailto:, tel:, wc:, zkproofport:// self-deep-links
 *   - wallet handoff deep links (Privy / RainbowKit / WalletConnect)
 *   - mobileid-app:// and similar OS-level app-switching deep links
 *
 * Header is the native stack header (back chevron + page title).
 * Top progress bar mirrors Safari/Chrome.
 * Bottom toolbar: back / forward / reload / share.
 * Share opens the native ActionSheet which auto-includes "Copy",
 * "Open in Safari", and message apps.
 */
import React, {useCallback, useRef, useState} from 'react';
import {
  Animated,
  Platform,
  Share,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {WebView} from 'react-native-webview';
import type {WebViewNavigation} from 'react-native-webview';
import {useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import Feather from 'react-native-vector-icons/Feather';
import {useThemeColors} from '../../context';

export type InAppBrowserParams = {
  url: string;
  title?: string;
};

type Route = RouteProp<{InAppBrowser: InAppBrowserParams}, 'InAppBrowser'>;

export const InAppBrowserScreen: React.FC = () => {
  const {colors: themeColors} = useThemeColors();
  const route = useRoute<Route>();
  const {url} = route.params;

  const [progress, setProgress] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(url);
  const webViewRef = useRef<WebView | null>(null);
  const progressOpacity = useRef(new Animated.Value(0)).current;

  const onLoadProgress = useCallback((event: {nativeEvent: {progress: number}}) => {
    setProgress(event.nativeEvent.progress);
  }, []);

  const onLoadStart = useCallback(() => {
    progressOpacity.setValue(1);
  }, [progressOpacity]);

  const onLoadEnd = useCallback(() => {
    Animated.timing(progressOpacity, {
      toValue: 0,
      duration: 250,
      delay: 200,
      useNativeDriver: true,
    }).start(() => setProgress(0));
  }, [progressOpacity]);

  const onNavigationStateChange = useCallback((nav: WebViewNavigation) => {
    setCanGoBack(nav.canGoBack);
    setCanGoForward(nav.canGoForward);
    setCurrentUrl(nav.url);
  }, []);

  const goBack = useCallback(() => webViewRef.current?.goBack(), []);
  const goForward = useCallback(() => webViewRef.current?.goForward(), []);
  const reload = useCallback(() => webViewRef.current?.reload(), []);
  const share = useCallback(async () => {
    try {
      // iOS needs `url` only — passing both makes the share sheet show
      // "2 links". Android only respects `message`.
      await Share.share(
        Platform.OS === 'ios' ? {url: currentUrl} : {message: currentUrl},
      );
    } catch {
      // user dismissed
    }
  }, [currentUrl]);

  return (
    <View style={[styles.container, {backgroundColor: themeColors.background.primary}]}>
      <Animated.View style={[styles.progressTrack, {opacity: progressOpacity}]}>
        <View
          style={{
            height: 2,
            width: `${progress * 100}%`,
            backgroundColor: themeColors.info[500],
          }}
        />
      </Animated.View>
      <WebView
        ref={webViewRef}
        source={{uri: url}}
        onLoadStart={onLoadStart}
        onLoadEnd={onLoadEnd}
        onLoadProgress={onLoadProgress}
        onNavigationStateChange={onNavigationStateChange}
        javaScriptEnabled
        domStorageEnabled
        style={{flex: 1, backgroundColor: themeColors.background.primary}}
      />
      <SafeAreaView edges={['bottom']} style={{backgroundColor: themeColors.background.primary}}>
        <View style={[styles.toolbar, {borderTopColor: themeColors.border.primary}]}>
          <ToolbarBtn icon="chevron-left" disabled={!canGoBack} onPress={goBack} color={themeColors.info[500]} dim={themeColors.text.tertiary} />
          <ToolbarBtn icon="chevron-right" disabled={!canGoForward} onPress={goForward} color={themeColors.info[500]} dim={themeColors.text.tertiary} />
          <ToolbarBtn icon="rotate-cw" onPress={reload} color={themeColors.info[500]} dim={themeColors.text.tertiary} />
          <ToolbarBtn icon="share" onPress={share} color={themeColors.info[500]} dim={themeColors.text.tertiary} />
        </View>
      </SafeAreaView>
    </View>
  );
};

const ToolbarBtn: React.FC<{
  icon: string;
  disabled?: boolean;
  onPress: () => void;
  color: string;
  dim: string;
}> = ({icon, disabled, onPress, color, dim}) => (
  <TouchableOpacity
    style={styles.toolbarBtn}
    onPress={onPress}
    disabled={disabled}
    hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}
  >
    <Feather name={icon} size={22} color={disabled ? dim : color} />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  progressTrack: {
    height: 2,
    width: '100%',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toolbarBtn: {
    paddingHorizontal: 18,
    paddingVertical: 6,
  },
});

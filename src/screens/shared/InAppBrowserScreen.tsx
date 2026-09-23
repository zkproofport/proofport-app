/** Shared internal browser for outbound http(s) links; retains native history. */
import React, {useCallback, useRef, useState} from 'react';
import {Platform, Pressable, Share, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {WebView, type WebViewNavigation} from 'react-native-webview';
import {useRoute, type RouteProp} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';
import {ProofUiIcon, type ProofUiIconName} from '../../components/ProofUiIcon';
import {useError} from '../../context';
import {useProofUiColors} from '../../theme/proofUi';

export type InAppBrowserParams = {url: string; title?: string;};
type Route = RouteProp<{InAppBrowser: InAppBrowserParams}, 'InAppBrowser'>;

export const InAppBrowserScreen: React.FC = () => {
  const colors = useProofUiColors();
  const {t} = useTranslation();
  const {showError} = useError();
  const {url} = useRoute<Route>().params;
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(url);
  const currentUrlRef = useRef(url);
  const failureReported = useRef(false);
  const webViewRef = useRef<WebView | null>(null);

  const onNavigationStateChange = useCallback((navigation: WebViewNavigation) => {
    setCanGoBack(navigation.canGoBack);
    setCanGoForward(navigation.canGoForward);
    setCurrentUrl(navigation.url);
    currentUrlRef.current = navigation.url;
  }, []);
  const onLoadStart = () => {
    failureReported.current = false;
    setFailed(false);
    setLoading(true);
    setProgress(0);
  };
  const showLoadFailure = (code: 'E3001' | 'E3002') => {
    setFailed(true);
    setLoading(false);
    if (failureReported.current) return;
    failureReported.current = true;
    showError(code, t('host.browser.loadErrorDescription'));
  };
  const reload = () => {
    failureReported.current = false;
    setFailed(false);
    webViewRef.current?.reload();
  };
  const share = async () => {
    try {
      // iOS receives a URL only to avoid the share sheet showing two links.
      await Share.share(Platform.OS === 'ios' ? {url: currentUrl} : {message: currentUrl});
    } catch {showError('E9999', t('host.browser.shareError'));}
  };
  let host = currentUrl;
  try {host = new URL(currentUrl).host;} catch { /* Show the actual URL if native navigation returned a nonstandard URL. */ }

  return <View style={[styles.screen, {backgroundColor: colors.background}]}>
    <View style={[styles.address, {borderColor: colors.border}]}>
      <ProofUiIcon name="country" size={15} color={colors.secondary} />
      <Text numberOfLines={1} accessibilityLabel={currentUrl} style={[styles.addressText, {color: colors.secondary}]}>{host}</Text>
    </View>
    <View style={styles.progressTrack}>
      {loading && <View style={[styles.progress, {width: `${Math.max(0, Math.min(progress, 1)) * 100}%`, backgroundColor: colors.blue}]} />}
    </View>
    <View style={styles.page}>
      <WebView ref={webViewRef} source={{uri: url}}
        onLoadStart={onLoadStart} onLoadEnd={() => {setLoading(false); setProgress(0);}}
        onLoadProgress={event => setProgress(event.nativeEvent.progress)} onNavigationStateChange={onNavigationStateChange}
        onError={() => showLoadFailure('E3001')}
        onHttpError={event => {
          // Android also reports failures for images and other subresources.
          if (event.nativeEvent.url === currentUrlRef.current) showLoadFailure('E3002');
        }}
        renderError={() => <View />}
        javaScriptEnabled domStorageEnabled
        style={[styles.page, {backgroundColor: colors.background}]} />
      {failed && <View testID="browser-error" accessibilityLiveRegion="polite" style={[styles.error, {backgroundColor: colors.background}]}>
        <ProofUiIcon name="country" size={36} color={colors.secondary} />
        <Text accessibilityRole="header" style={[styles.errorTitle, {color: colors.text}]}>{t('host.browser.loadErrorTitle')}</Text>
        <Text style={[styles.errorDescription, {color: colors.secondary}]}>{t('host.browser.loadErrorDescription')}</Text>
        <Pressable testID="browser-retry" accessibilityRole="button" onPress={reload} style={[styles.retry, {backgroundColor: colors.blue}]}>
          <ProofUiIcon name="refresh" size={18} color="#FFFFFF" />
          <Text style={styles.retryText}>{t('host.browser.retry')}</Text>
        </Pressable>
      </View>}
    </View>
    <SafeAreaView edges={['bottom', 'left', 'right']} style={{backgroundColor: colors.card}}>
      <View style={[styles.toolbar, {borderColor: colors.border}]}>
        <ToolbarButton id="back" icon="arrow-left" label={t('host.browser.back')} disabled={!canGoBack} onPress={() => webViewRef.current?.goBack()} />
        <ToolbarButton id="forward" icon="arrow-right" label={t('host.browser.forward')} disabled={!canGoForward} onPress={() => webViewRef.current?.goForward()} />
        <ToolbarButton id="reload" icon="refresh" label={t('host.browser.reload')} onPress={reload} />
        <ToolbarButton id="share" icon="share" label={t('host.browser.share')} onPress={share} />
      </View>
    </SafeAreaView>
  </View>;
};

function ToolbarButton({id, icon, label, disabled = false, onPress}: {
  id: string; icon: ProofUiIconName; label: string; disabled?: boolean; onPress: () => void;
}) {
  const colors = useProofUiColors();
  return <Pressable testID={`browser-${id}`} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}}
    disabled={disabled} onPress={onPress} style={({pressed}) => [styles.toolbarButton, (disabled || pressed) && styles.dim]}>
    <ProofUiIcon name={icon} size={22} color={disabled ? colors.muted : colors.blue} />
  </Pressable>;
}
const styles = StyleSheet.create({
  screen: {flex: 1}, page: {flex: 1}, address: {minHeight: 34, paddingHorizontal: 20, gap: 8, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth},
  addressText: {flex: 1, fontSize: 12, lineHeight: 18}, progressTrack: {height: 2}, progress: {height: 2},
  toolbar: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth},
  toolbarButton: {minWidth: 56, minHeight: 44, alignItems: 'center', justifyContent: 'center'}, dim: {opacity: 0.45},
  error: {...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14},
  errorTitle: {fontSize: 19, lineHeight: 26, fontWeight: '600', textAlign: 'center'}, errorDescription: {fontSize: 14, lineHeight: 21, textAlign: 'center'},
  retry: {minHeight: 46, borderRadius: 10, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 6},
  retryText: {fontSize: 14, fontWeight: '600', color: '#FFFFFF'},
});

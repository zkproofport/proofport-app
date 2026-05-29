/**
 * OacxWebViewScreen — embeds the RAON OmniOne CX standard authentication
 * widget inside a React Native WebView.
 *
 * INTEGRATION NOTE (best-effort scaffold):
 *   The OACX widget at https://cx.raonsecure.co.kr:17543 requires the page
 *   to be served from a RAON-registered RP origin. Until RAON RP registration
 *   is complete and a config URL is issued, OACX.LOAD_MODULE will fail with a
 *   CORS / origin error. In that case the screen posts an error result and
 *   useMdlKr falls back to the raw 4-stage HTTP path (oacxClient.ts::runAppAuthFlow).
 *
 *   When RAON registration is complete:
 *     1. Replace CONFIG_URL with the RP-specific config URL from RAON.
 *     2. The widget will render the standard authentication UI automatically.
 *     3. The callback result is forwarded to the hook via OacxResultBus.
 *
 * Reference implementation: hackathon-demo/app.js (raw 4-stage HTTP flow)
 * and the OmniOne CX widget integration guide (oacx-ux.js option 1).
 */
import React, {useCallback, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import {WebView} from 'react-native-webview';
import type {WebViewMessageEvent} from 'react-native-webview';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useThemeColors} from '../../context';
import {publishResult} from '../../utils/oacxResultBus';
import type {ProofStackParamList} from '../../navigation/types';
import type {OacxParsedToken} from '../../utils/oacxClient';

// RAON OmniOne CX widget base URL (hosted by RAON).
const OACX_UX_BASE = 'https://cx.raonsecure.co.kr:17543/ent/esign';

// RP-specific config URL — replace with the value issued by RAON after
// RP registration. Until then, the widget will fail with an origin error
// and the fallback path (oacxClient.ts) will handle authentication.
const CONFIG_URL = `${OACX_UX_BASE}/config/config.mid.json`;

type Navigation = NativeStackNavigationProp<ProofStackParamList, 'OacxWebView'>;
type Route = RouteProp<ProofStackParamList, 'OacxWebView'>;

/**
 * Builds the HTML page that loads the OACX widget scripts and calls
 * OACX.LOAD_MODULE. The callback forwards the result (or error) to
 * React Native via window.ReactNativeWebView.postMessage.
 *
 * Pattern mirrors hackathon-demo/app.js step1-4 orchestration, but
 * delegates all UI and API staging to the RAON-hosted widget.
 */
function buildHtml(provider: string, scope: string): string {
  // RAON OACX widget required params:
  //   - compareCI: boolean — whether to compare the returned CI against
  //     a previously-stored CI (false for first-time authentication; the
  //     widget shows "compareCI key의 true, false 설정 값이 누락" if
  //     missing).
  //   - ci / telno: opt-in to receiving these fields in the VC payload.
  const paramsJson = JSON.stringify({
    provider,
    scope,
    contentInfo: {signType: 'ENT_MID'},
    compareCI: false,
    ci: true,
    telno: true,
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link href="${OACX_UX_BASE}/oacx-ux.css" rel="stylesheet">
  <style>
    body { margin: 0; padding: 0; background: #fff; }
    #oacxDiv { width: 100%; min-height: 100vh; }
    #error-box {
      display: none; padding: 24px; color: #c00;
      font-family: sans-serif; font-size: 14px; line-height: 1.6;
    }
  </style>
</head>
<body>
  <div id="oacxDiv"></div>
  <div id="error-box"></div>

  <script defer src="${OACX_UX_BASE}/oacx-vendor.js"></script>
  <script defer src="${OACX_UX_BASE}/oacx-ux.js"></script>
  <script>
    function showError(msg) {
      var el = document.getElementById('error-box');
      el.style.display = 'block';
      el.textContent = 'OACX error: ' + msg;
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'oacx_error',
          error: msg
        }));
      }
    }

    function waitForOACX(attempts) {
      if (attempts <= 0) {
        showError('oacx-ux.js did not load (CORS/origin error or network timeout). Falling back to raw API path.');
        return;
      }
      if (typeof OACX === 'undefined' || typeof OACX.LOAD_MODULE !== 'function') {
        setTimeout(function() { waitForOACX(attempts - 1); }, 200);
        return;
      }
      try {
        OACX.LOAD_MODULE(
          ${JSON.stringify(CONFIG_URL)},
          ${paramsJson},
          function(res) {
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'oacx_result',
                payload: res
              }));
            }
          }
        );
      } catch(e) {
        showError(e && e.message ? e.message : String(e));
      }
    }

    // Wait up to 5 seconds for deferred scripts to execute.
    window.addEventListener('load', function() { waitForOACX(25); });
  </script>
</body>
</html>`;
}

export const OacxWebViewScreen: React.FC = () => {
  const {colors: themeColors} = useThemeColors();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<Route>();
  const {provider, scope} = route.params;

  const loadingRef = useRef(true);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as {
        type: string;
        payload?: OacxParsedToken;
        error?: string;
      };

      if (msg.type === 'oacx_result' && msg.payload) {
        publishResult({ok: true, payload: msg.payload});
        navigation.goBack();
      } else if (msg.type === 'oacx_error') {
        publishResult({
          ok: false,
          error: msg.error ?? 'OACX widget returned an error',
        });
        navigation.goBack();
      }
    } catch {
      publishResult({ok: false, error: 'OacxWebViewScreen: failed to parse postMessage payload'});
      navigation.goBack();
    }
  }, [navigation]);

  const handleCancel = useCallback(() => {
    publishResult({ok: false, error: 'OacxWebViewScreen: user cancelled'});
    navigation.goBack();
  }, [navigation]);

  const html = buildHtml(provider, scope);

  return (
    <SafeAreaView style={[styles.container, {backgroundColor: themeColors.background.primary}]}>
      <View style={[styles.header, {borderBottomColor: themeColors.border.primary}]}>
        <TouchableOpacity onPress={handleCancel} style={styles.cancelButton}>
          <Text style={[styles.cancelText, {color: themeColors.info[500]}]}>취소</Text>
        </TouchableOpacity>
        <Text style={[styles.title, {color: themeColors.text.primary}]}>모바일 신분증 인증</Text>
        <View style={styles.cancelButton} />
      </View>
      <WebView
        source={{html, baseUrl: OACX_UX_BASE}}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={themeColors.info[400]} />
          </View>
        )}
        style={{flex: 1, backgroundColor: themeColors.background.primary}}
        onError={(syntheticEvent) => {
          const {nativeEvent} = syntheticEvent;
          publishResult({
            ok: false,
            error: `WebView load error: ${nativeEvent.description}`,
          });
          navigation.goBack();
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    width: 48,
  },
  cancelText: {
    fontSize: 16,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

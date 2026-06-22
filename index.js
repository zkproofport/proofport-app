/**
 * @format
 */

// Polyfills - MUST be first before any other imports!
import 'fast-text-encoding'; // TextEncoder/TextDecoder for Privy
import 'react-native-get-random-values'; // crypto.getRandomValues
import '@ethersproject/shims'; // ethers.js polyfills

// WalletConnect polyfills - after crypto polyfills
import '@walletconnect/react-native-compat';

// WebCrypto `subtle` (react-native-quick-crypto) for the OpenStoa mini-app's
// E2EE chat GroupCipher (seal/open). Idempotent and additive — it only attaches
// `subtle` to the existing global.crypto and never replaces getRandomValues,
// so Privy/ethers/WalletConnect are unaffected. Without this the mini-app chat
// cannot decrypt. (Installer originated in the Phase 0 PoC.)
import {ensureSubtleCrypto} from './src/crypto/installCryptoPolyfill';
ensureSubtleCrypto();

// i18n — must initialise before any screen renders
import './src/i18n';

import {AppRegistry, LogBox} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

LogBox.ignoreAllLogs(true);

AppRegistry.registerComponent(appName, () => App);

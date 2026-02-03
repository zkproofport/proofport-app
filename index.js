/**
 * @format
 */

// Polyfills - MUST be first before any other imports!
import 'fast-text-encoding'; // TextEncoder/TextDecoder for Privy
import 'react-native-get-random-values'; // crypto.getRandomValues
import '@ethersproject/shims'; // ethers.js polyfills

// WalletConnect polyfills - after crypto polyfills
import '@walletconnect/react-native-compat';

import {AppRegistry, LogBox} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

LogBox.ignoreLogs([
  /Unable to open URL: metamask/,
  /^\{"time":\d+,"level":\d+/,
]);

AppRegistry.registerComponent(appName, () => App);

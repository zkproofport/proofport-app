// Bridge to pass deep link URLs from QRScanScreen to App.tsx's handleDeepLink
// without going through Linking.openURL (which may mangle the URL)
let _handler: ((url: string) => void) | null = null;

export function registerDeepLinkHandler(handler: (url: string) => void) {
  _handler = handler;
}

export function triggerDeepLink(url: string) {
  _handler?.(url);
}

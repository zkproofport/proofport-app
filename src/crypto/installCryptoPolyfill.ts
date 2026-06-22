// Phase 0 PoC — attach a WebCrypto `subtle` to the existing global.crypto so
// ts-mls / @hpke/core work on Hermes, WITHOUT replacing the app's crypto
// (react-native-get-random-values, used by Privy/ethers/WalletConnect).
//
// NOTE: no top-level `import` of react-native-quick-crypto. Under Metro
// `inlineRequires`, a top-level default import here interacted badly and the
// module namespace came back undefined on-device. We lazy-`require` inside the
// function and probe every export shape, returning diagnostics instead of
// throwing so the PoC screen can display exactly what happened.

export interface PolyfillResult {
  hadSubtle: boolean;
  attached: boolean;
  source: string; // where subtle came from, or the failure reason
  qcKeys?: string[];
}

let installed = false;

export function ensureSubtleCrypto(): PolyfillResult {
  const g = globalThis as unknown as {
    crypto?: { subtle?: unknown; getRandomValues?: unknown };
  };
  const hadSubtle = !!g.crypto?.subtle;
  if (installed || hadSubtle) {
    return { hadSubtle, attached: false, source: hadSubtle ? 'existing global.crypto.subtle' : 'already installed' };
  }

  let qc: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    qc = require('react-native-quick-crypto');
  } catch (e) {
    return { hadSubtle, attached: false, source: 'require(react-native-quick-crypto) threw: ' + ((e as Error)?.message ?? String(e)) };
  }
  if (!qc) {
    return { hadSubtle, attached: false, source: 'require returned ' + String(qc) };
  }

  const qcKeys = (() => { try { return Object.keys(qc).slice(0, 30); } catch { return []; } })();

  // quick-crypto exports: module.exports = QuickCrypto (has .subtle), .default,
  // named `subtle`. Probe each.
  const subtle =
    qc.subtle ?? qc.default?.subtle ?? qc.webcrypto?.subtle ?? qc.default?.webcrypto?.subtle;

  if (!subtle) {
    return { hadSubtle, attached: false, source: 'no subtle on quick-crypto export', qcKeys };
  }

  if (!g.crypto) {
    (g as { crypto?: unknown }).crypto = { subtle, getRandomValues: qc.getRandomValues ?? qc.default?.getRandomValues };
    installed = true;
    return { hadSubtle, attached: true, source: 'created global.crypto from quick-crypto', qcKeys };
  }

  try {
    Object.defineProperty(g.crypto, 'subtle', { value: subtle, configurable: true, enumerable: false, writable: true });
  } catch (e) {
    return { hadSubtle, attached: false, source: 'defineProperty failed: ' + ((e as Error)?.message ?? String(e)), qcKeys };
  }
  installed = true;
  return { hadSubtle, attached: true, source: 'attached quick-crypto subtle to global.crypto', qcKeys };
}

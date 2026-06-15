// Phase 0 PoC: WebAuthn PRF determinism test (D6/D7/D8 key-recovery foundation).
// Registers a synced passkey with a PRF salt, then evaluates PRF twice and
// checks the 32-byte output is identical (determinism). On a 2nd iCloud-synced
// device, running the get() step alone with the same salt verifies cross-device
// PRF reproduction (the core synced-passkey assumption).
//
// rpId must match the live AASA domain (stg-community.zkproofport.app, served
// application/json). Lazy-require react-native-passkeys (Metro inlineRequires).

const RP_ID = 'stg-community.zkproofport.app';
// Fixed PRF salt so determinism is testable: base64url("openstoa-master/v1").
const SALT = 'b3BlbnN0b2EtbWFzdGVyL3Yx';

function randB64url(n: number): string {
  const b = new Uint8Array(n);
  (globalThis as any).crypto.getRandomValues(b);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function prfToStr(prf: any): string | null {
  const r = prf?.results?.first;
  if (r == null) return null;
  if (typeof r === 'string') return r;
  // ArrayBuffer → base64url
  try {
    const u = new Uint8Array(r);
    let s = '';
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return JSON.stringify(r);
  }
}

export interface PrfResult {
  ok: boolean;
  supported?: boolean;
  rpId: string;
  regPrfEnabled?: boolean;
  credId?: string;
  prf1?: string | null;
  prf2?: string | null;
  deterministic?: boolean;
  steps: { label: string; ms: number }[];
  error?: string;
}

export async function runPasskeyPrf(): Promise<PrfResult> {
  const steps: { label: string; ms: number }[] = [];
  const now = () => Date.now();
  const mark = (label: string, from: number) => steps.push({ label, ms: now() - from });
  try {
    // react-native-passkeys 0.4.0's default export does `{ ...nativeModule }`,
    // which on Expo 54 loses the native methods (they live on the prototype) —
    // so passkeys.isSupported/create/get come back undefined. Bypass the lib
    // and talk to the Expo native module directly.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { requireNativeModule } = require('expo-modules-core');
    const passkeys = requireNativeModule('ReactNativePasskeys');
    const supported = typeof passkeys.isSupported === 'function' ? passkeys.isSupported() : undefined;

    let s = now();
    const reg = await passkeys.create({
      rp: { id: RP_ID, name: 'OpenStoa' },
      user: { id: randB64url(16), name: 'poc@openstoa', displayName: 'OpenStoa PoC' },
      challenge: randB64url(32),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      extensions: { prf: { eval: { first: SALT } } },
    });
    mark('create (register passkey)', s);
    const credId = reg?.id;
    const regPrfEnabled = reg?.clientExtensionResults?.prf?.enabled;

    const doGet = async () =>
      passkeys.get({
        rpId: RP_ID,
        challenge: randB64url(32),
        allowCredentials: credId ? [{ type: 'public-key', id: credId }] : undefined,
        userVerification: 'required',
        extensions: { prf: { eval: { first: SALT } } },
      });

    s = now();
    const g1 = await doGet();
    mark('get #1 (PRF eval)', s);
    s = now();
    const g2 = await doGet();
    mark('get #2 (PRF eval)', s);

    const prf1 = prfToStr(g1?.clientExtensionResults?.prf);
    const prf2 = prfToStr(g2?.clientExtensionResults?.prf);
    const deterministic = !!prf1 && prf1 === prf2;

    return {
      ok: !!prf1 && deterministic,
      supported, rpId: RP_ID, regPrfEnabled, credId,
      prf1, prf2, deterministic, steps,
      error: !prf1 ? 'PRF returned no result (extension not evaluated)' : undefined,
    };
  } catch (e) {
    return {
      ok: false, rpId: RP_ID, steps,
      error: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e),
    };
  }
}

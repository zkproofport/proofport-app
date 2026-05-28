/**
 * OmniOne CX VC-Verifier client — App2App / WebToApp flow.
 *
 * Spec: opendid.org/hackathon/2025/...OmniOne_CX-VC-Verifier_v1.0_API_매뉴얼.pdf
 *
 * Stages:
 *   1. POST /oacx/api/v1.0/trans                       -> token + txId
 *   2. POST /oacx/api/v1.0/authen/app/request          -> deep links + new token
 *   3. (user) launches mobile ID app via deep link
 *   4. POST /oacx/api/v1.0/authen/app/result           -> result token (poll)
 *   5. POST /oacx/api/v1.0/trans/token                 -> parsed VC data
 *
 * The server validates step ordering, so callers MUST progress through the
 * stages in order. Tokens are single-use per stage.
 */
import {Linking, Platform} from 'react-native';

export const DEFAULT_OACX_URL = 'https://cx.raonsecure.co.kr:18543';

export type OacxProvider =
  | 'comdl_v1.5'        // mobile driver's license
  | 'comrc_v1.5'        // mobile resident registration card
  | 'comnh_v1.5'        // mobile veterans card
  | 'coresidence_v1.5'; // alien registration card

// --------------------------------------------------------------------------
// Response shapes
// --------------------------------------------------------------------------

interface OacxEnvelope {
  oacxCode?: string;
  resultCode?: string | number;
  clientMessage?: string;
}

export interface OacxTokenResponse extends OacxEnvelope {
  token: string;
  txId: string;
}

export interface OacxAppRequestResponse extends OacxEnvelope {
  token: string;
  cxId: string;
  oacxStatus: string;
  reqTxId: string;
  provider: string;
  data: {
    androidLink?: string;
    iosLink?: string;
    ssPayLink?: string;
    m200?: {
      mode: string;
      ci: boolean;
      host: string;
      type: 'mip';
      version: string;
      cmd: string;
      trxcode: string;
    };
  };
}

export interface OacxAppResultResponse extends OacxEnvelope {
  token: string;
  cxId?: string;
  oacxStatus: string;
  reqTxId: string;
  provider: string;
  data?: {
    verified?: boolean;
    converterimage?: string;
    dlphotoimage?: string;
    zkp?: boolean;
    options?: {watermark?: string};
  };
}

export interface OacxParsedToken extends OacxEnvelope {
  data: {
    // Common
    ci: string;
    name: string;
    birth: string;
    telno: string;
    address: string;
    userDid: string;
    issuerDid: string;
    vcId: string;
    vcTypeCode: string;
    issuanceDate: string;
    expirationDate: string;
    provider: string;
    throughCA: string;
    foreignflag?: string;
    // JWT envelope
    jti: string;
    iss: string;
    sub: string;
    iat: number;
    exp: number;
    pri: string;
    // Driver's license specific (optional)
    dlno?: string;
    asort?: string;
    passwordsn?: string;
    locpanm?: string;
    inspctbegend?: string;
    inorgdonnyn?: string;
    issude?: string;
    // Resident registration specific (optional)
    sex?: string;
    ihidnum?: string;
    title?: string;
  };
}

// --------------------------------------------------------------------------
// HTTP layer
// --------------------------------------------------------------------------

async function postJson<T>(url: string, body: object): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`OACX HTTP ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

function assertSuccess(env: OacxEnvelope, stage: string): void {
  if (env.oacxCode !== 'OACX_SUCCESS') {
    throw new Error(
      `OACX ${stage} failed: ${env.oacxCode ?? 'no_code'} (${env.clientMessage ?? 'no message'})`,
    );
  }
}

// --------------------------------------------------------------------------
// Stage 1: token
// --------------------------------------------------------------------------

export async function requestToken(
  baseUrl: string = DEFAULT_OACX_URL,
): Promise<OacxTokenResponse> {
  const res = await postJson<OacxTokenResponse>(
    `${baseUrl}/oacx/api/v1.0/trans`,
    {},
  );
  assertSuccess(res, 'trans');
  return res;
}

// --------------------------------------------------------------------------
// Stage 2: app/request -> deep links
// --------------------------------------------------------------------------

export async function requestAppAuth(params: {
  baseUrl?: string;
  provider: OacxProvider;
  token: string;
  txId: string;
  ci?: boolean;
  telno?: boolean;
}): Promise<OacxAppRequestResponse> {
  const {baseUrl = DEFAULT_OACX_URL, provider, token, txId, ci = true, telno = true} = params;
  const res = await postJson<OacxAppRequestResponse>(
    `${baseUrl}/oacx/api/v1.0/authen/app/request`,
    {
      provider,
      token,
      txId,
      contentInfo: {signType: 'ENT_MID'},
      // MoIS guidance: opt in to CI / telno fields explicitly.
      ci,
      telno,
    },
  );
  assertSuccess(res, 'app/request');
  return res;
}

// --------------------------------------------------------------------------
// Stage 3: launch the mobile ID app via deep link
// --------------------------------------------------------------------------

export async function launchMobileIdApp(
  appReq: OacxAppRequestResponse,
): Promise<void> {
  const {androidLink, iosLink, ssPayLink} = appReq.data;
  let url: string | undefined;
  if (Platform.OS === 'ios') {
    url = iosLink;
  } else {
    url = ssPayLink || androidLink;
  }
  if (!url) {
    throw new Error(`No deep link available for platform ${Platform.OS}`);
  }
  const can = await Linking.canOpenURL(url);
  if (!can) {
    throw new Error('Mobile ID app is not installed (cannot open deep link)');
  }
  await Linking.openURL(url);
}

// --------------------------------------------------------------------------
// Stage 4: poll for result
// --------------------------------------------------------------------------

export async function pollAppResult(params: {
  baseUrl?: string;
  provider: OacxProvider;
  token: string;
  txId: string;
  cxId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  onTick?: (elapsed: number) => void;
}): Promise<OacxAppResultResponse> {
  const {
    baseUrl = DEFAULT_OACX_URL,
    provider,
    token,
    txId,
    cxId,
    timeoutMs = 180_000,
    pollIntervalMs = 3_000,
    onTick,
  } = params;

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await postJson<OacxAppResultResponse>(
        `${baseUrl}/oacx/api/v1.0/authen/app/result`,
        {provider, token, txId, cxId},
      );
      if (
        res.oacxCode === 'OACX_SUCCESS' &&
        res.data?.verified === true
      ) {
        return res;
      }
    } catch (_err) {
      // Server returns errors while the user is still authenticating —
      // keep polling until either success or timeout.
    }
    onTick?.(Date.now() - started);
    await sleep(pollIntervalMs);
  }
  throw new Error('OACX poll timed out before mobile ID authentication completed');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --------------------------------------------------------------------------
// Stage 5: parse token -> VC data
// --------------------------------------------------------------------------

export async function parseToken(params: {
  baseUrl?: string;
  token: string;
}): Promise<OacxParsedToken> {
  const {baseUrl = DEFAULT_OACX_URL, token} = params;
  const res = await postJson<OacxParsedToken>(
    `${baseUrl}/oacx/api/v1.0/trans/token`,
    {token},
  );
  assertSuccess(res, 'trans/token');
  return res;
}

// --------------------------------------------------------------------------
// Convenience: full pipeline
// --------------------------------------------------------------------------

export interface RunAppAuthOptions {
  baseUrl?: string;
  provider: OacxProvider;
  ci?: boolean;
  telno?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
  onTick?: (elapsed: number) => void;
  onLog?: (msg: string) => void;
}

export async function runAppAuthFlow(
  opts: RunAppAuthOptions,
): Promise<OacxParsedToken> {
  const log = opts.onLog ?? (() => undefined);

  log('OACX 1/5 — Requesting transaction token...');
  const trans = await requestToken(opts.baseUrl);

  log('OACX 2/5 — Requesting deep link for app handoff...');
  const appReq = await requestAppAuth({
    baseUrl: opts.baseUrl,
    provider: opts.provider,
    token: trans.token,
    txId: trans.txId,
    ci: opts.ci,
    telno: opts.telno,
  });

  log('OACX 3/5 — Launching mobile ID app...');
  await launchMobileIdApp(appReq);

  log('OACX 4/5 — Polling for authentication result...');
  const result = await pollAppResult({
    baseUrl: opts.baseUrl,
    provider: opts.provider,
    token: appReq.token,
    txId: trans.txId,
    cxId: appReq.cxId,
    timeoutMs: opts.timeoutMs,
    pollIntervalMs: opts.pollIntervalMs,
    onTick: opts.onTick,
  });

  log('OACX 5/5 — Parsing result token...');
  const parsed = await parseToken({baseUrl: opts.baseUrl, token: result.token});

  log('OACX complete.');
  return parsed;
}

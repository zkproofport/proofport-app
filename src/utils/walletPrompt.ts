/**
 * What the person has to approve in their wallet app while a proof runs.
 *
 * Every wallet request a proof makes goes through the provider wrapper the
 * proof screen builds, so the screen learns here, from the request itself,
 * when the wallet app is waiting for the person and for what:
 *
 *   - `request`     the signature over the proof request (personal_sign, or
 *                   the dApp's typed action)
 *   - `reuseGuard`  the signature that keeps one person's proof from being
 *                   counted twice (the typed `OprfRequest`, src/oprf/flow.ts)
 *   - `network`     switching or adding the chain a typed action is signed on
 *
 * Reads (eth_chainId, eth_accounts, ...) never open the wallet app and give
 * no prompt.
 */
export type WalletPrompt = 'request' | 'reuseGuard' | 'network';

/** The struct the reuse-guard signature signs (core's oprfRequestTypedData). */
export const REUSE_GUARD_PRIMARY_TYPE = 'OprfRequest';

const NETWORK_METHODS: ReadonlySet<string> = new Set(['wallet_switchEthereumChain', 'wallet_addEthereumChain']);

/** The typed-data payload's primaryType, or null when it carries none. */
function primaryTypeOf(payload: unknown): string | null {
  let value = payload;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value && typeof value === 'object' && typeof (value as {primaryType?: unknown}).primaryType === 'string') {
    return (value as {primaryType: string}).primaryType;
  }
  return null;
}

/** The prompt a wallet request needs, or null for one the wallet answers without asking. */
export function walletPromptFor(method: string, params: readonly unknown[] | undefined): WalletPrompt | null {
  if (method === 'personal_sign') return 'request';
  if (method === 'eth_signTypedData_v4') {
    // params are [from, payload]. A payload that is not the reuse guard is
    // the request's own typed action; the wallet shows it either way, so a
    // payload this cannot parse is still a signature being asked for.
    return primaryTypeOf(params?.[1]) === REUSE_GUARD_PRIMARY_TYPE ? 'reuseGuard' : 'request';
  }
  if (NETWORK_METHODS.has(method)) return 'network';
  return null;
}

type Send = (method: string, params: unknown[]) => Promise<unknown>;

/**
 * An EIP-1193 `request` over `send` that reports the prompt while the wallet
 * app is waiting and clears it when the wallet answers, approved or refused.
 */
export function promptingRequest(send: Send, onPrompt: (prompt: WalletPrompt | null) => void) {
  return async (args: {method: string; params?: unknown[]}): Promise<unknown> => {
    const prompt = walletPromptFor(args.method, args.params);
    if (prompt) onPrompt(prompt);
    try {
      return await send(args.method, args.params || []);
    } finally {
      if (prompt) onPrompt(null);
    }
  };
}

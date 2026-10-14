/**
 * The person said no in their wallet.
 *
 * A wallet signals that with a provider error code, not with words: 4001 is
 * EIP-1193's "User Rejected Request" (https://eips.ethereum.org/EIPS/eip-1193),
 * and 5000 is WalletConnect's "user rejected"
 * (https://specs.walletconnect.com/2.0/specs/clients/sign/error-codes). The
 * message text differs per wallet and is never matched.
 *
 * The proof hooks report failures as a step `detail` string, so a rejection is
 * re-thrown with this fixed prefix and the proof screen answers the relay
 * `cancelled` rather than `error` when it sees it.
 */
export const WALLET_REJECTED_PREFIX = 'Signature rejected in the wallet';

const USER_REJECTED_CODES: ReadonlySet<number> = new Set([4001, 5000]);

export function isWalletRejection(error: unknown): boolean {
  const code = (error as {code?: unknown} | null)?.code;
  return typeof code === 'number' && USER_REJECTED_CODES.has(code);
}

export function rejectedInWallet(detail: unknown): boolean {
  return typeof detail === 'string' && detail.startsWith(WALLET_REJECTED_PREFIX);
}

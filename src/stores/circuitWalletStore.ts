/**
 * Per-circuit wallet cache.
 *
 * When a user first generates a proof for a circuit with a particular wallet,
 * we cache the binding {circuit → wallet} so subsequent proofs for the same
 * circuit skip the wallet picker. Entries expire after CIRCUIT_WALLET_TTL_MS
 * so a stale wallet eventually forces a re-pick.
 *
 * This is NOT a permanent pin — purely a UX shortcut.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {ALL_CIRCUIT_IDS} from '../config/circuitIds';
import type {CircuitName} from '../config/contracts';

const STORAGE_KEY = '@proofport/circuit-wallets';
export const CIRCUIT_WALLET_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface CircuitWalletEntry {
  address: string;
  savedAt: number; // unix ms
}

export type CircuitWalletMap = Partial<Record<CircuitName, CircuitWalletEntry>>;

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * Wallet binding group per circuit. Circuits proven with the SAME wallet share
 * one binding key, so connecting/binding once covers all of them.
 * Coinbase KYC and Coinbase Country are attestations on the same Coinbase
 * wallet → same group. GIWA is independent.
 */
const CIRCUIT_WALLET_GROUP: Record<CircuitName, string> = {
  coinbase_attestation: 'coinbase',
  // Same Coinbase-attested wallet, so binding once covers both.
  arc_eligibility: 'coinbase',
  coinbase_country_attestation: 'coinbase',
  giwa_attestation: 'giwa',
  oidc_domain_attestation: 'oidc',
  // Korea mDL is a web2 (OmniOne CX) flow with no wallet binding.
  // All three predicate circuits share one group so the wallet gate is
  // a no-op (no wallet is ever stored for them).
  mdl_kr_ownership: 'mdl_kr',
  mdl_kr_age: 'mdl_kr',
  mdl_kr_region: 'mdl_kr',
};

/**
 * Whether a circuit's PROOF is built from a wallet signature.
 *
 * Not the same question as the relay's "does the request need a signature to
 * authenticate the requester" — `giwa_attestation` answers no to that one and
 * yes to this one, because its hook asks the wallet for a `personal_sign`
 * while the relay accepts its request unsigned. Reusing the relay's answer
 * here dropped GIWA's row from the Wallet tab entirely.
 *
 * `satisfies` so a circuit added to the SDK is a compile error until somebody
 * decides, rather than silently having no wallet row.
 */
export const CIRCUIT_BINDS_A_WALLET = {
  coinbase_attestation: true,
  coinbase_country_attestation: true,
  // Same Coinbase-attested wallet; it signs an EIP-712 action instead of a
  // signal hash, which changes nothing about needing a wallet.
  arc_eligibility: true,
  // Its hook asks for a personal_sign, so a wallet has to be bound.
  giwa_attestation: true,
  // The signature is inside the OIDC identity token. No wallet is read.
  oidc_domain_attestation: false,
  // Web2 (OmniOne CX) flows with no wallet at all.
  mdl_kr_ownership: false,
  mdl_kr_age: false,
  mdl_kr_region: false,
} satisfies Record<CircuitName, boolean>;

export function walletGroupKey(circuit: CircuitName): CircuitName {
  return (CIRCUIT_WALLET_GROUP[circuit] ?? circuit) as CircuitName;
}

/**
 * One entry per WALLET BINDING — what the Wallet tab draws a row for.
 *
 * Lives here rather than in the screen because the grouping rule is here, and
 * because a list computed inside a screen cannot be checked: a test that works
 * the rows out for itself passes with the grouping torn back out.
 *
 * Coinbase KYC, Coinbase Country and Arc share one Coinbase-attested wallet,
 * so they are one entry. Listing them separately showed one binding three
 * times, and since all three read the same stored entry, connecting once made
 * all three say Connected.
 */
export const WALLET_BINDING_ROWS: CircuitName[] = (() => {
  const seen = new Set<string>();
  return ALL_CIRCUIT_IDS.filter(c => {
    if (!CIRCUIT_BINDS_A_WALLET[c]) return false;
    const key = walletGroupKey(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
})();

/** Every circuit one row stands for, so the row can name them all. */
export function circuitsInWalletGroup(representative: CircuitName): CircuitName[] {
  const key = walletGroupKey(representative);
  return ALL_CIRCUIT_IDS.filter(
    c => CIRCUIT_BINDS_A_WALLET[c] && walletGroupKey(c) === key,
  );
}

async function readAll(): Promise<CircuitWalletMap> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    // Migrate the legacy `{circuit: "0xabc..."}` shape (no TTL) into the
    // current `{circuit: {address, savedAt}}` shape on first read.
    const out: CircuitWalletMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && ADDR_RE.test(v)) {
        out[k as CircuitName] = {address: v, savedAt: Date.now()};
      } else if (
        v &&
        typeof v === 'object' &&
        typeof (v as any).address === 'string' &&
        ADDR_RE.test((v as any).address)
      ) {
        out[k as CircuitName] = {
          address: (v as any).address,
          savedAt: typeof (v as any).savedAt === 'number' ? (v as any).savedAt : Date.now(),
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

async function writeAll(map: CircuitWalletMap): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

function isFresh(entry: CircuitWalletEntry): boolean {
  return Date.now() - entry.savedAt < CIRCUIT_WALLET_TTL_MS;
}

/**
 * Returns the cached wallet for this circuit if it exists AND is not expired.
 * Returns null when missing OR stale (the caller should treat both the same).
 */
export async function getCircuitWallet(circuit: CircuitName): Promise<string | null> {
  const map = await readAll();
  const entry = map[circuit];
  if (!entry || !ADDR_RE.test(entry.address) || !isFresh(entry)) return null;
  return entry.address;
}

export async function getCircuitWalletEntry(
  circuit: CircuitName,
): Promise<(CircuitWalletEntry & {expired: boolean}) | null> {
  const map = await readAll();
  const entry = map[circuit];
  if (!entry || !ADDR_RE.test(entry.address)) return null;
  return {...entry, expired: !isFresh(entry)};
}

export async function setCircuitWallet(
  circuit: CircuitName,
  address: string,
): Promise<void> {
  if (!ADDR_RE.test(address)) {
    throw new Error('Invalid Ethereum address');
  }
  const map = await readAll();
  map[circuit] = {address, savedAt: Date.now()};
  await writeAll(map);
}

export async function clearCircuitWallet(circuit: CircuitName): Promise<void> {
  const map = await readAll();
  delete map[circuit];
  await writeAll(map);
}

export async function listCircuitWallets(): Promise<CircuitWalletMap> {
  return readAll();
}

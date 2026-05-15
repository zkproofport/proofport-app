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
import type {CircuitName} from '../config/contracts';

const STORAGE_KEY = '@proofport/circuit-wallets';
export const CIRCUIT_WALLET_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface CircuitWalletEntry {
  address: string;
  savedAt: number; // unix ms
}

export type CircuitWalletMap = Partial<Record<CircuitName, CircuitWalletEntry>>;

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

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

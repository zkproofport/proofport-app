/**
 * Korea Mobile ID (mDL) circuit input preparation.
 *
 * Three independent Noir circuits — `mdl_kr_ownership`, `mdl_kr_age`,
 * `mdl_kr_region` — share the same canonical natural-person commitment
 *
 *   keccak( ci || jti || pri || birth_date || address )  (436 bytes)
 *
 * so a single OmniOne CX response yields the same self_id_20 (and
 * therefore the same nullifier for a given scope/signal_hash) across
 * all three circuits. Each circuit enforces exactly one extra
 * predicate; this module produces the right input set for each.
 *
 * The byte layouts and padding rules here must match the Noir circuits
 * exactly — the same logic is mirrored in `circuits/mdl/scripts/gen.mjs`
 * for the offline acceptance fixtures.
 */
import {ethers} from 'ethers';

// Disclosure flag bits — match the ownership circuit.
export const DISCLOSE_NAME = 0x01;
export const DISCLOSE_BIRTH = 0x02;
export const DISCLOSE_SEX = 0x04;
export const DISCLOSE_TELNO = 0x08;

// Fixed buffer sizes — must match `mdl_kr_common` globals.
const CI_LEN = 88;
const JTI_LEN = 40;
const PRI_LEN = 44;
const NAME_MAX = 64;
const TELNO_MAX = 16;
const REGION_MAX = 64;
const BIRTH_LEN = 8;
const ADDRESS_MAX = 256;

export interface OmniOneCxData {
  ci: string;
  jti: string;
  pri: string;
  name: string;
  birth: string;   // "YYYYMMDD"
  telno: string;
  sex?: string;    // 'M' / 'F' / undefined
  address?: string;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function keccak(bytes: Uint8Array): Uint8Array {
  return ethers.utils.arrayify(ethers.utils.keccak256(bytes));
}

function padZero(input: string, totalLen: number): Uint8Array {
  const utf8 = ethers.utils.toUtf8Bytes(input);
  if (utf8.length > totalLen) {
    throw new Error(
      `Field "${input.slice(0, 16)}..." exceeds ${totalLen} bytes (got ${utf8.length})`,
    );
  }
  const buf = new Uint8Array(totalLen);
  buf.set(utf8, 0);
  return buf;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function bytesToNoir(bytes: Uint8Array): string[] {
  return Array.from(bytes).map((b) => b.toString());
}

// --------------------------------------------------------------------------
// Shared base inputs (common to all 3 circuits)
// --------------------------------------------------------------------------

interface MdlKrBase {
  // Public
  signal_hash: string[];
  scope: string[];
  nullifier_value: string[];
  cx_integrity_root: string[];
  // Private (common)
  ci: string[];
  cx_jti: string[];
  cx_pri: string[];
  birth_date: string[];
  address: string[];
}

function deriveBase(
  cx: OmniOneCxData,
  scopeString: string,
  signalHash?: Uint8Array,
): MdlKrBase {
  const ci = padZero(cx.ci, CI_LEN);
  const jti = padZero(cx.jti, JTI_LEN);
  const pri = padZero(cx.pri, PRI_LEN);
  const birth = padZero(cx.birth, BIRTH_LEN);
  const address = padZero(cx.address ?? '', ADDRESS_MAX);

  // CX integrity anchor (jti || pri).
  const cxIntegrityRoot = keccak(concat([jti, pri]));

  // Canonical natural-person commitment — identical to mdl_kr_common::derive_self_id_20.
  const mdlCommit = keccak(concat([ci, jti, pri, birth, address]));
  const selfId20 = mdlCommit.slice(0, 20);

  // Scope + nullifier (same coinbase_libs::nullifier helper the circuits use).
  const scopeBytes = keccak(ethers.utils.toUtf8Bytes(scopeString));
  const sig = signalHash ?? ethers.utils.randomBytes(32);
  const userSecret = keccak(concat([selfId20, sig]));
  const nullifierValue = keccak(concat([userSecret, scopeBytes]));

  return {
    signal_hash: bytesToNoir(sig),
    scope: bytesToNoir(scopeBytes),
    nullifier_value: bytesToNoir(nullifierValue),
    cx_integrity_root: bytesToNoir(cxIntegrityRoot),
    ci: bytesToNoir(ci),
    cx_jti: bytesToNoir(jti),
    cx_pri: bytesToNoir(pri),
    birth_date: bytesToNoir(birth),
    address: bytesToNoir(address),
  };
}

// --------------------------------------------------------------------------
// Ownership circuit (`mdl_kr_ownership`)
// --------------------------------------------------------------------------

export interface MdlKrOwnershipOpts {
  scopeString: string;
  discloseFlags: number;        // 0x00..0x0F bit-mask
  /** User- or dApp-supplied expected name. Defaults to the mDL name. */
  expectedName?: string;
  /** Expected birth_date "YYYYMMDD". Defaults to the mDL birth_date. */
  expectedBirth?: string;
  /** Expected sex char ('M' / 'F' / ''). Defaults to the mDL sex. */
  expectedSex?: string;
  /** Expected telno digits. Defaults to the mDL telno. */
  expectedTelno?: string;
  signalHash?: Uint8Array;
}

export interface MdlKrOwnershipInputs extends MdlKrBase {
  disclose_flags: string;
  owner_commit: string[];
  name: string[];
  telno: string[];
  sex: string;
  expected_name: string[];
  expected_birth: string[];
  expected_telno: string[];
  expected_sex: string;
}

export function prepareMdlKrOwnershipInputs(
  cx: OmniOneCxData,
  opts: MdlKrOwnershipOpts,
): MdlKrOwnershipInputs {
  const base = deriveBase(cx, opts.scopeString, opts.signalHash);

  const name = padZero(cx.name, NAME_MAX);
  const telno = padZero(cx.telno, TELNO_MAX);
  const sex = cx.sex && cx.sex.length > 0 ? cx.sex.charCodeAt(0) : 0;
  const birth = padZero(cx.birth, BIRTH_LEN);

  // Expected values default to the mDL values themselves, so a "honest"
  // ownership proof (user typed in matching values) passes. Any flag
  // bit set with a non-matching expected value triggers the circuit's
  // equality assertion and the proof fails.
  const expectedName  = padZero(opts.expectedName  ?? cx.name,  NAME_MAX);
  const expectedBirth = padZero(opts.expectedBirth ?? cx.birth, BIRTH_LEN);
  const expectedTelno = padZero(opts.expectedTelno ?? cx.telno, TELNO_MAX);
  const expectedSexChar = opts.expectedSex ?? (cx.sex ?? '');
  const expectedSex = expectedSexChar && expectedSexChar.length > 0
    ? expectedSexChar.charCodeAt(0)
    : 0;

  const f = opts.discloseFlags & 0x0f;
  const ownerBuf = new Uint8Array(89);
  if (f & DISCLOSE_NAME)  ownerBuf.set(expectedName,  0);
  if (f & DISCLOSE_BIRTH) ownerBuf.set(expectedBirth, 64);
  if (f & DISCLOSE_SEX)   ownerBuf[72] = expectedSex;
  if (f & DISCLOSE_TELNO) ownerBuf.set(expectedTelno, 73);

  const ownerCommit =
    f === 0
      ? new Uint8Array(32)
      : keccak(concat([new Uint8Array([f]), ownerBuf]));

  return {
    ...base,
    disclose_flags: f.toString(),
    owner_commit: bytesToNoir(ownerCommit),
    name: bytesToNoir(name),
    telno: bytesToNoir(telno),
    sex: sex.toString(),
    expected_name: bytesToNoir(expectedName),
    expected_birth: bytesToNoir(expectedBirth),
    expected_telno: bytesToNoir(expectedTelno),
    expected_sex: expectedSex.toString(),
  };
}

// Order MUST match circuits/mdl/kr-ownership/src/main.nr::main().
export function flattenMdlKrOwnershipInputs(inputs: MdlKrOwnershipInputs): string[] {
  return [
    ...inputs.signal_hash,
    ...inputs.scope,
    ...inputs.nullifier_value,
    ...inputs.cx_integrity_root,
    inputs.disclose_flags,
    ...inputs.owner_commit,
    ...inputs.ci,
    ...inputs.cx_jti,
    ...inputs.cx_pri,
    ...inputs.name,
    ...inputs.birth_date,
    ...inputs.telno,
    inputs.sex,
    ...inputs.address,
    ...inputs.expected_name,
    ...inputs.expected_birth,
    ...inputs.expected_telno,
    inputs.expected_sex,
  ];
}

// --------------------------------------------------------------------------
// Age circuit (`mdl_kr_age`)
// --------------------------------------------------------------------------

export interface MdlKrAgeOpts {
  scopeString: string;
  ageThreshold: number;
  currentYear: number;
  signalHash?: Uint8Array;
}

export interface MdlKrAgeInputs extends MdlKrBase {
  age_threshold: string;
  current_year: string;
}

export function prepareMdlKrAgeInputs(
  cx: OmniOneCxData,
  opts: MdlKrAgeOpts,
): MdlKrAgeInputs {
  const base = deriveBase(cx, opts.scopeString, opts.signalHash);
  return {
    ...base,
    age_threshold: opts.ageThreshold.toString(),
    current_year: opts.currentYear.toString(),
  };
}

// Order MUST match circuits/mdl/kr-age/src/main.nr::main().
export function flattenMdlKrAgeInputs(inputs: MdlKrAgeInputs): string[] {
  return [
    ...inputs.signal_hash,
    ...inputs.scope,
    ...inputs.nullifier_value,
    ...inputs.cx_integrity_root,
    inputs.age_threshold,
    inputs.current_year,
    ...inputs.ci,
    ...inputs.cx_jti,
    ...inputs.cx_pri,
    ...inputs.birth_date,
    ...inputs.address,
  ];
}

// --------------------------------------------------------------------------
// Region circuit (`mdl_kr_region`)
// --------------------------------------------------------------------------

export interface MdlKrRegionOpts {
  scopeString: string;
  targetRegion: string;         // dApp-supplied si/do (e.g., "경기도")
  signalHash?: Uint8Array;
}

export interface MdlKrRegionInputs extends MdlKrBase {
  region_code: string[];
}

export function prepareMdlKrRegionInputs(
  cx: OmniOneCxData,
  opts: MdlKrRegionOpts,
): MdlKrRegionInputs {
  if (!opts.targetRegion || opts.targetRegion.trim().length === 0) {
    throw new Error('mdl_kr_region requires a non-empty targetRegion');
  }
  const base = deriveBase(cx, opts.scopeString, opts.signalHash);
  const targetRegion = padZero(opts.targetRegion, REGION_MAX);
  const regionCode = keccak(targetRegion);
  return {
    ...base,
    region_code: bytesToNoir(regionCode),
  };
}

// Order MUST match circuits/mdl/kr-region/src/main.nr::main().
export function flattenMdlKrRegionInputs(inputs: MdlKrRegionInputs): string[] {
  return [
    ...inputs.signal_hash,
    ...inputs.scope,
    ...inputs.nullifier_value,
    ...inputs.cx_integrity_root,
    ...inputs.region_code,
    ...inputs.ci,
    ...inputs.cx_jti,
    ...inputs.cx_pri,
    ...inputs.birth_date,
    ...inputs.address,
  ];
}

// --------------------------------------------------------------------------
// Convenience variant dispatch
// --------------------------------------------------------------------------

export type MdlKrVariant = 'ownership' | 'age' | 'region';

export const MDL_KR_CIRCUIT_NAMES: Record<MdlKrVariant, string> = {
  ownership: 'mdl_kr_ownership',
  age: 'mdl_kr_age',
  region: 'mdl_kr_region',
};

/**
 * Korea Mobile ID (mDL) circuit input preparation. v4.
 *
 * v4 change: nullifier formula changed to keccak(keccak(ci) || scope),
 * matching the OIDC-domain-attestation pattern. signal_hash, cx_integrity_root,
 * cx_jti, and cx_pri are commented out pending RAON RP registration (HS256).
 *
 * Three independent Noir circuits -- `mdl_kr_ownership`, `mdl_kr_age`,
 * `mdl_kr_region` -- share the canonical `ci` identifier. Each circuit
 * enforces exactly one extra predicate; this module produces the right
 * input set for each.
 *
 * The byte layouts and padding rules here must match the Noir circuits
 * exactly -- the same logic is mirrored in `circuits/mdl/scripts/gen.mjs`
 * for the offline acceptance fixtures.
 */
import {ethers} from 'ethers';

// Disclosure flag bits -- match the ownership circuit.
export const DISCLOSE_NAME = 0x01;
export const DISCLOSE_BIRTH = 0x02;
export const DISCLOSE_SEX = 0x04;
export const DISCLOSE_TELNO = 0x08;

// Fixed buffer sizes -- must match `mdl_kr_common` globals.
const CI_LEN = 88;
// TODO(HS256): Re-enable when RAON registration provides the RP shared
// secret. Currently disabled because no off-chain HS256 verifier exists,
// so cx_integrity_root cannot anchor anything meaningfully.
// const JTI_LEN = 40;
// const PRI_LEN = 44;
const NAME_MAX = 64;
const TELNO_MAX = 16;
const REGION_MAX = 64;
const BIRTH_LEN = 8;
// TODO(HS256): Re-enable when RAON registration provides the RP shared
// secret. Currently disabled because no off-chain HS256 verifier exists,
// so cx_integrity_root cannot anchor anything meaningfully.
// const ADDRESS_MAX = 256;

export interface OmniOneCxData {
  ci: string;
  // TODO(HS256): Re-enable when RAON registration provides the RP shared
  // secret. Currently disabled because no off-chain HS256 verifier exists,
  // so cx_integrity_root cannot anchor anything meaningfully.
  // jti: string;
  // pri: string;
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
// v4: nullifier = keccak(keccak(ci) || scope)
// --------------------------------------------------------------------------

interface MdlKrBase {
  // Public
  // TODO(HS256): Re-enable when RAON registration provides the RP shared
  // secret. Currently disabled because no off-chain HS256 verifier exists,
  // so cx_integrity_root cannot anchor anything meaningfully.
  // signal_hash: string[];
  scope: string[];
  nullifier_value: string[];
  // TODO(HS256): Re-enable when RAON registration provides the RP shared
  // secret. Currently disabled because no off-chain HS256 verifier exists,
  // so cx_integrity_root cannot anchor anything meaningfully.
  // cx_integrity_root: string[];
  // Private (common)
  ci: string[];
  // TODO(HS256): Re-enable when RAON registration provides the RP shared
  // secret. Currently disabled because no off-chain HS256 verifier exists,
  // so cx_integrity_root cannot anchor anything meaningfully.
  // cx_jti: string[];
  // cx_pri: string[];
}

function deriveBase(
  cx: OmniOneCxData,
  scopeString: string,
  // TODO(HS256): Re-enable when RAON registration provides the RP shared
  // secret. Currently disabled because no off-chain HS256 verifier exists,
  // so cx_integrity_root cannot anchor anything meaningfully.
  // signalHash?: Uint8Array,
): MdlKrBase {
  const ci = padZero(cx.ci, CI_LEN);

  // TODO(HS256): Re-enable when RAON registration provides the RP shared
  // secret. Currently disabled because no off-chain HS256 verifier exists,
  // so cx_integrity_root cannot anchor anything meaningfully.
  // const jti = padZero(cx.jti, JTI_LEN);
  // const pri = padZero(cx.pri, PRI_LEN);
  // const cxIntegrityRoot = keccak(concat([jti, pri]));
  // const mdlCommit = keccak(concat([ci, jti, pri, birth, address]));
  // const selfId20 = mdlCommit.slice(0, 20);
  // const sig = signalHash ?? ethers.utils.randomBytes(32);
  // const userSecret = keccak(concat([selfId20, sig]));
  // const nullifierValue = keccak(concat([userSecret, scopeBytes]));

  // v4 nullifier: keccak(keccak(ci) || scope)
  const scopeBytes = keccak(ethers.utils.toUtf8Bytes(scopeString));
  const ciHash = keccak(ci);
  const nullifierValue = keccak(concat([ciHash, scopeBytes]));

  return {
    scope: bytesToNoir(scopeBytes),
    nullifier_value: bytesToNoir(nullifierValue),
    ci: bytesToNoir(ci),
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
  // TODO(HS256): Re-enable when RAON registration provides the RP shared
  // secret. Currently disabled because no off-chain HS256 verifier exists,
  // so cx_integrity_root cannot anchor anything meaningfully.
  // signalHash?: Uint8Array;
}

export interface MdlKrOwnershipInputs extends MdlKrBase {
  disclose_flags: string;
  owner_commit: string[];
  name: string[];
  birth_date: string[];
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
  const base = deriveBase(cx, opts.scopeString);

  const name = padZero(cx.name, NAME_MAX);
  const telno = padZero(cx.telno, TELNO_MAX);
  const sex = cx.sex && cx.sex.length > 0 ? cx.sex.charCodeAt(0) : 0;
  const birth = padZero(cx.birth, BIRTH_LEN);

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
    birth_date: bytesToNoir(birth),
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
    // TODO(HS256): Re-enable signal_hash when RAON RP registration lands.
    // ...inputs.signal_hash,
    ...inputs.scope,
    ...inputs.nullifier_value,
    // TODO(HS256): Re-enable cx_integrity_root when RAON RP registration lands.
    // ...inputs.cx_integrity_root,
    inputs.disclose_flags,
    ...inputs.owner_commit,
    ...inputs.ci,
    // TODO(HS256): Re-enable cx_jti, cx_pri when RAON RP registration lands.
    // ...inputs.cx_jti,
    // ...inputs.cx_pri,
    ...inputs.name,
    ...inputs.birth_date,
    ...inputs.telno,
    inputs.sex,
    // TODO(HS256): Re-enable address when derive_self_id_20 is re-enabled.
    // ...inputs.address,
    // NOTE: expected_name/birth/telno/sex are NOT circuit inputs. They are
    // used off-circuit by prepareMdlKrOwnershipInputs to compute
    // owner_commit = keccak(flag || masked(expected...)); the circuit
    // recomputes that hash from its own mDL values and asserts equality.
    // Appending them here added 89 phantom fields and broke witness
    // generation (MoproError.NoirError).
  ];
}

// --------------------------------------------------------------------------
// Age circuit (`mdl_kr_age`)
// --------------------------------------------------------------------------

export interface MdlKrAgeOpts {
  scopeString: string;
  ageThreshold: number;
  currentYear: number;
  // TODO(HS256): Re-enable when RAON registration provides the RP shared
  // secret. Currently disabled because no off-chain HS256 verifier exists,
  // so cx_integrity_root cannot anchor anything meaningfully.
  // signalHash?: Uint8Array;
}

export interface MdlKrAgeInputs extends MdlKrBase {
  age_threshold: string;
  current_year: string;
  birth_date: string[];
}

export function prepareMdlKrAgeInputs(
  cx: OmniOneCxData,
  opts: MdlKrAgeOpts,
): MdlKrAgeInputs {
  const base = deriveBase(cx, opts.scopeString);
  const birth = padZero(cx.birth, BIRTH_LEN);
  return {
    ...base,
    age_threshold: opts.ageThreshold.toString(),
    current_year: opts.currentYear.toString(),
    birth_date: bytesToNoir(birth),
  };
}

// Order MUST match circuits/mdl/kr-age/src/main.nr::main().
export function flattenMdlKrAgeInputs(inputs: MdlKrAgeInputs): string[] {
  return [
    // TODO(HS256): Re-enable signal_hash when RAON RP registration lands.
    // ...inputs.signal_hash,
    ...inputs.scope,
    ...inputs.nullifier_value,
    // TODO(HS256): Re-enable cx_integrity_root when RAON RP registration lands.
    // ...inputs.cx_integrity_root,
    inputs.age_threshold,
    inputs.current_year,
    ...inputs.ci,
    // TODO(HS256): Re-enable cx_jti, cx_pri when RAON RP registration lands.
    // ...inputs.cx_jti,
    // ...inputs.cx_pri,
    ...inputs.birth_date,
    // TODO(HS256): Re-enable address when derive_self_id_20 is re-enabled.
    // ...inputs.address,
  ];
}

// --------------------------------------------------------------------------
// Region circuit (`mdl_kr_region`)
// --------------------------------------------------------------------------

export interface MdlKrRegionOpts {
  scopeString: string;
  targetRegion: string;         // dApp-supplied si/do (e.g., "")
  // TODO(HS256): Re-enable when RAON registration provides the RP shared
  // secret. Currently disabled because no off-chain HS256 verifier exists,
  // so cx_integrity_root cannot anchor anything meaningfully.
  // signalHash?: Uint8Array;
}

export interface MdlKrRegionInputs extends MdlKrBase {
  region_code: string[];
  address: string[];
}

export function prepareMdlKrRegionInputs(
  cx: OmniOneCxData,
  opts: MdlKrRegionOpts,
): MdlKrRegionInputs {
  if (!opts.targetRegion || opts.targetRegion.trim().length === 0) {
    throw new Error('mdl_kr_region requires a non-empty targetRegion');
  }
  const base = deriveBase(cx, opts.scopeString);
  const targetRegion = padZero(opts.targetRegion, REGION_MAX);
  const regionCode = keccak(targetRegion);
  // address is still a private input for the region circuit (needed for predicate)
  const ADDRESS_MAX = 256;
  const address = padZero(cx.address ?? '', ADDRESS_MAX);
  return {
    ...base,
    region_code: bytesToNoir(regionCode),
    address: bytesToNoir(address),
  };
}

// Order MUST match circuits/mdl/kr-region/src/main.nr::main().
export function flattenMdlKrRegionInputs(inputs: MdlKrRegionInputs): string[] {
  return [
    // TODO(HS256): Re-enable signal_hash when RAON RP registration lands.
    // ...inputs.signal_hash,
    ...inputs.scope,
    ...inputs.nullifier_value,
    // TODO(HS256): Re-enable cx_integrity_root when RAON RP registration lands.
    // ...inputs.cx_integrity_root,
    ...inputs.region_code,
    ...inputs.ci,
    // TODO(HS256): Re-enable cx_jti, cx_pri when RAON RP registration lands.
    // ...inputs.cx_jti,
    // ...inputs.cx_pri,
    // TODO(HS256): Re-enable birth_date when derive_self_id_20 is re-enabled.
    // ...inputs.birth_date,
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

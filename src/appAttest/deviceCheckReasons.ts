/**
 * Why a device check (or the Coinbase KYC / Country lookup beside it) refused: one
 * stable, neutral code per distinct cause, and the ErrorModal code each
 * belongs to. One table; an unknown reason is an error.
 *
 * The person sees only the E-code's own text. The requesting dApp receives
 * the E-code and this reason, in the answer's `error` text as
 * `<the code's description> [reason: <reason>]` (relayErrorText in
 * src/utils/relayAnswer.ts) -- enough for us to name the exact cause from a
 * dApp's report, without naming the platform services or build kinds behind
 * the check. The precise English reason stays in the app's own log.
 *
 * Reasons are permanent: a reason a dApp may already have been sent is
 * never renamed or reused for another cause. The meaning of each is in
 * .claude/agents/app-dev.md ("Device-check reason codes").
 */
import type {ErrorCode} from '../constants/errorCodes';

export const DEVICE_CHECK_REASONS = Object.freeze({
  ios_device_unsupported: 'E2009',
  ios_native_module_missing: 'E2009',
  ios_key_service_unsupported: 'E2009',
  ios_key_service_unreachable: 'E3006',
  ios_key_support_check_failed: 'E2014',
  ios_key_generation_failed: 'E2014',
  ios_key_certification_failed: 'E2014',
  ios_key_assertion_failed: 'E2014',
  ios_key_refused_after_renewal: 'E2014',
  ios_key_dev_environment: 'E2014',
  ios_object_unparsable: 'E2014',
  ios_object_not_base64: 'E2014',
  ios_attestation_wrong_format: 'E2014',
  ios_attestation_no_chain: 'E2014',
  ios_credential_wrong_signature_alg: 'E2014',
  ios_credential_key_not_p256: 'E2014',
  ios_intermediate_key_not_p384: 'E2014',
  ios_credential_key_id_mismatch: 'E2014',
  ios_attestation_nonce_mismatch: 'E2014',
  ios_attestation_authdata_short: 'E2014',
  ios_attestation_rp_id_mismatch: 'E2014',
  ios_attestation_counter_nonzero: 'E2014',
  ios_attestation_unknown_environment: 'E2014',
  ios_attestation_credential_id_mismatch: 'E2014',
  ios_client_data_hash_length: 'E2014',
  ios_credential_wrong_app: 'E2014',
  ios_ca_not_pinned: 'E2014',
  ios_credential_tbs_too_long: 'E2014',
  ios_attestation_authdata_length: 'E2014',
  ios_assertion_authdata_length: 'E2014',
  ios_assertion_rp_id_mismatch: 'E2014',
  ios_assertion_counter_zero: 'E2014',
  ios_assertion_high_s: 'E2014',
  kyc_record_revoked: 'E2011',
  kyc_record_uid_malformed: 'E2005',
  kyc_record_missing: 'E2005',
  kyc_record_wrong_schema: 'E2005',
  kyc_record_wrong_issuer: 'E2005',
  kyc_record_other_wallet: 'E2005',
  kyc_lookup_unreachable: 'E3002',
  kyc_lookup_errors: 'E3002',
  kyc_lookup_incomplete: 'E3002',
  // Coinbase Country v2's lookup (src/appAttest/coinbaseStatementKinds.ts).
  country_record_revoked: 'E2011',
  country_record_uid_malformed: 'E2005',
  country_record_missing: 'E2005',
  country_record_wrong_schema: 'E2005',
  country_record_wrong_issuer: 'E2005',
  country_record_other_wallet: 'E2005',
  country_record_unreadable: 'E2005',
  country_record_differs_from_transaction: 'E2020',
  country_lookup_unreachable: 'E3002',
  country_lookup_errors: 'E3002',
  country_lookup_incomplete: 'E3002',
  device_no_verifier: 'E2018',
  proof_package_unstated: 'E2016',
  android_native_module_missing: 'E2015',
  android_key_unsupported: 'E2015',
  android_key_generation_failed: 'E2015',
  android_key_empty_chain: 'E2015',
  android_key_signing_failed: 'E2016',
  android_key_invalid_input: 'E2016',
  android_key_unknown_native_failure: 'E2016',
  android_value_not_base64: 'E2016',
  android_no_chain: 'E2016',
  android_empty_chain: 'E2015',
  android_statement_signature_invalid: 'E2016',
  android_chain_kind_changed: 'E2016',
  android_cert_unparsable: 'E2016',
  android_cert_key_wrong_curve: 'E2015',
  android_cert_key_length: 'E2016',
  android_cert_tbs_too_long: 'E2016',
  android_cert_wrong_signature_alg: 'E2015',
  android_cert_not_yet_valid: 'E2015',
  android_cert_expired: 'E2015',
  android_chain_rsa: 'E2015',
  android_chain_length: 'E2015',
  android_chain_wrong_root: 'E2015',
  android_chain_5_wrong_root: 'E2015',
  android_chain_4_not_factory: 'E2015',
  android_signing_key_not_remote_provisioned: 'E2015',
  android_signing_key_cert_has_description: 'E2015',
  android_leaf_no_key_description: 'E2015',
  android_key_description_too_many_entries: 'E2015',
  android_key_not_in_secure_hardware: 'E2015',
  android_key_security_level_mismatch: 'E2015',
  android_key_description_apps_count: 'E2015',
  android_key_description_roots_count: 'E2015',
  android_key_not_generated_in_hardware: 'E2015',
  android_key_package_count: 'E2015',
  android_key_other_app: 'E2015',
  android_app_signing_cert_count: 'E2015',
  android_app_not_store_signed: 'E2015',
  android_bootloader_unlocked: 'E2015',
  android_boot_not_verified: 'E2015',
  android_factory_chain_length: 'E2015',
  android_factory_chain_wrong_root: 'E2015',
  android_factory_intermediate_wrong_alg: 'E2015',
  android_factory_intermediate_not_ca: 'E2015',
  android_factory_intermediate_unsigned: 'E2016',
  android_factory_batch_wrong_alg: 'E2015',
  android_factory_batch_has_description: 'E2015',
  android_factory_leaf_wrong_alg: 'E2015',
  integrity_service_unreachable: 'E3008',
  integrity_service_unavailable: 'E3008',
  integrity_service_transient: 'E3008',
  integrity_service_unavailable_on_device: 'E2015',
  integrity_token_empty: 'E2016',
  integrity_token_refused: 'E2016',
  integrity_service_unknown_answer: 'E2016',
  integrity_service_bad_answer: 'E2016',
  integrity_value_not_base64url: 'E2016',
  integrity_verdict_wrong_header: 'E2016',
  integrity_verdict_payload_length: 'E2016',
  integrity_verdict_too_long: 'E2016',
  integrity_verdict_not_json: 'E2016',
  integrity_verdict_signature_length: 'E2016',
  integrity_verdict_signature_range: 'E2016',
  integrity_verdict_fields_missing: 'E2016',
  integrity_verdict_other_requester: 'E2016',
  integrity_verdict_nonce_mismatch: 'E2016',
  integrity_device_verdict_malformed: 'E2016',
  integrity_verdict_other_app: 'E2017',
  integrity_app_not_recognized: 'E2017',
  integrity_device_not_met: 'E2017',
} satisfies Record<string, ErrorCode>);

export type DeviceCheckReason = keyof typeof DEVICE_CHECK_REASONS;

/** A reason's E-code. Throws on a reason the table does not hold. */
export function deviceCheckCode(reason: string): ErrorCode {
  if (!Object.prototype.hasOwnProperty.call(DEVICE_CHECK_REASONS, reason)) {
    throw new Error(`Unknown device-check reason '${reason}'. Known: ${Object.keys(DEVICE_CHECK_REASONS).join(', ')}.`);
  }
  return DEVICE_CHECK_REASONS[reason as DeviceCheckReason];
}

/** A reason as the relay answer carries it: lowercase words joined by '_'. */
export const DEVICE_CHECK_REASON_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

export function isDeviceCheckReason(value: unknown): value is DeviceCheckReason {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DEVICE_CHECK_REASONS, value);
}

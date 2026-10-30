/**
 * Words that name the platform services, vendors or build kinds behind a
 * device check. No text a person or a requesting dApp reads may carry them
 * (CLAUDE.md, "Disclose As Little As Possible"): screens say "security
 * check", relay answers carry a neutral reason code
 * (src/appAttest/deviceCheckReasons.ts). The precise wording stays in logs.
 */
export const SERVICE_NAMES =
  /App Attest|AppAttest|DCAppAttest|Play Integrity|Integrity API|Key Attestation|KeyMint|Keystore|KeyStore|StrongBox|Secure Enclave|SafetyNet|DeviceCheck|\bKMS\b|RAON|라온|Apple's|Apple 서비스|sandbox|샌드박스|TestFlight|Xcode|RKP|Remote Key Provisioning|Droid CA|\bEAS\b|GraphQL/i;

export function namesAService(text: string): boolean {
  return SERVICE_NAMES.test(text);
}

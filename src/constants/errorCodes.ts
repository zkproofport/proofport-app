// Error code registry — every user-facing error gets a unique code
// E1xxx: Deep link / proof request errors
// E2xxx: Proof generation errors
// E3xxx: Network / API errors
// E4xxx: Wallet errors
// E5xxx: Storage / data errors

export const ErrorCodes = {
  // Deep link errors
  E1001: {
    code: 'E1001',
    title: 'Invalid Proof Request',
    description: 'The proof request URL could not be parsed.',
  },
  E1002: {
    code: 'E1002',
    title: 'Invalid Proof Request',
    description: 'The proof request failed validation.',
  },
  E1003: {
    code: 'E1003',
    title: 'Expired Request',
    description: 'This proof request has expired.',
  },
  E1004: {
    code: 'E1004',
    title: 'Missing Required Input',
    description: 'Required fields are missing from the proof request.',
  },
  E1005: {
    code: 'E1005',
    title: 'Unsupported Circuit',
    description: 'This proof type is not supported.',
  },
  E1006: {
    code: 'E1006',
    title: 'Unregistered Request',
    description: 'This proof request is not registered with the relay server. Only requests from authorized applications are accepted.',
  },
  // The request already has its one answer — this app sent it, or the relay
  // holds one. A relay request is answered exactly once (src/utils/relayAnswer.ts),
  // so a retry here could only produce a proof nobody receives.
  E1007: {
    code: 'E1007',
    title: 'Request Already Answered',
    description:
      'This proof request has already been answered. Start a new request from the app that asked for the proof.',
  },
  // A dApp asked for a Laboratory proof (GIWA, Dojang Playground, Korea Mobile
  // ID) while More > Laboratory is off. The request is answered with this code
  // rather than opened or dropped -- see src/utils/laboratory.ts.
  E1008: {
    code: 'E1008',
    title: 'Laboratory Is Off',
    description:
      'This request asks for a Laboratory proof. Turn on Laboratory in More, then start the request again from the app that asked for it.',
  },

  // Proof generation errors
  E2001: {
    code: 'E2001',
    title: 'Proof Generation Failed',
    description: 'An error occurred while generating the proof.',
  },
  E2002: {
    code: 'E2002',
    title: 'Circuit Download Failed',
    description: 'Failed to download the required circuit files.',
  },
  E2003: {
    code: 'E2003',
    title: 'Verification Failed',
    description: 'The generated proof could not be verified.',
  },
  E2004: {
    code: 'E2004',
    title: 'Missing Inputs',
    description: 'Required proof inputs are missing.',
  },
  E2005: {
    code: 'E2005',
    title: 'Attestation Not Found',
    description: 'No valid attestation was found for your wallet.',
  },
  E2006: {
    code: 'E2006',
    title: 'Unsupported Proof Type',
    description:
      'This request names a proof type the app does not support. Nothing was generated.',
  },
  // Raised only when the wallet's whole GIWA history was read and holds no
  // usable Playground issuance. A lookup that did not finish is E3002.
  E2007: {
    code: 'E2007',
    title: 'No Dojang Playground Issuance',
    description:
      'This wallet has not issued itself a Dojang in the GIWA Playground. Issue one there with this wallet first, then try again.',
  },

  // OIDC (Google / Microsoft) sign-in did not produce a usable token. A sign-in
  // the person dismissed is a cancel, not this.
  E2008: {
    code: 'E2008',
    title: 'Sign-In Failed',
    description:
      'Signing in to your account did not complete, so no proof was generated.',
  },

  // Apple App Attest (Coinbase KYC v2 and the OIDC domain proof, iOS).
  // Each cause asks the person for something different, so each has a code:
  // src/appAttest/appAttestError.ts maps causes to these.
  E2009: {
    code: 'E2009',
    title: 'App Attest Not Available',
    description:
      'This device cannot use Apple App Attest, which this proof requires. The simulator never can. Use a recent iPhone.',
  },
  E2011: {
    code: 'E2011',
    title: 'Coinbase Verification Revoked',
    description:
      'Coinbase has revoked the verification for this wallet, so no proof was generated. Verify again with Coinbase, then try again.',
  },
  // The provider returned an ID token without the nonce this request asked
  // for (src/oidc/oidcNonce.ts). Such a token is not tied to this request, so
  // it is never proved. E2009, E2011 and E2014 are App Attest; E2015-E2016
  // are Android key attestation.
  E2012: {
    code: 'E2012',
    title: 'Sign-In Not Tied to This Request',
    description:
      'The sign-in answer was not issued for this request, so no proof was generated. Try signing in again.',
  },
  E2014: {
    code: 'E2014',
    title: 'App Attest Check Failed',
    description:
      'The App Attest data from this device could not be used for the proof. Nothing was generated.',
  },
  // Android key attestation (Coinbase KYC v2 and the OIDC domain proof on
  // Android): src/appAttest/appAttestError.ts ANDROID_ATTEST_ERROR_CODE.
  E2015: {
    code: 'E2015',
    title: 'Device Attestation Not Available',
    description:
      'This phone cannot confirm, in its secure hardware, that the proof comes from the official ZKProofport app on an unmodified device. Nothing was generated.',
  },
  E2016: {
    code: 'E2016',
    title: 'Device Check Failed',
    description:
      'The attestation data from this phone could not be used for the proof. Nothing was generated.',
  },

  // Network errors
  E3001: {
    code: 'E3001',
    title: 'Network Error',
    description:
      'Unable to connect to the server. Please check your internet connection.',
  },
  E3002: {
    code: 'E3002',
    title: 'Server Error',
    description: 'The server returned an unexpected error.',
  },
  E3003: {
    code: 'E3003',
    title: 'Callback Failed',
    description:
      'Failed to send the proof result back to the requesting app.',
  },
  E3004: {
    code: 'E3004',
    title: 'Request Timeout',
    description: 'The request timed out. Please try again.',
  },
  E3005: {
    code: 'E3005',
    title: 'Circuit Files Missing',
    description:
      'The proof files could not be downloaded. Reopen the app once you are back online.',
  },
  E3006: {
    code: 'E3006',
    title: 'Apple Service Unreachable',
    description:
      "Apple's App Attest service could not be reached to certify this device. Check your connection and try again.",
  },
  // A production build proves only with one circuits release
  // (CIRCUITS_RELEASE_TAG, src/config/contracts.ts). When that tag does not
  // answer, nothing is read from main or another release instead.
  E3007: {
    code: 'E3007',
    title: 'Proof Files Not Published',
    description:
      'The proof files this version of ZKProofport needs are not available yet, so proofs cannot be made. Please update the app or try again later.',
  },

  // Wallet errors
  E4001: {
    code: 'E4001',
    title: 'Wallet Not Connected',
    description: 'Please connect your wallet first.',
  },
  E4002: {
    code: 'E4002',
    title: 'Signing Failed',
    description: 'Failed to sign the message with your wallet.',
  },
  E4003: {
    code: 'E4003',
    title: 'Wallet Connection Failed',
    description: 'Could not connect to your wallet.',
  },
  E4004: {
    code: 'E4004',
    title: 'Disconnect Failed',
    description:
      'The wallet did not let go of the session. Disconnecting from inside the wallet app usually clears it.',
  },

  // Storage errors
  E5001: {
    code: 'E5001',
    title: 'Storage Error',
    description: 'Failed to save data locally.',
  },
  E5002: {
    code: 'E5002',
    title: 'Data Load Failed',
    description: 'Failed to load saved data.',
  },

  // OpenStoa mini-app errors.
  //
  // The mini-app cannot import this file — it is a separate package that talks
  // to the host only through `HostApi.showError(code, details)` — so these are
  // the host's half of a contract kept by a test rather than by the compiler.
  // Every code the mini-app raises MUST have an entry here: an unregistered one
  // used to produce a modal with no title and no text at all.
  E9000: {
    code: 'E9000',
    title: "Couldn't Turn On the Domain Badge",
    description: 'Your workspace badge was not enabled. Please try again.',
  },
  E9001: {
    code: 'E9001',
    title: "Couldn't Turn Off the Domain Badge",
    description: 'Your workspace badge is still showing. Please try again.',
  },
  E9002: {
    code: 'E9002',
    title: "Couldn't Upload the Photo",
    description: 'Your profile photo was not changed. Please try again.',
  },
  E9003: {
    code: 'E9003',
    title: "Couldn't Save the Nickname",
    description: 'Your nickname was not changed.',
  },
  E9004: {
    code: 'E9004',
    title: "Couldn't Remove the Domain Badge",
    description: 'Your workspace badge is still showing. Please try again.',
  },
  E9005: {
    code: 'E9005',
    title: "Couldn't Delete the Account",
    description: 'Your account is still active. Please try again.',
  },
  E9006: {
    code: 'E9006',
    title: "Couldn't Remove the Photo",
    description: 'Your profile photo is still there. Please try again.',
  },
  // Distinct from E9998 on purpose. E9998 means the request never left the
  // device, so nothing changed and retrying is free. This one means the server
  // took the request and never answered — whether it landed is UNKNOWN, and a
  // modal that claimed otherwise would send someone off to post the same thing
  // twice. Raised by the mini-app's `api/failure.ts` (TIMEOUT_ERROR_CODE).
  E9997: {
    code: 'E9997',
    title: 'The Server Did Not Answer',
    description:
      'The request timed out before the server replied. It may or may not have gone through — check before trying again.',
  },
  E9998: {
    code: 'E9998',
    title: 'No Connection',
    description:
      'The request could not reach the server. Check your connection and try again — nothing was changed.',
  },
  E9999: {
    code: 'E9999',
    title: 'Something Went Wrong',
    description: 'The action did not complete.',
  },
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

export interface AppError {
  code: ErrorCode;
  title: string;
  description: string;
  details?: string; // Technical details for developers (shown in smaller text)
}

/**
 * The modal's content for a code.
 *
 * Takes `string`, not `ErrorCode`, on purpose. The compiler cannot police the
 * OpenStoa mini-app: it is a separate package whose only channel to the host is
 * `HostApi.showError(code: string, …)`, so an unregistered code reaches this
 * function as a plain string at runtime no matter what the signature says. It
 * used to spread `ErrorCodes[code]` blindly — `undefined` spreads to nothing,
 * so the modal opened with no title and no description, which reads to the
 * person using the app as "the button did nothing".
 *
 * An unknown code now falls back to E9999 and carries the original code in the
 * details line, so the failure is still visible AND still diagnosable. The
 * registry stays the place to fix it; this is only the floor.
 */
export function createAppError(code: string, details?: string): AppError {
  const errorDef = (ErrorCodes as Record<string, AppError | undefined>)[code];
  if (!errorDef) {
    const fallback = ErrorCodes.E9999;
    return {
      ...fallback,
      details: details ? `${code}: ${details}` : code,
    };
  }
  return {...errorDef, details};
}

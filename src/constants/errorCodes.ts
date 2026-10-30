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
  // A dApp asked for a Laboratory proof (GIWA, Dojang Playground) while
  // More > Laboratory is off. The request is answered with this code
  // rather than opened or dropped -- see src/utils/laboratory.ts.
  E1008: {
    code: 'E1008',
    title: 'Laboratory Is Off',
    description:
      'This request asks for a Laboratory proof. Turn on Laboratory in More, then start the request again from the app that asked for it.',
  },
  // This version is below the published minimum (src/utils/forceUpdate.ts).
  // The person sees the update screen; this is the dApp's answer.
  E1009: {
    code: 'E1009',
    title: 'Update Required',
    description:
      'This version of ZKProofport is no longer supported. Update the app, then start the request again.',
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

  // The iPhone's device check (Coinbase KYC v2 and the OIDC domain proof).
  // Each cause asks the person for something different, so each has a code:
  // src/appAttest/appAttestError.ts maps causes to these.
  E2009: {
    code: 'E2009',
    title: "Security Check Not Available",
    description:
      "This device cannot run the security check this proof requires. Try again on a supported device.",
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
  // are Android key attestation, E2017 its integrity verdict.
  E2012: {
    code: 'E2012',
    title: 'Sign-In Not Tied to This Request',
    description:
      'The sign-in answer was not issued for this request, so no proof was generated. Try signing in again.',
  },
  // E2009-E2011, E2014-E2018, E2020 and E3006 are device-check codes. E2013 is not
  // assigned: a code a dApp may already have been sent is never reused.
  E2014: {
    code: 'E2014',
    title: "This Device's Security Check Failed",
    description:
      "The result of this device's security check could not be used for the proof. Nothing was generated.",
  },
  // The Android phone's device check (Coinbase KYC v2 and the OIDC domain
  // proof): src/appAttest/appAttestError.ts ANDROID_ATTEST_ERROR_CODE.
  E2015: {
    code: 'E2015',
    title: "Security Check Not Available",
    description:
      "This phone cannot confirm that the proof comes from the official ZKProofport app on an unmodified device. Nothing was generated.",
  },
  E2016: {
    code: 'E2016',
    title: "This Device's Security Check Failed",
    description:
      "The result of this phone's security check could not be used for the proof. Nothing was generated.",
  },
  E2017: {
    code: 'E2017',
    title: 'Device Integrity Not Met',
    description:
      'This phone did not pass the integrity check this proof requires: the official ZKProofport app on an unmodified device. Nothing was generated.',
  },
  E2018: {
    code: 'E2018',
    title: 'Proof Cannot Be Checked Here',
    description:
      'A proof from this phone for this request could not be checked by the requesting service, so none was made.',
  },
  // A proof that was running when the app was closed (killed for memory,
  // swiped away): reported on the next launch, and to the dApp for a relay
  // request.
  E2019: {
    code: 'E2019',
    title: 'Proof Interrupted',
    description:
      'The app closed while the proof was being made, so no proof was sent. Start the request again to make a new one.',
  },
  // Coinbase Country v2: the country in the wallet's current Coinbase
  // verification is not the one in the transaction that recorded it
  // (src/appAttest/revocationStatement.ts). Refused before the wallet signs:
  // the circuit would refuse the proof.
  E2020: {
    code: 'E2020',
    title: 'Country Verification Does Not Match',
    description:
      'The country in your Coinbase verification could not be matched to its record, so no proof was generated. Verify your country again with Coinbase, then try again.',
  },

  // Human Passport (src/utils/humanPassport.ts). Raised only when the score
  // lookup finished; one that did not finish is E3001.
  E2021: {
    code: 'E2021',
    title: 'No Human Passport Score',
    description:
      'This wallet has no current Human Passport score recorded on Base. Create or refresh your score in Human Passport and record it on Base with this wallet, then try again.',
  },
  E2022: {
    code: 'E2022',
    title: 'Human Passport Score Too Low',
    description:
      'Your Human Passport score is below the score this request asks for, so no proof was generated. Raise your score in Human Passport, record it on Base, then try again.',
  },
  E2023: {
    code: 'E2023',
    title: 'Human Passport Score Too Large',
    description:
      'Your Human Passport score carries more stamp data than this proof can hold, so no proof was generated.',
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
    title: "Security Check Unreachable",
    description:
      "The security check for this device could not be reached. Check your connection and try again.",
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
  // The device check of a factory-provisioned Android phone could not be made
  // now (src/androidAttest/playIntegrity.ts): retry later.
  E3008: {
    code: 'E3008',
    title: 'Device Check Unavailable',
    description:
      'The device check could not be completed right now. Check your connection and try again in a moment. Nothing was generated.',
  },

  // The update screen's store button could not open the store. E3009, not
  // E3008: E3008 is the Android device check's (sent to dApps as well).
  E3009: {
    code: 'E3009',
    title: "Couldn't Open the Store",
    description:
      'The app store could not be opened. Open the App Store or Google Play yourself and update ZKProofport.',
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

/**
 * The device-check codes, whose detail never reaches the screen.
 *
 * Their detail is the precise reason a device check refused (which signing
 * key, which certificate, which verdict field, which build kind), and it
 * names the platform services behind the check. A person can do nothing with
 * it, and a screen does not say how the plumbing works (CLAUDE.md, "Disclose
 * As Little As Possible"). The modal and the proof screen show only the
 * code's own neutral text; the detail stays in the log and the attempt log.
 */
export const DETAILS_STAY_IN_LOGS: ReadonlySet<string> = new Set([
  'E2009', 'E2014', 'E2015', 'E2016', 'E2017', 'E3006', 'E3008',
]);

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
  return {...errorDef, details: DETAILS_STAY_IN_LOGS.has(code) ? undefined : details};
}

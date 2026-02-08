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
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

export interface AppError {
  code: ErrorCode;
  title: string;
  description: string;
  details?: string; // Technical details for developers (shown in smaller text)
}

export function createAppError(code: ErrorCode, details?: string): AppError {
  const errorDef = ErrorCodes[code];
  return {...errorDef, details};
}

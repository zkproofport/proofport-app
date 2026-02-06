// Bridge to trigger error modals from outside the React tree
// (e.g., from App.tsx's handleDeepLink before ErrorProvider is in scope)
import type {ErrorCode} from '../constants/errorCodes';

type ErrorHandler = (code: ErrorCode, details?: string) => void;

let _errorHandler: ErrorHandler | null = null;

export function registerErrorHandler(handler: ErrorHandler) {
  _errorHandler = handler;
}

export function showGlobalError(code: ErrorCode, details?: string) {
  if (_errorHandler) {
    _errorHandler(code, details);
  } else {
    console.log(`[Error] ${code}: ${details || ''} (no handler registered)`);
  }
}

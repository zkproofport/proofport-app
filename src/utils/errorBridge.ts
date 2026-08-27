// Bridge to trigger error modals from outside the React tree
// (e.g., from App.tsx's handleDeepLink before ErrorProvider is in scope)
import type {ErrorCode} from '../constants/errorCodes';

type ErrorHandler = (code: ErrorCode, details?: string) => void;

let _errorHandler: ErrorHandler | null = null;

/*
 * AN ERROR RAISED BEFORE THE MODAL EXISTS IS HELD, NOT DROPPED.
 *
 * THE DEFECT THIS REPLACES, on a phone 2026-08-27. `ErrorProvider` wraps the
 * main tree; the loading screen returns before it, so nothing is registered
 * while circuits download. With the phone offline those downloads reject in
 * under a second — well inside the loading window — and this function's old
 * shape wrote one console line and returned. The app opened with no circuit
 * files, no warning, and no retry until the next launch; the first the person
 * heard of it was a proof that failed later for no stated reason.
 *
 * ONE is held rather than a queue. The earliest failure is the one that
 * explains the others, and three modals stacked at launch is its own defect.
 * Later ones are counted into the detail line so they are not silent either.
 */
let _pending: {code: ErrorCode; details?: string} | null = null;
let _suppressed = 0;

export function registerErrorHandler(handler: ErrorHandler) {
  _errorHandler = handler;
  if (!_pending) return;
  const held = _pending;
  const alsoDropped = _suppressed;
  _pending = null;
  _suppressed = 0;
  const detail =
    alsoDropped > 0
      ? `${held.details ?? ''} (+${alsoDropped} more)`.trim()
      : held.details;
  handler(held.code, detail);
}

/** Test seam: forget both the handler and anything held for it. */
export function resetErrorBridge() {
  _errorHandler = null;
  _pending = null;
  _suppressed = 0;
}

export function showGlobalError(code: ErrorCode, details?: string) {
  if (_errorHandler) {
    _errorHandler(code, details);
    return;
  }
  if (_pending) {
    _suppressed += 1;
    console.log(`[Error] ${code}: ${details || ''} (held one already; counted)`);
    return;
  }
  _pending = {code, details};
  console.log(`[Error] ${code}: ${details || ''} (held until the modal exists)`);
}

/**
 * Error Context for displaying error modals anywhere in the app
 */

import React, {createContext, useContext, useState, useCallback} from 'react';
import {
  createAppError,
  type ErrorCode,
  type AppError,
} from '../constants/errorCodes';
import {registerErrorHandler} from '../utils/errorBridge';

interface ErrorContextValue {
  /** Current error to display */
  error: AppError | null;
  /** Show an error modal by error code */
  showError: (code: ErrorCode, details?: string) => void;
  /** Dismiss the error modal */
  clearError: () => void;
}

const ErrorContext = createContext<ErrorContextValue | null>(null);

export const ErrorProvider: React.FC<{children: React.ReactNode}> = ({
  children,
}) => {
  const [error, setError] = useState<AppError | null>(null);

  const showError = useCallback((code: ErrorCode, details?: string) => {
    console.log(`[ErrorModal] ${code}: ${details || ''}`);
    setError(createAppError(code, details));
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Register handler so showGlobalError() works outside the React tree
  React.useEffect(() => {
    registerErrorHandler(showError);
  }, [showError]);

  return (
    <ErrorContext.Provider value={{error, showError, clearError}}>
      {children}
    </ErrorContext.Provider>
  );
};

export const useError = () => {
  const context = useContext(ErrorContext);
  if (!context) {
    throw new Error('useError must be used within ErrorProvider');
  }
  return context;
};

export default ErrorContext;

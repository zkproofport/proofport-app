/**
 * Convert ArrayBuffer to hex string for display
 */
export const arrayBufferToHex = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Get current timestamp in HH:MM:SS format
 */
export const getTimestamp = (): string => {
  return new Date().toLocaleTimeString();
};

/**
 * Validate age verification inputs
 */
export const validateInputs = (
  birthYear: string,
  currentYear: string,
  minAge: string,
): {isValid: boolean; error?: string} => {
  const birthYearNum = parseInt(birthYear, 10);
  const currentYearNum = parseInt(currentYear, 10);
  const minAgeNum = parseInt(minAge, 10);

  if (isNaN(birthYearNum) || isNaN(currentYearNum) || isNaN(minAgeNum)) {
    return {isValid: false, error: 'All inputs must be valid numbers'};
  }

  if (birthYearNum > currentYearNum) {
    return {isValid: false, error: 'Birth year cannot be greater than current year'};
  }

  return {isValid: true};
};

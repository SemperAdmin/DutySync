/**
 * Shared utility functions
 */

/**
 * Check if an EDIPI looks valid (exactly 10 digits)
 * Used to detect when EDIPI decryption has failed and produced garbled output
 */
export function isValidEdipi(edipi: string): boolean {
  return /^\d{10}$/.test(edipi);
}

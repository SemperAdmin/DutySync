/**
 * CSRF Protection Utility
 *
 * Provides Cross-Site Request Forgery protection for form submissions.
 * Generates unique tokens per session and validates them on submission.
 *
 * Usage:
 * 1. Generate token: const token = generateCsrfToken()
 * 2. Include in form: <input type="hidden" name="_csrf" value={token} />
 * 3. Validate on submit: if (!validateCsrfToken(formToken)) return;
 */

const CSRF_TOKEN_KEY = "dutysync_csrf_token";
const CSRF_TOKEN_TIMESTAMP_KEY = "dutysync_csrf_timestamp";
const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

/**
 * Generate a cryptographically secure random token
 */
function generateSecureToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Get or create a CSRF token for the current session
 * Tokens are stored in sessionStorage and expire after 1 hour
 */
export function getCsrfToken(): string {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const existingToken = sessionStorage.getItem(CSRF_TOKEN_KEY);
    const timestamp = sessionStorage.getItem(CSRF_TOKEN_TIMESTAMP_KEY);

    // Check if token exists and hasn't expired
    if (existingToken && timestamp) {
      const tokenAge = Date.now() - parseInt(timestamp, 10);
      if (tokenAge < TOKEN_EXPIRY_MS) {
        return existingToken;
      }
    }

    // Generate new token
    const newToken = generateSecureToken();
    sessionStorage.setItem(CSRF_TOKEN_KEY, newToken);
    sessionStorage.setItem(CSRF_TOKEN_TIMESTAMP_KEY, Date.now().toString());
    return newToken;
  } catch {
    // If sessionStorage is not available, generate ephemeral token
    return generateSecureToken();
  }
}

/**
 * Generate a new CSRF token (forces regeneration)
 */
export function generateCsrfToken(): string {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const newToken = generateSecureToken();
    sessionStorage.setItem(CSRF_TOKEN_KEY, newToken);
    sessionStorage.setItem(CSRF_TOKEN_TIMESTAMP_KEY, Date.now().toString());
    return newToken;
  } catch {
    return generateSecureToken();
  }
}

/**
 * Validate a CSRF token against the stored session token
 */
export function validateCsrfToken(token: string | null | undefined): boolean {
  if (typeof window === "undefined" || !token) {
    return false;
  }

  try {
    const storedToken = sessionStorage.getItem(CSRF_TOKEN_KEY);
    const timestamp = sessionStorage.getItem(CSRF_TOKEN_TIMESTAMP_KEY);

    if (!storedToken || !timestamp) {
      return false;
    }

    // Check token expiry
    const tokenAge = Date.now() - parseInt(timestamp, 10);
    if (tokenAge > TOKEN_EXPIRY_MS) {
      // Token expired, clear it
      sessionStorage.removeItem(CSRF_TOKEN_KEY);
      sessionStorage.removeItem(CSRF_TOKEN_TIMESTAMP_KEY);
      return false;
    }

    // Constant-time comparison to prevent timing attacks
    return constantTimeCompare(token, storedToken);
  } catch {
    return false;
  }
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Clear CSRF token (call on logout)
 */
export function clearCsrfToken(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    sessionStorage.removeItem(CSRF_TOKEN_KEY);
    sessionStorage.removeItem(CSRF_TOKEN_TIMESTAMP_KEY);
  } catch {
    // Ignore errors
  }
}

/**
 * React hook for CSRF protection
 */
import React, { useState, useEffect } from "react";

export function useCsrfToken(): string {
  const [token, setToken] = useState("");

  useEffect(() => {
    setToken(getCsrfToken());
  }, []);

  return token;
}

/**
 * Higher-order function to wrap form submission with CSRF validation
 */
export function withCsrfProtection<T extends (...args: unknown[]) => Promise<unknown>>(
  handler: T,
  getToken: () => string | null | undefined
): T {
  return (async (...args: Parameters<T>) => {
    const token = getToken();
    if (!validateCsrfToken(token)) {
      throw new Error("Invalid or expired security token. Please refresh the page and try again.");
    }
    return handler(...args);
  }) as T;
}

/**
 * Hidden input component for CSRF token (for use in forms)
 */
export function CsrfTokenInput(): React.ReactElement {
  const token = useCsrfToken();
  return <input type="hidden" name="_csrf" value={token} />;
}

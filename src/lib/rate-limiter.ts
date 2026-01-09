/**
 * Rate Limiter Utility
 *
 * Provides client-side rate limiting to protect against brute force attacks.
 * Uses localStorage to persist attempt counts across page reloads.
 *
 * Note: This is a client-side implementation. For production, also implement
 * server-side rate limiting at the API/database level.
 */

interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
  blockDurationMs: number;
}

interface RateLimitState {
  attempts: number;
  firstAttemptTime: number;
  blockedUntil: number | null;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxAttempts: 5,        // Max attempts before blocking
  windowMs: 15 * 60 * 1000,  // 15 minute window
  blockDurationMs: 30 * 60 * 1000,  // 30 minute block
};

const STORAGE_KEY_PREFIX = "dutysync_ratelimit_";

/**
 * Get rate limit state from localStorage
 */
function getState(key: string): RateLimitState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_PREFIX + key);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return {
    attempts: 0,
    firstAttemptTime: 0,
    blockedUntil: null,
  };
}

/**
 * Save rate limit state to localStorage
 */
function setState(key: string, state: RateLimitState): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + key, JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Clear rate limit state
 */
function clearState(key: string): void {
  try {
    localStorage.removeItem(STORAGE_KEY_PREFIX + key);
  } catch {
    // Ignore storage errors
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remainingAttempts: number;
  blockedUntil: Date | null;
  retryAfterMs: number | null;
}

/**
 * Check if an action is allowed under rate limiting rules
 */
export function checkRateLimit(
  key: string,
  config: Partial<RateLimitConfig> = {}
): RateLimitResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const now = Date.now();
  const state = getState(key);

  // Check if currently blocked
  if (state.blockedUntil && now < state.blockedUntil) {
    return {
      allowed: false,
      remainingAttempts: 0,
      blockedUntil: new Date(state.blockedUntil),
      retryAfterMs: state.blockedUntil - now,
    };
  }

  // Clear block if expired
  if (state.blockedUntil && now >= state.blockedUntil) {
    clearState(key);
    return {
      allowed: true,
      remainingAttempts: cfg.maxAttempts,
      blockedUntil: null,
      retryAfterMs: null,
    };
  }

  // Check if window has expired and reset
  if (state.firstAttemptTime && now - state.firstAttemptTime > cfg.windowMs) {
    clearState(key);
    return {
      allowed: true,
      remainingAttempts: cfg.maxAttempts,
      blockedUntil: null,
      retryAfterMs: null,
    };
  }

  const remainingAttempts = Math.max(0, cfg.maxAttempts - state.attempts);

  return {
    allowed: remainingAttempts > 0,
    remainingAttempts,
    blockedUntil: null,
    retryAfterMs: null,
  };
}

/**
 * Record a failed attempt and potentially block
 */
export function recordFailedAttempt(
  key: string,
  config: Partial<RateLimitConfig> = {}
): RateLimitResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const now = Date.now();
  let state = getState(key);

  // Reset if window expired
  if (state.firstAttemptTime && now - state.firstAttemptTime > cfg.windowMs) {
    state = {
      attempts: 0,
      firstAttemptTime: 0,
      blockedUntil: null,
    };
  }

  // Record attempt
  state.attempts += 1;
  if (!state.firstAttemptTime) {
    state.firstAttemptTime = now;
  }

  // Check if should block
  if (state.attempts >= cfg.maxAttempts) {
    state.blockedUntil = now + cfg.blockDurationMs;
  }

  setState(key, state);

  const remainingAttempts = Math.max(0, cfg.maxAttempts - state.attempts);

  return {
    allowed: remainingAttempts > 0,
    remainingAttempts,
    blockedUntil: state.blockedUntil ? new Date(state.blockedUntil) : null,
    retryAfterMs: state.blockedUntil ? state.blockedUntil - now : null,
  };
}

/**
 * Record a successful attempt (clears rate limit state)
 */
export function recordSuccessfulAttempt(key: string): void {
  clearState(key);
}

/**
 * Get remaining time until rate limit resets
 */
export function getRateLimitStatus(
  key: string,
  config: Partial<RateLimitConfig> = {}
): RateLimitResult {
  return checkRateLimit(key, config);
}

/**
 * Format retry time for display
 */
export function formatRetryTime(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) {
    return `${seconds} second${seconds !== 1 ? "s" : ""}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
}

// Pre-configured rate limiters for common use cases
export const loginRateLimiter = {
  check: () => checkRateLimit("login", { maxAttempts: 5, windowMs: 15 * 60 * 1000, blockDurationMs: 30 * 60 * 1000 }),
  recordFailure: () => recordFailedAttempt("login", { maxAttempts: 5, windowMs: 15 * 60 * 1000, blockDurationMs: 30 * 60 * 1000 }),
  recordSuccess: () => recordSuccessfulAttempt("login"),
};

export const signupRateLimiter = {
  check: () => checkRateLimit("signup", { maxAttempts: 3, windowMs: 60 * 60 * 1000, blockDurationMs: 60 * 60 * 1000 }),
  recordFailure: () => recordFailedAttempt("signup", { maxAttempts: 3, windowMs: 60 * 60 * 1000, blockDurationMs: 60 * 60 * 1000 }),
  recordSuccess: () => recordSuccessfulAttempt("signup"),
};

export const passwordResetRateLimiter = {
  check: () => checkRateLimit("password_reset", { maxAttempts: 3, windowMs: 60 * 60 * 1000, blockDurationMs: 60 * 60 * 1000 }),
  recordFailure: () => recordFailedAttempt("password_reset", { maxAttempts: 3, windowMs: 60 * 60 * 1000, blockDurationMs: 60 * 60 * 1000 }),
  recordSuccess: () => recordSuccessfulAttempt("password_reset"),
};

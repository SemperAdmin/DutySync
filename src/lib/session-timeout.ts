/**
 * Session Timeout Manager
 *
 * Automatically logs out users after a period of inactivity.
 * Tracks user activity and provides warnings before logout.
 */

type TimeoutCallback = () => void;
type WarningCallback = (remainingMs: number) => void;

export interface SessionTimeoutConfig {
  /** Time in ms until session expires (default: 30 minutes) */
  timeoutMs: number;
  /** Time in ms before timeout to show warning (default: 5 minutes) */
  warningMs: number;
  /** Events that reset the activity timer */
  activityEvents: string[];
  /** Callback when session times out */
  onTimeout: TimeoutCallback;
  /** Callback when warning should be shown */
  onWarning?: WarningCallback;
  /** Callback when warning is dismissed (activity detected) */
  onWarningDismissed?: () => void;
}

const DEFAULT_CONFIG: Omit<SessionTimeoutConfig, "onTimeout"> = {
  timeoutMs: 30 * 60 * 1000, // 30 minutes
  warningMs: 5 * 60 * 1000,  // 5 minutes before timeout
  activityEvents: [
    "mousedown",
    "mousemove",
    "keydown",
    "scroll",
    "touchstart",
    "click",
  ],
};

const LAST_ACTIVITY_KEY = "dutysync_last_activity";

class SessionTimeoutManager {
  private config: SessionTimeoutConfig;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private warningTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private warningIntervalId: ReturnType<typeof setInterval> | null = null;
  private isWarningShown = false;
  private isInitialized = false;
  private boundHandleActivity: () => void;

  constructor(config: Partial<SessionTimeoutConfig> & { onTimeout: TimeoutCallback }) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.boundHandleActivity = this.handleActivity.bind(this);
  }

  /**
   * Start monitoring for inactivity
   */
  start(): void {
    if (typeof window === "undefined" || this.isInitialized) return;

    this.isInitialized = true;
    this.updateLastActivity();
    this.resetTimers();
    this.addEventListeners();
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (!this.isInitialized) return;

    this.isInitialized = false;
    this.clearTimers();
    this.removeEventListeners();
  }

  /**
   * Extend the session (e.g., when user clicks "Stay logged in")
   */
  extend(): void {
    this.updateLastActivity();
    this.resetTimers();
    this.dismissWarning();
  }

  /**
   * Get remaining time until timeout
   */
  getRemainingTime(): number {
    const lastActivity = this.getLastActivity();
    const elapsed = Date.now() - lastActivity;
    return Math.max(0, this.config.timeoutMs - elapsed);
  }

  /**
   * Check if session is about to expire
   */
  isAboutToExpire(): boolean {
    return this.getRemainingTime() <= this.config.warningMs;
  }

  private handleActivity(): void {
    // Throttle activity updates to avoid excessive writes
    const now = Date.now();
    const lastActivity = this.getLastActivity();

    // Only update if more than 1 second has passed
    if (now - lastActivity > 1000) {
      this.updateLastActivity();
      this.resetTimers();

      // If warning was shown, dismiss it
      if (this.isWarningShown) {
        this.dismissWarning();
      }
    }
  }

  private updateLastActivity(): void {
    try {
      localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
    } catch {
      // Ignore storage errors
    }
  }

  private getLastActivity(): number {
    try {
      const stored = localStorage.getItem(LAST_ACTIVITY_KEY);
      return stored ? parseInt(stored, 10) : Date.now();
    } catch {
      return Date.now();
    }
  }

  private resetTimers(): void {
    this.clearTimers();

    const remaining = this.getRemainingTime();
    const warningTime = remaining - this.config.warningMs;

    // Set warning timer
    if (warningTime > 0 && this.config.onWarning) {
      this.warningTimeoutId = setTimeout(() => {
        this.showWarning();
      }, warningTime);
    }

    // Set timeout timer
    this.timeoutId = setTimeout(() => {
      this.handleTimeout();
    }, remaining);
  }

  private clearTimers(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.warningTimeoutId) {
      clearTimeout(this.warningTimeoutId);
      this.warningTimeoutId = null;
    }
    if (this.warningIntervalId) {
      clearInterval(this.warningIntervalId);
      this.warningIntervalId = null;
    }
  }

  private showWarning(): void {
    this.isWarningShown = true;

    // Call warning callback with remaining time, updating every second
    if (this.config.onWarning) {
      this.config.onWarning(this.getRemainingTime());

      this.warningIntervalId = setInterval(() => {
        const remaining = this.getRemainingTime();
        if (remaining > 0) {
          this.config.onWarning!(remaining);
        }
      }, 1000);
    }
  }

  private dismissWarning(): void {
    this.isWarningShown = false;

    if (this.warningIntervalId) {
      clearInterval(this.warningIntervalId);
      this.warningIntervalId = null;
    }

    this.config.onWarningDismissed?.();
  }

  private handleTimeout(): void {
    this.stop();
    this.clearLastActivity();
    this.config.onTimeout();
  }

  private clearLastActivity(): void {
    try {
      localStorage.removeItem(LAST_ACTIVITY_KEY);
    } catch {
      // Ignore storage errors
    }
  }

  private addEventListeners(): void {
    this.config.activityEvents.forEach((event) => {
      document.addEventListener(event, this.boundHandleActivity, { passive: true });
    });

    // Also listen for storage events to sync across tabs
    window.addEventListener("storage", this.handleStorageEvent.bind(this));
  }

  private removeEventListeners(): void {
    this.config.activityEvents.forEach((event) => {
      document.removeEventListener(event, this.boundHandleActivity);
    });
    window.removeEventListener("storage", this.handleStorageEvent.bind(this));
  }

  private handleStorageEvent(event: StorageEvent): void {
    if (event.key === LAST_ACTIVITY_KEY && event.newValue) {
      // Activity in another tab - reset our timers
      this.resetTimers();
      if (this.isWarningShown) {
        this.dismissWarning();
      }
    }
  }
}

// Singleton instance
let sessionTimeoutManager: SessionTimeoutManager | null = null;

/**
 * Initialize session timeout monitoring
 */
export function initSessionTimeout(
  config: Partial<SessionTimeoutConfig> & { onTimeout: TimeoutCallback }
): SessionTimeoutManager {
  if (sessionTimeoutManager) {
    sessionTimeoutManager.stop();
  }
  sessionTimeoutManager = new SessionTimeoutManager(config);
  sessionTimeoutManager.start();
  return sessionTimeoutManager;
}

/**
 * Stop session timeout monitoring
 */
export function stopSessionTimeout(): void {
  sessionTimeoutManager?.stop();
  sessionTimeoutManager = null;
}

/**
 * Extend the current session
 */
export function extendSession(): void {
  sessionTimeoutManager?.extend();
}

/**
 * Get the session timeout manager instance
 */
export function getSessionTimeoutManager(): SessionTimeoutManager | null {
  return sessionTimeoutManager;
}

/**
 * Format remaining time for display
 */
export function formatRemainingTime(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${seconds} seconds`;
}

// ============================================================================
// REACT HOOK
// ============================================================================

import { useState, useEffect, useCallback } from "react";

export interface UseSessionTimeoutOptions {
  timeoutMs?: number;
  warningMs?: number;
  onTimeout: () => void;
}

export interface UseSessionTimeoutReturn {
  isWarningShown: boolean;
  remainingTime: number;
  extendSession: () => void;
}

/**
 * React hook for session timeout
 */
export function useSessionTimeout(
  options: UseSessionTimeoutOptions
): UseSessionTimeoutReturn {
  const [isWarningShown, setIsWarningShown] = useState(false);
  const [remainingTime, setRemainingTime] = useState(options.timeoutMs || 30 * 60 * 1000);

  const extend = useCallback(() => {
    extendSession();
    setIsWarningShown(false);
  }, []);

  useEffect(() => {
    const manager = initSessionTimeout({
      timeoutMs: options.timeoutMs,
      warningMs: options.warningMs,
      onTimeout: options.onTimeout,
      onWarning: (remaining) => {
        setIsWarningShown(true);
        setRemainingTime(remaining);
      },
      onWarningDismissed: () => {
        setIsWarningShown(false);
      },
    });

    return () => {
      manager.stop();
    };
  }, [options.timeoutMs, options.warningMs, options.onTimeout]);

  return {
    isWarningShown,
    remainingTime,
    extendSession: extend,
  };
}

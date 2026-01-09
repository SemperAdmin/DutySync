"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/supabase-auth";
import { useSessionTimeout, formatRemainingTime } from "@/lib/session-timeout";
import Button from "@/components/ui/Button";

/**
 * Session timeout warning component.
 * Shows a warning modal when the user's session is about to expire.
 * Automatically logs out when the timeout is reached.
 */
export default function SessionTimeoutWarning() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [isClient, setIsClient] = useState(false);

  // Only initialize on client
  useEffect(() => {
    setIsClient(true);
  }, []);

  const handleTimeout = () => {
    logout();
    router.push("/login?reason=timeout");
  };

  const { isWarningShown, remainingTime, extendSession } = useSessionTimeout({
    timeoutMs: 30 * 60 * 1000, // 30 minutes
    warningMs: 5 * 60 * 1000,  // Show warning 5 minutes before
    onTimeout: handleTimeout,
  });

  // Don't render anything on server or if user is not logged in
  if (!isClient || !user) {
    return null;
  }

  if (!isWarningShown) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="timeout-title"
      aria-describedby="timeout-description"
    >
      <div className="bg-surface rounded-xl shadow-2xl max-w-md w-full border border-border overflow-hidden animate-slide-in">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-warning"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h3
                id="timeout-title"
                className="text-lg font-semibold text-foreground"
              >
                Session Expiring
              </h3>
              <p
                id="timeout-description"
                className="mt-2 text-sm text-foreground-muted"
              >
                Your session will expire in{" "}
                <span className="font-mono font-semibold text-warning">
                  {formatRemainingTime(remainingTime)}
                </span>{" "}
                due to inactivity. Would you like to stay logged in?
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 bg-surface-alt border-t border-border">
          <Button
            variant="ghost"
            onClick={handleTimeout}
            className="flex-1"
          >
            Log Out
          </Button>
          <Button
            variant="primary"
            onClick={extendSession}
            className="flex-1"
            autoFocus
          >
            Stay Logged In
          </Button>
        </div>
      </div>
    </div>
  );
}

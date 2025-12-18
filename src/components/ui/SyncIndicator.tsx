"use client";

import { useState } from "react";
import { useSync } from "@/hooks/useSync";
import { useSyncStatus } from "@/hooks/useSyncStatus";

interface SyncIndicatorProps {
  showLabel?: boolean;
  className?: string;
}

/**
 * Sync status indicator component
 * Shows sync status and allows manual sync/toggle
 */
export default function SyncIndicator({
  showLabel = true,
  className = "",
}: SyncIndicatorProps) {
  const { status, sync, toggleSync, isSyncing, isEnabled, lastSyncTime } =
    useSync();
  const {
    supabaseConfigured,
    supabaseConnected,
    pendingSyncs,
    errors: supabaseErrors,
    testConnection,
    isLoading: isTestingConnection,
  } = useSyncStatus();
  const [showMenu, setShowMenu] = useState(false);

  const formatLastSync = () => {
    if (!lastSyncTime) return "Never";
    const now = new Date();
    const diff = now.getTime() - lastSyncTime.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);

    if (seconds < 60) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    return lastSyncTime.toLocaleTimeString();
  };

  const handleSync = async () => {
    setShowMenu(false);
    await sync();
  };

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors ${
          isSyncing
            ? "bg-blue-500/20 text-blue-400"
            : isEnabled
            ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
            : "bg-gray-500/20 text-gray-400 hover:bg-gray-500/30"
        }`}
        title={`Sync ${isEnabled ? "enabled" : "disabled"} - Last: ${formatLastSync()}`}
      >
        {/* Sync icon */}
        <svg
          className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        {showLabel && (
          <span className="hidden sm:inline">
            {isSyncing ? "Syncing..." : isEnabled ? "Sync On" : "Sync Off"}
          </span>
        )}
      </button>

      {/* Dropdown menu */}
      {showMenu && (
        <>
          {/* Backdrop to close menu */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowMenu(false)}
          />
          <div className="absolute right-0 top-full mt-1 w-56 bg-surface border border-border rounded-lg shadow-lg z-50">
            <div className="p-3 border-b border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-foreground">
                  Auto Sync
                </span>
                <button
                  onClick={() => toggleSync(!isEnabled)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    isEnabled ? "bg-green-500" : "bg-gray-500"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      isEnabled ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
              <p className="text-xs text-foreground-muted">
                {isEnabled
                  ? "Checking for updates every 30s"
                  : "Auto-sync is disabled"}
              </p>
            </div>

            <div className="p-3 border-b border-border">
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground-muted">Last sync:</span>
                <span className="text-foreground">{formatLastSync()}</span>
              </div>
              {status.lastError && (
                <p className="text-xs text-red-400 mt-1">{status.lastError}</p>
              )}
            </div>

            {/* Supabase Status Section */}
            <div className="p-3 border-b border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-foreground">
                  Database Sync
                </span>
                <span
                  className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded ${
                    !supabaseConfigured
                      ? "bg-gray-500/20 text-gray-400"
                      : supabaseConnected
                      ? "bg-green-500/20 text-green-400"
                      : "bg-red-500/20 text-red-400"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      !supabaseConfigured
                        ? "bg-gray-400"
                        : supabaseConnected
                        ? "bg-green-400"
                        : "bg-red-400"
                    } ${pendingSyncs > 0 ? "animate-pulse" : ""}`}
                  />
                  {!supabaseConfigured
                    ? "Not Configured"
                    : supabaseConnected
                    ? pendingSyncs > 0
                      ? `Syncing (${pendingSyncs})`
                      : "Connected"
                    : "Disconnected"}
                </span>
              </div>
              {!supabaseConfigured && (
                <p className="text-xs text-foreground-muted">
                  Set Supabase env vars for multi-user sync
                </p>
              )}
              {supabaseConfigured && !supabaseConnected && (
                <button
                  onClick={() => testConnection()}
                  disabled={isTestingConnection}
                  className="w-full mt-2 px-2 py-1 text-xs bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded transition-colors disabled:opacity-50"
                >
                  {isTestingConnection ? "Testing..." : "Retry Connection"}
                </button>
              )}
              {supabaseErrors.length > 0 && (
                <p className="text-xs text-red-400 mt-1 truncate">
                  {supabaseErrors[supabaseErrors.length - 1]}
                </p>
              )}
            </div>

            <div className="p-2">
              <button
                onClick={handleSync}
                disabled={isSyncing}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm bg-primary/10 hover:bg-primary/20 text-primary rounded-md transition-colors disabled:opacity-50"
              >
                <svg
                  className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                {isSyncing ? "Syncing..." : "Sync Now"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

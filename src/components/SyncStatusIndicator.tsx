"use client";

import { useSyncStatus } from "@/hooks/useSyncStatus";

interface SyncStatusIndicatorProps {
  showDetails?: boolean;
  className?: string;
}

/**
 * Visual indicator for Supabase sync status
 * Shows connection state and pending syncs
 */
export function SyncStatusIndicator({
  showDetails = false,
  className = "",
}: SyncStatusIndicatorProps) {
  const {
    supabaseConfigured,
    supabaseConnected,
    pendingSyncs,
    lastSyncSuccess,
    errors,
    testConnection,
    isLoading,
  } = useSyncStatus();

  // Determine status color
  const getStatusColor = () => {
    if (!supabaseConfigured) return "bg-gray-400";
    if (!supabaseConnected) return "bg-red-500";
    if (pendingSyncs > 0) return "bg-yellow-500";
    return "bg-green-500";
  };

  // Determine status text
  const getStatusText = () => {
    if (!supabaseConfigured) return "Offline Mode";
    if (!supabaseConnected) return "Disconnected";
    if (pendingSyncs > 0) return `Syncing (${pendingSyncs})`;
    return "Connected";
  };

  // Format last sync time
  const formatLastSync = () => {
    if (!lastSyncSuccess) return "Never";
    const diffMs = Date.now() - lastSyncSuccess.getTime();
    const minutesAgo = Math.floor(diffMs / 60000);

    if (minutesAgo < 1) return "Just now";
    if (minutesAgo < 60) return `${minutesAgo}m ago`;
    return lastSyncSuccess.toLocaleTimeString();
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Status dot */}
      <div
        className={`w-2 h-2 rounded-full ${getStatusColor()} ${
          pendingSyncs > 0 ? "animate-pulse" : ""
        }`}
        title={getStatusText()}
      />

      {showDetails && (
        <div className="text-xs text-gray-500">
          <span className="font-medium">{getStatusText()}</span>
          {supabaseConnected && lastSyncSuccess && (
            <span className="ml-2">Last sync: {formatLastSync()}</span>
          )}
          {errors.length > 0 && (
            <span className="ml-2 text-red-500">
              ({errors.length} error{errors.length !== 1 ? "s" : ""})
            </span>
          )}
        </div>
      )}

      {/* Test connection button (only shown when disconnected and showDetails) */}
      {showDetails && !supabaseConnected && supabaseConfigured && (
        <button
          onClick={() => testConnection()}
          disabled={isLoading}
          className="text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {isLoading ? "Testing..." : "Retry"}
        </button>
      )}
    </div>
  );
}

/**
 * Minimal sync indicator - just the dot
 */
export function SyncDot({ className = "" }: { className?: string }) {
  return <SyncStatusIndicator className={className} showDetails={false} />;
}

/**
 * Full sync status panel for admin/settings
 */
export function SyncStatusPanel() {
  const {
    supabaseConfigured,
    supabaseConnected,
    pendingSyncs,
    lastSyncSuccess,
    lastSyncAttempt,
    errors,
    testConnection,
    isLoading,
  } = useSyncStatus();

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
      <h3 className="text-lg font-semibold mb-4">Sync Status</h3>

      <div className="space-y-3">
        {/* Connection Status */}
        <div className="flex items-center justify-between">
          <span className="text-gray-600 dark:text-gray-300">Supabase</span>
          <span
            className={`px-2 py-1 rounded text-sm ${
              !supabaseConfigured
                ? "bg-gray-200 text-gray-600"
                : supabaseConnected
                ? "bg-green-100 text-green-800"
                : "bg-red-100 text-red-800"
            }`}
          >
            {!supabaseConfigured
              ? "Not Configured"
              : supabaseConnected
              ? "Connected"
              : "Disconnected"}
          </span>
        </div>

        {/* Pending Syncs */}
        <div className="flex items-center justify-between">
          <span className="text-gray-600 dark:text-gray-300">Pending Syncs</span>
          <span className="text-gray-900 dark:text-gray-100">{pendingSyncs}</span>
        </div>

        {/* Last Sync */}
        <div className="flex items-center justify-between">
          <span className="text-gray-600 dark:text-gray-300">Last Successful Sync</span>
          <span className="text-gray-900 dark:text-gray-100">
            {lastSyncSuccess ? lastSyncSuccess.toLocaleString() : "Never"}
          </span>
        </div>

        {/* Last Attempt */}
        <div className="flex items-center justify-between">
          <span className="text-gray-600 dark:text-gray-300">Last Attempt</span>
          <span className="text-gray-900 dark:text-gray-100">
            {lastSyncAttempt ? lastSyncAttempt.toLocaleString() : "Never"}
          </span>
        </div>

        {/* Errors */}
        {errors.length > 0 && (
          <div className="mt-4">
            <span className="text-red-600 font-medium">
              Recent Errors ({errors.length})
            </span>
            <ul className="mt-2 text-sm text-red-500 list-disc list-inside">
              {errors.slice(-5).map((error, i) => (
                <li key={`${error}-${i}`} className="truncate">
                  {error}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Test Connection Button */}
        {supabaseConfigured && (
          <button
            onClick={() => testConnection()}
            disabled={isLoading}
            className="w-full mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {isLoading ? "Testing Connection..." : "Test Connection"}
          </button>
        )}

        {/* Not Configured Warning */}
        {!supabaseConfigured && (
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
            <p className="text-sm text-yellow-800">
              Supabase is not configured. Data will only sync to GitHub/localStorage.
            </p>
            <p className="text-xs text-yellow-600 mt-1">
              Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable
              real-time multi-user sync.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

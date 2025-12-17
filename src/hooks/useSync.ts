"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  getSyncStatus,
  forceSync,
  setSyncEnabled,
  onDataChanged,
  onSyncStatusChanged,
  type SyncStatus,
  type SyncDataType,
  type SyncResult,
} from "@/lib/sync-service";

/**
 * Hook for managing sync state and triggering refreshes
 */
export function useSync() {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus);
  const [lastUpdatedTypes, setLastUpdatedTypes] = useState<SyncDataType[]>([]);

  // Listen for sync status changes
  useEffect(() => {
    const cleanup = onSyncStatusChanged((newStatus) => {
      setStatus(newStatus);
    });
    return cleanup;
  }, []);

  // Listen for data changes
  useEffect(() => {
    const cleanup = onDataChanged((dataTypes) => {
      setLastUpdatedTypes(dataTypes);
    });
    return cleanup;
  }, []);

  // Force a manual sync
  const sync = useCallback(async (): Promise<SyncResult> => {
    return forceSync();
  }, []);

  // Toggle sync enabled/disabled
  const toggleSync = useCallback((enabled: boolean) => {
    setSyncEnabled(enabled);
    setStatus(getSyncStatus());
  }, []);

  return {
    status,
    lastUpdatedTypes,
    sync,
    toggleSync,
    isSyncing: status.isSyncing,
    isEnabled: status.enabled,
    lastSyncTime: status.lastSyncTime,
    lastError: status.lastError,
  };
}

/**
 * Hook for auto-refreshing data when sync detects changes
 * @param dataTypes - Array of data types to watch for changes
 * @param onRefresh - Callback to execute when watched data changes
 */
export function useSyncRefresh(
  dataTypes: SyncDataType[],
  onRefresh: () => void
) {
  // Use refs to store the latest values without causing re-subscriptions
  const dataTypesRef = useRef<SyncDataType[]>(dataTypes);
  const onRefreshRef = useRef<() => void>(onRefresh);

  // Update refs when values change
  useEffect(() => {
    dataTypesRef.current = dataTypes;
  }, [dataTypes]);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  // Subscribe once and use refs for the latest values
  useEffect(() => {
    const cleanup = onDataChanged((updatedTypes) => {
      // Check if any of the updated types match what we're watching
      const shouldRefresh = dataTypesRef.current.some((type) =>
        updatedTypes.includes(type)
      );
      if (shouldRefresh) {
        onRefreshRef.current();
      }
    });
    return cleanup;
  }, []); // Empty deps - subscribe only once
}

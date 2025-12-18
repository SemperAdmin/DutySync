"use client";

import { useState, useEffect } from "react";
import {
  getSyncStatus,
  onSyncStatusChange,
  testSupabaseConnection,
  initSyncStatus,
  type SyncStatus,
} from "@/lib/sync-status";

/**
 * Hook to get current sync status and subscribe to changes
 */
export function useSyncStatus(): SyncStatus & {
  testConnection: () => Promise<{ success: boolean; message: string }>;
  isLoading: boolean;
} {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus());
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Initialize on first mount
    initSyncStatus();

    // Subscribe to status changes
    const unsubscribe = onSyncStatusChange(setStatus);
    return unsubscribe;
  }, []);

  const testConnection = async () => {
    setIsLoading(true);
    try {
      const result = await testSupabaseConnection();
      return result;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    ...status,
    testConnection,
    isLoading,
  };
}

/**
 * Hook to check if Supabase sync is available
 * Returns true only if Supabase is configured AND connected
 */
export function useSupabaseAvailable(): boolean {
  const { supabaseConfigured, supabaseConnected } = useSyncStatus();
  return supabaseConfigured && supabaseConnected;
}

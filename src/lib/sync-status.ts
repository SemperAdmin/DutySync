"use client";

import { isSupabaseConfigured, getSupabase } from "./supabase";

export interface SyncStatus {
  supabaseConfigured: boolean;
  supabaseConnected: boolean;
  lastSyncAttempt: Date | null;
  lastSyncSuccess: Date | null;
  pendingSyncs: number;
  errors: string[];
}

// Global sync status tracking
let syncStatus: SyncStatus = {
  supabaseConfigured: false,
  supabaseConnected: false,
  lastSyncAttempt: null,
  lastSyncSuccess: null,
  pendingSyncs: 0,
  errors: [],
};

// Listeners for status changes
const statusListeners: Set<(status: SyncStatus) => void> = new Set();

// Notify listeners of status change
function notifyListeners(): void {
  for (const listener of statusListeners) {
    listener({ ...syncStatus });
  }
}

// Subscribe to status changes
export function onSyncStatusChange(callback: (status: SyncStatus) => void): () => void {
  statusListeners.add(callback);
  // Immediately call with current status
  callback({ ...syncStatus });
  return () => statusListeners.delete(callback);
}

// Get current sync status
export function getSyncStatus(): SyncStatus {
  return { ...syncStatus };
}

// Update sync status
export function updateSyncStatus(updates: Partial<SyncStatus>): void {
  syncStatus = { ...syncStatus, ...updates };
  notifyListeners();
}

// Record a sync attempt
export function recordSyncAttempt(): void {
  syncStatus.lastSyncAttempt = new Date();
  syncStatus.pendingSyncs++;
  notifyListeners();
}

// Record a successful sync
export function recordSyncSuccess(): void {
  syncStatus.lastSyncSuccess = new Date();
  syncStatus.pendingSyncs = Math.max(0, syncStatus.pendingSyncs - 1);
  notifyListeners();
}

// Record a sync error
export function recordSyncError(error: string): void {
  syncStatus.pendingSyncs = Math.max(0, syncStatus.pendingSyncs - 1);
  syncStatus.errors = [...syncStatus.errors.slice(-9), error]; // Keep last 10 errors
  notifyListeners();
}

// Clear errors
export function clearSyncErrors(): void {
  syncStatus.errors = [];
  notifyListeners();
}

// Test Supabase connection
export async function testSupabaseConnection(): Promise<{
  success: boolean;
  message: string;
  latencyMs?: number;
}> {
  syncStatus.supabaseConfigured = isSupabaseConfigured();

  if (!syncStatus.supabaseConfigured) {
    syncStatus.supabaseConnected = false;
    notifyListeners();
    return {
      success: false,
      message: "Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    };
  }

  try {
    const supabase = getSupabase();
    const startTime = Date.now();

    // Simple query to test connection
    const { error } = await supabase.from("organizations").select("id").limit(1);

    const latencyMs = Date.now() - startTime;

    if (error) {
      syncStatus.supabaseConnected = false;
      notifyListeners();
      return {
        success: false,
        message: `Supabase query failed: ${error.message}`,
        latencyMs,
      };
    }

    syncStatus.supabaseConnected = true;
    notifyListeners();
    return {
      success: true,
      message: `Connected to Supabase (${latencyMs}ms latency)`,
      latencyMs,
    };
  } catch (err) {
    syncStatus.supabaseConnected = false;
    notifyListeners();
    return {
      success: false,
      message: `Connection error: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

// Initialize sync status on load
export function initSyncStatus(): void {
  syncStatus.supabaseConfigured = isSupabaseConfigured();
  if (syncStatus.supabaseConfigured) {
    // Test connection in background
    testSupabaseConnection().then((result) => {
      console.log("[Sync Status]", result.message);
    });
  } else {
    console.warn("[Sync Status] Supabase not configured - data will only sync to GitHub/localStorage");
  }
}

// Log sync operation (for debugging)
export function logSyncOperation(
  operation: string,
  entity: string,
  success: boolean,
  details?: string
): void {
  const timestamp = new Date().toISOString();
  const status = success ? "SUCCESS" : "FAILED";
  const message = `[Supabase Sync] ${timestamp} - ${operation} ${entity}: ${status}${details ? ` - ${details}` : ""}`;

  if (success) {
    console.log(message);
  } else {
    console.error(message);
  }
}

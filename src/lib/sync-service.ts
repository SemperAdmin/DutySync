"use client";

/**
 * Sync Service - Handles polling for data updates from GitHub/server
 * and notifies components when data changes
 */

import { getGitHubSettings } from "./github-api";

// Sync configuration
const DEFAULT_SYNC_INTERVAL = 30000; // 30 seconds
const SYNC_STATUS_KEY = "dutysync_last_sync";
const SYNC_ENABLED_KEY = "dutysync_sync_enabled";

// Custom event names for data changes
export const SYNC_EVENTS = {
  DATA_CHANGED: "dutysync:data-changed",
  SYNC_STARTED: "dutysync:sync-started",
  SYNC_COMPLETED: "dutysync:sync-completed",
  SYNC_ERROR: "dutysync:sync-error",
} as const;

// Data types that can be synced
export type SyncDataType =
  | "units"
  | "personnel"
  | "dutyTypes"
  | "dutySlots"
  | "nonAvailability"
  | "qualifications"
  | "users";

export interface SyncStatus {
  lastSyncTime: Date | null;
  isSyncing: boolean;
  lastError: string | null;
  enabled: boolean;
}

export interface SyncResult {
  success: boolean;
  dataTypesUpdated: SyncDataType[];
  errors: string[];
}

// LocalStorage keys (must match client-stores.ts)
const KEYS = {
  units: "dutysync_units",
  personnel: "dutysync_personnel",
  dutyTypes: "dutysync_duty_types",
  dutyValues: "dutysync_duty_values",
  dutyRequirements: "dutysync_duty_requirements",
  dutySlots: "dutysync_duty_slots",
  nonAvailability: "dutysync_non_availability",
  qualifications: "dutysync_qualifications",
  users: "dutysync_users",
};

// Get base path for fetching data files
function getBasePath(): string {
  return process.env.NODE_ENV === "production" ? "/DutySync" : "";
}

// Sync service state
let syncInterval: NodeJS.Timeout | null = null;
let isSyncing = false;
let lastSyncTime: Date | null = null;
let lastError: string | null = null;

/**
 * Dispatch a custom event for sync status changes
 */
function dispatchSyncEvent(
  eventName: string,
  detail?: Record<string, unknown>
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
}

/**
 * Get the list of available RUCs from the units index
 */
async function getAvailableRucs(): Promise<string[]> {
  try {
    const response = await fetch(`${getBasePath()}/data/units-index.json`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.units?.map((u: { ruc: string }) => u.ruc) || [];
  } catch {
    return [];
  }
}

/**
 * Fetch data from a JSON file with cache busting
 */
async function fetchJsonWithCacheBust(url: string): Promise<unknown | null> {
  try {
    const cacheBuster = `?t=${Date.now()}`;
    const response = await fetch(`${url}${cacheBuster}`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Compare two arrays by converting to JSON strings
 * Returns true if they are different
 */
function hasDataChanged(localData: unknown[], remoteData: unknown[]): boolean {
  // Simple length check first
  if (localData.length !== remoteData.length) return true;

  // Compare stringified versions (handles deep comparison)
  // Use slice() to avoid mutating original arrays
  const localStr = JSON.stringify([...localData].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b))
  ));
  const remoteStr = JSON.stringify([...remoteData].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b))
  ));

  return localStr !== remoteStr;
}

/**
 * Merge arrays by ID - remote data takes precedence
 * Removes items from local that exist in remote (by ID), then adds all remote items
 */
function mergeById<T extends { id: string }>(
  localData: T[],
  remoteData: T[],
  filterFn?: (item: T) => boolean
): T[] {
  // Deduplicate remote data to prevent introducing duplicates, keeping the last one.
  const remoteDataMap = new Map(remoteData.map(item => [item.id, item]));
  const uniqueRemoteData = Array.from(remoteDataMap.values());
  const remoteIds = new Set(remoteDataMap.keys());

  // Keep local items that:
  // 1. Don't exist in remote data (by ID)
  // 2. Don't match the filter (if provided) - these are from other RUCs
  const filteredLocal = localData.filter((item) => {
    // If item exists in remote, remove it (will be replaced)
    if (remoteIds.has(item.id)) return false;
    // If filter provided and item matches, remove it (it's from this RUC but not in remote)
    if (filterFn && filterFn(item)) return false;
    // Keep item (it's from another RUC)
    return true;
  });

  return [...filteredLocal, ...uniqueRemoteData];
}

/**
 * Get data from localStorage
 */
function getLocalData<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * Save data to localStorage
 */
function saveLocalData<T>(key: string, data: T[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(data));
}

/**
 * Sync unit structure data (units)
 */
async function syncUnitStructure(ruc: string): Promise<boolean> {
  const data = await fetchJsonWithCacheBust(
    `${getBasePath()}/data/unit/${ruc}/unit-structure.json`
  );
  if (!data || !(data as { units?: unknown[] }).units) return false;

  const remoteUnits = (data as { units: { id: string; ruc?: string }[] }).units;
  const localUnits = getLocalData<{ id: string; ruc?: string }>(KEYS.units);

  // Filter to only compare units from this RUC
  const localRucUnits = localUnits.filter((u) => u.ruc === ruc);

  if (hasDataChanged(localRucUnits, remoteUnits as unknown[])) {
    // Merge by ID: remote data for this RUC replaces local
    const merged = mergeById(localUnits, remoteUnits, (u) => u.ruc === ruc);
    saveLocalData(KEYS.units, merged);
    return true;
  }
  return false;
}

/**
 * Sync unit members data (personnel)
 */
async function syncUnitMembers(ruc: string): Promise<boolean> {
  const data = await fetchJsonWithCacheBust(
    `${getBasePath()}/data/unit/${ruc}/unit-members.json`
  );
  if (!data || !(data as { personnel?: unknown[] }).personnel) return false;

  const remotePersonnel = (data as { personnel: { id: string; unit_section_id?: string }[] }).personnel;
  const localPersonnel = getLocalData<{ id: string; unit_section_id?: string }>(KEYS.personnel);

  // Get unit IDs for this RUC to filter personnel
  const localUnits = getLocalData<{ id: string; ruc?: string }>(KEYS.units);
  const rucUnitIds = new Set(
    localUnits.filter((u) => u.ruc === ruc).map((u) => u.id)
  );

  // Filter to only compare personnel from this RUC's units
  const localRucPersonnel = localPersonnel.filter(
    (p) => p.unit_section_id && rucUnitIds.has(p.unit_section_id)
  );

  if (hasDataChanged(localRucPersonnel, remotePersonnel as unknown[])) {
    // Merge by ID: remote data for this RUC replaces local
    const merged = mergeById(
      localPersonnel,
      remotePersonnel,
      (p) => p.unit_section_id != null && rucUnitIds.has(p.unit_section_id)
    );
    saveLocalData(KEYS.personnel, merged);
    return true;
  }
  return false;
}

/**
 * Sync duty types data
 */
async function syncDutyTypes(ruc: string): Promise<boolean> {
  const data = await fetchJsonWithCacheBust(
    `${getBasePath()}/data/unit/${ruc}/duty-types.json`
  );
  if (!data) return false;

  const typesData = data as {
    dutyTypes?: unknown[];
    dutyValues?: unknown[];
    dutyRequirements?: unknown[];
  };

  let changed = false;

  // Sync duty types
  if (typesData.dutyTypes) {
    const localDutyTypes = getLocalData(KEYS.dutyTypes);
    if (hasDataChanged(localDutyTypes, typesData.dutyTypes)) {
      // For now, replace all duty types (could be smarter with RUC filtering)
      saveLocalData(KEYS.dutyTypes, typesData.dutyTypes);
      changed = true;
    }
  }

  // Sync duty values
  if (typesData.dutyValues) {
    const localDutyValues = getLocalData(KEYS.dutyValues);
    if (hasDataChanged(localDutyValues, typesData.dutyValues)) {
      saveLocalData(KEYS.dutyValues, typesData.dutyValues);
      changed = true;
    }
  }

  // Sync duty requirements
  if (typesData.dutyRequirements) {
    const localDutyRequirements = getLocalData(KEYS.dutyRequirements);
    if (hasDataChanged(localDutyRequirements, typesData.dutyRequirements)) {
      saveLocalData(KEYS.dutyRequirements, typesData.dutyRequirements);
      changed = true;
    }
  }

  return changed;
}

/**
 * Sync duty roster (slots)
 */
async function syncDutyRoster(ruc: string): Promise<boolean> {
  const data = await fetchJsonWithCacheBust(
    `${getBasePath()}/data/unit/${ruc}/duty-roster.json`
  );
  if (!data || !(data as { dutySlots?: unknown[] }).dutySlots) return false;

  const remoteSlots = (data as { dutySlots: unknown[] }).dutySlots;
  const localSlots = getLocalData(KEYS.dutySlots);

  if (hasDataChanged(localSlots, remoteSlots as unknown[])) {
    saveLocalData(KEYS.dutySlots, remoteSlots);
    return true;
  }
  return false;
}

/**
 * Sync non-availability data
 */
async function syncNonAvailability(ruc: string): Promise<boolean> {
  const data = await fetchJsonWithCacheBust(
    `${getBasePath()}/data/unit/${ruc}/non-availability.json`
  );
  if (!data || !(data as { nonAvailability?: unknown[] }).nonAvailability)
    return false;

  const remoteNA = (data as { nonAvailability: unknown[] }).nonAvailability;
  const localNA = getLocalData(KEYS.nonAvailability);

  if (hasDataChanged(localNA, remoteNA as unknown[])) {
    saveLocalData(KEYS.nonAvailability, remoteNA);
    return true;
  }
  return false;
}

/**
 * Sync qualifications data
 */
async function syncQualifications(ruc: string): Promise<boolean> {
  const data = await fetchJsonWithCacheBust(
    `${getBasePath()}/data/unit/${ruc}/qualifications.json`
  );
  if (!data || !(data as { qualifications?: unknown[] }).qualifications)
    return false;

  const remoteQuals = (data as { qualifications: unknown[] }).qualifications;
  const localQuals = getLocalData(KEYS.qualifications);

  if (hasDataChanged(localQuals, remoteQuals as unknown[])) {
    saveLocalData(KEYS.qualifications, remoteQuals);
    return true;
  }
  return false;
}

/**
 * Perform a full sync of all data
 */
export async function performSync(): Promise<SyncResult> {
  if (isSyncing) {
    return { success: false, dataTypesUpdated: [], errors: ["Sync already in progress"] };
  }

  isSyncing = true;
  lastError = null;
  dispatchSyncEvent(SYNC_EVENTS.SYNC_STARTED);

  const dataTypesUpdated: SyncDataType[] = [];
  const errors: string[] = [];

  try {
    // Get available RUCs
    const rucs = await getAvailableRucs();
    if (rucs.length === 0) {
      errors.push("No RUCs found");
    }

    // Sync each RUC's data
    for (const ruc of rucs) {
      try {
        // Sync unit structure
        if (await syncUnitStructure(ruc)) {
          if (!dataTypesUpdated.includes("units")) dataTypesUpdated.push("units");
        }

        // Sync unit members
        if (await syncUnitMembers(ruc)) {
          if (!dataTypesUpdated.includes("personnel")) dataTypesUpdated.push("personnel");
        }

        // Sync duty types
        if (await syncDutyTypes(ruc)) {
          if (!dataTypesUpdated.includes("dutyTypes")) dataTypesUpdated.push("dutyTypes");
        }

        // Sync duty roster
        if (await syncDutyRoster(ruc)) {
          if (!dataTypesUpdated.includes("dutySlots")) dataTypesUpdated.push("dutySlots");
        }

        // Sync non-availability
        if (await syncNonAvailability(ruc)) {
          if (!dataTypesUpdated.includes("nonAvailability")) dataTypesUpdated.push("nonAvailability");
        }

        // Sync qualifications
        if (await syncQualifications(ruc)) {
          if (!dataTypesUpdated.includes("qualifications")) dataTypesUpdated.push("qualifications");
        }
      } catch (err) {
        errors.push(`Failed to sync RUC ${ruc}: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }

    lastSyncTime = new Date();
    saveSyncStatus();

    // Dispatch data changed event if any data was updated
    if (dataTypesUpdated.length > 0) {
      dispatchSyncEvent(SYNC_EVENTS.DATA_CHANGED, { dataTypesUpdated });
    }

    dispatchSyncEvent(SYNC_EVENTS.SYNC_COMPLETED, {
      dataTypesUpdated,
      errors,
      lastSyncTime,
    });

    return {
      success: errors.length === 0,
      dataTypesUpdated,
      errors,
    };
  } catch (err) {
    lastError = err instanceof Error ? err.message : "Unknown sync error";
    errors.push(lastError);
    dispatchSyncEvent(SYNC_EVENTS.SYNC_ERROR, { error: lastError });
    return { success: false, dataTypesUpdated, errors };
  } finally {
    isSyncing = false;
  }
}

/**
 * Save sync status to localStorage
 */
function saveSyncStatus(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    SYNC_STATUS_KEY,
    JSON.stringify({
      lastSyncTime: lastSyncTime?.toISOString() || null,
    })
  );
}

/**
 * Load sync status from localStorage
 */
function loadSyncStatus(): void {
  if (typeof window === "undefined") return;
  try {
    const data = localStorage.getItem(SYNC_STATUS_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      lastSyncTime = parsed.lastSyncTime ? new Date(parsed.lastSyncTime) : null;
    }
  } catch {
    // Ignore parse errors
  }
}

/**
 * Get current sync status
 */
export function getSyncStatus(): SyncStatus {
  return {
    lastSyncTime,
    isSyncing,
    lastError,
    enabled: isSyncEnabled(),
  };
}

/**
 * Check if sync is enabled
 */
export function isSyncEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(SYNC_ENABLED_KEY) !== "false";
}

/**
 * Enable or disable sync
 */
export function setSyncEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SYNC_ENABLED_KEY, enabled ? "true" : "false");
  if (enabled) {
    startSyncPolling();
  } else {
    stopSyncPolling();
  }
}

/**
 * Start polling for sync
 */
export function startSyncPolling(intervalMs: number = DEFAULT_SYNC_INTERVAL): void {
  if (typeof window === "undefined") return;
  if (!isSyncEnabled()) return;

  // Load previous sync status
  loadSyncStatus();

  // Stop existing interval if any
  stopSyncPolling();

  // Perform initial sync after a short delay
  setTimeout(() => {
    performSync();
  }, 2000);

  // Start polling interval
  syncInterval = setInterval(() => {
    if (isSyncEnabled()) {
      performSync();
    }
  }, intervalMs);

  console.log(`[SyncService] Started polling every ${intervalMs / 1000}s`);
}

/**
 * Stop polling for sync
 */
export function stopSyncPolling(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log("[SyncService] Stopped polling");
  }
}

/**
 * Force a manual sync
 */
export async function forceSync(): Promise<SyncResult> {
  return performSync();
}

/**
 * Hook to listen for data changes
 * Returns a cleanup function
 */
export function onDataChanged(
  callback: (dataTypes: SyncDataType[]) => void
): () => void {
  if (typeof window === "undefined") return () => {};

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<{ dataTypesUpdated: SyncDataType[] }>;
    callback(customEvent.detail?.dataTypesUpdated || []);
  };

  window.addEventListener(SYNC_EVENTS.DATA_CHANGED, handler);
  return () => window.removeEventListener(SYNC_EVENTS.DATA_CHANGED, handler);
}

/**
 * Hook to listen for sync status changes
 */
export function onSyncStatusChanged(
  callback: (status: SyncStatus) => void
): () => void {
  if (typeof window === "undefined") return () => {};

  const handleStarted = () => callback(getSyncStatus());
  const handleCompleted = () => callback(getSyncStatus());
  const handleError = () => callback(getSyncStatus());

  window.addEventListener(SYNC_EVENTS.SYNC_STARTED, handleStarted);
  window.addEventListener(SYNC_EVENTS.SYNC_COMPLETED, handleCompleted);
  window.addEventListener(SYNC_EVENTS.SYNC_ERROR, handleError);

  return () => {
    window.removeEventListener(SYNC_EVENTS.SYNC_STARTED, handleStarted);
    window.removeEventListener(SYNC_EVENTS.SYNC_COMPLETED, handleCompleted);
    window.removeEventListener(SYNC_EVENTS.SYNC_ERROR, handleError);
  };
}

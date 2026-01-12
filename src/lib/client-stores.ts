"use client";

import type {
  UnitSection,
  Personnel,
  DutyType,
  DutyValue,
  DutyRequirement,
  DutySlot,
  NonAvailability,
  Qualification,
  BlockedDuty,
  DutyChangeRequest,
  DutyScoreEvent,
  SwapApproval,
  SwapRecommendation,
  SwapPair,
  DutyChangeRequestWithApprovals,
  SupernumeraryAssignment,
} from "@/types";
import { getLevelOrder } from "@/lib/unit-constants";
import { DEFAULT_WEEKEND_MULTIPLIER, DEFAULT_HOLIDAY_MULTIPLIER } from "@/lib/constants";
import {
  isHolidayStr,
  isWeekendStr,
  formatDateToString,
  parseLocalDate,
  isDateInRange,
  getTodayString,
  addDaysToDateString,
  isValidDateString,
} from "@/lib/date-utils";
import type { DateString } from "@/types";
import { getCurrentRuc } from "@/lib/auto-save";

// Import Supabase sync functions (aliased to avoid name collision)
import {
  createDutyType as supabaseCreateDutyType,
  updateDutyType as supabaseUpdateDutyType,
  deleteDutyType as supabaseDeleteDutyType,
  createDutySlot as supabaseCreateDutySlot,
  createDutySlots as supabaseCreateDutySlots,
  updateDutySlot as supabaseUpdateDutySlot,
  deleteDutySlot as supabaseDeleteDutySlot,
  deleteDutySlotsInRange as supabaseDeleteDutySlotsInRange,
  createDutyScoreEvents as supabaseCreateDutyScoreEvents,
  updatePersonnel as supabaseUpdatePersonnel,
  updatePersonnelByServiceId as supabaseUpdatePersonnelByServiceId,
  // Duty values
  createDutyValue as supabaseCreateDutyValue,
  updateDutyValue as supabaseUpdateDutyValue,
  deleteDutyValue as supabaseDeleteDutyValue,
  // Duty requirements
  createDutyRequirement as supabaseCreateDutyRequirement,
  deleteDutyRequirementsByDutyType as supabaseDeleteDutyRequirementsByDutyType,
  // Non-availability
  createNonAvailability as supabaseCreateNonAvailability,
  updateNonAvailability as supabaseUpdateNonAvailability,
  deleteNonAvailability as supabaseDeleteNonAvailability,
  // Duty change requests
  createDutyChangeRequest as supabaseCreateDutyChangeRequest,
  updateDutyChangeRequest as supabaseUpdateDutyChangeRequest,
  deleteDutyChangeRequest as supabaseDeleteDutyChangeRequest,
  deleteDutyChangeRequestsBySwapPairId as supabaseDeleteDutyChangeRequestsBySwapPairId,
  // Swap approvals
  createSwapApprovals as supabaseCreateSwapApprovals,
  updateSwapApproval as supabaseUpdateSwapApproval,
  deleteSwapApprovalsByRequestId as supabaseDeleteSwapApprovalsByRequestId,
  // Swap recommendations
  createSwapRecommendation as supabaseCreateSwapRecommendation,
  deleteSwapRecommendationsByRequestId as supabaseDeleteSwapRecommendationsByRequestId,
  // Migration functions (use ID mapping by unique fields)
  createDutySlotsWithMapping as supabaseCreateDutySlotsWithMapping,
  createDutySlotWithMapping as supabaseCreateDutySlotWithMapping,
  deleteDutySlotWithMapping as supabaseDeleteDutySlotWithMapping,
  deleteDutySlotsByDutyTypeWithMapping as supabaseDeleteDutySlotsByDutyTypeWithMapping,
  createDutyScoreEventsWithMapping as supabaseCreateDutyScoreEventsWithMapping,
  updateDutySlotsStatusWithMapping as supabaseUpdateDutySlotsStatusWithMapping,
  // Supernumerary assignments
  createSupernumeraryAssignment as supabaseCreateSupernumeraryAssignment,
  updateSupernumeraryAssignment as supabaseUpdateSupernumeraryAssignment,
  deleteSupernumeraryAssignment as supabaseDeleteSupernumeraryAssignment,
  deleteSupernumeraryAssignmentsByDutyType as supabaseDeleteSupernumeraryAssignmentsByDutyType,
  incrementSupernumeraryActivation as supabaseIncrementSupernumeraryActivation,
} from "@/lib/supabase-data";

// Import sync status tracking
import {
  recordSyncAttempt,
  recordSyncSuccess,
  recordSyncError,
  logSyncOperation,
} from "@/lib/sync-status";

// Import sync service for data change notifications
import { notifyDataChanged } from "@/lib/sync-service";

import { isSupabaseConfigured } from "@/lib/supabase";

// UUID validation helper - checks if a string is a valid UUID format
function isValidUUID(str: string | null | undefined): boolean {
  if (!str) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// Auto-save notification function (lazy import to avoid circular dependency)
let notifyAutoSave: ((dataType: string) => void) | null = null;

export function setAutoSaveNotifier(notifier: (dataType: string) => void): void {
  notifyAutoSave = notifier;
}

function triggerAutoSave(dataType: string): void {
  // Skip auto-save to JSON/GitHub when Supabase is configured
  // Supabase is the primary data store, no need for JSON backup
  if (isSupabaseConfigured()) {
    return;
  }
  if (notifyAutoSave) {
    notifyAutoSave(dataType);
  }
}

// ============ Supabase Sync Helpers ============
// Cached default organization_id (set when user has Supabase configured)
let cachedOrganizationId: string | null = null;

// Set the default organization ID (call this after loading data from Supabase)
export function setDefaultOrganizationId(orgId: string | null): void {
  if (process.env.NODE_ENV === "development") {
    console.log("[Supabase Sync] Setting default organization ID:", orgId);
  }
  cachedOrganizationId = orgId;
  try {
    if (orgId) {
      // Also store in localStorage for persistence across sessions
      localStorage.setItem("dutysync_default_org_id", orgId);
    } else {
      localStorage.removeItem("dutysync_default_org_id");
    }
  } catch {
    // Ignore storage errors
  }
}

// Get the default organization ID
export function getDefaultOrganizationId(): string | null {
  if (cachedOrganizationId) return cachedOrganizationId;
  // Try to load from localStorage
  try {
    cachedOrganizationId = localStorage.getItem("dutysync_default_org_id");
  } catch {
    // Ignore storage errors
  }
  return cachedOrganizationId;
}

// Get organization_id from a unit (needed for Supabase writes)
// Walks up the hierarchy if the unit doesn't have org_id directly
function getOrganizationIdFromUnit(unitId: string): string | null {
  const units = getFromStorage<UnitSection & { organization_id?: string }>(KEYS.units);
  const unitById = new Map(units.map(u => [u.id, u]));

  // Start with the given unit and walk up the hierarchy
  let currentId: string | null = unitId;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const unit = unitById.get(currentId);
    if (!unit) break;

    if (unit.organization_id) {
      return unit.organization_id;
    }
    currentId = unit.parent_id;
  }

  // Fall back to cached/stored default organization
  const defaultOrgId = getDefaultOrganizationId();
  if (!defaultOrgId) {
    console.warn(
      `[Supabase Sync] No organization_id found for unit. Sync operations will be skipped. Load data from Supabase first or set a default organization.`
    );
  }
  return defaultOrgId;
}

// Sync configuration
const SYNC_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000, // 1 second base delay
  maxDelayMs: 8000,  // Max 8 seconds delay
};

// Helper to delay with exponential backoff
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Calculate exponential backoff delay
function getBackoffDelay(attempt: number): number {
  const delayMs = SYNC_CONFIG.baseDelayMs * Math.pow(2, attempt);
  return Math.min(delayMs, SYNC_CONFIG.maxDelayMs);
}

// Async sync to Supabase with retry mechanism and status tracking
async function syncToSupabaseWithRetry(
  operation: () => Promise<unknown>,
  context: string,
  maxRetries: number = SYNC_CONFIG.maxRetries
): Promise<boolean> {
  recordSyncAttempt();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();
      recordSyncSuccess();
      if (process.env.NODE_ENV === "development") {
        console.log(`[Supabase Sync] ${context}: Success${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}`, result);
      }
      logSyncOperation("SYNC", context, true, result ? "OK" : "No result");
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const isLastAttempt = attempt === maxRetries;

      if (isLastAttempt) {
        console.error(`[Supabase Sync] ${context}: FAILED after ${maxRetries + 1} attempts`, errorMessage);
        recordSyncError(`${context}: ${errorMessage}`);
        logSyncOperation("SYNC", context, false, `${errorMessage} (after ${maxRetries + 1} attempts)`);
        return false;
      } else {
        const backoffDelay = getBackoffDelay(attempt);
        console.warn(`[Supabase Sync] ${context}: Attempt ${attempt + 1} failed, retrying in ${backoffDelay}ms...`, errorMessage);
        await delay(backoffDelay);
      }
    }
  }
  return false;
}

// Fire-and-forget wrapper that uses retry mechanism (backward compatible)
function syncToSupabase(operation: () => Promise<unknown>, context: string): void {
  syncToSupabaseWithRetry(operation, context).catch(() => {
    // Error already logged in syncToSupabaseWithRetry
  });
}

// ============ Base Path Helper ============
// Get the base path for fetching data files in production (GitHub Pages)
function getBasePath(): string {
  return process.env.NODE_ENV === "production" ? "/DutySync" : "";
}

// ============ EDIPI Encryption ============
// AES-GCM encryption for EDIPIs in JSON files
// SECURITY NOTE: The encryption key MUST be set via NEXT_PUBLIC_EDIPI_KEY environment variable
// For production, consider server-side encryption instead of client-side

const EDIPI_KEY = process.env.NEXT_PUBLIC_EDIPI_KEY || "";

// Derive a consistent encryption key from the password using PBKDF2
async function deriveKey(password: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  // Use a fixed salt for deterministic key derivation (required for decryption)
  const salt = encoder.encode("DutySync-EDIPI-Salt-v1");

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Encrypt an EDIPI using AES-GCM
export async function encryptEdipiAsync(edipi: string): Promise<string> {
  if (!edipi) return "";
  if (!EDIPI_KEY) {
    console.warn("EDIPI encryption key not configured - storing plaintext");
    return edipi;
  }

  try {
    const key = await deriveKey(EDIPI_KEY);
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encryptedBuffer = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoder.encode(edipi)
    );

    // Combine IV and ciphertext, then base64 encode
    const combined = new Uint8Array(iv.length + encryptedBuffer.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encryptedBuffer), iv.length);

    return btoa(String.fromCharCode(...combined));
  } catch (error) {
    console.error("EDIPI encryption failed:", error);
    return edipi;
  }
}

// Synchronous wrapper for backward compatibility (uses legacy XOR for sync operations)
export function encryptEdipi(edipi: string): string {
  if (!edipi) return "";
  if (!EDIPI_KEY) {
    console.warn("EDIPI encryption key not configured - storing plaintext");
    return edipi;
  }

  // Use HMAC-based encryption for sync operations (more secure than XOR)
  // This provides obfuscation while async AES-GCM is preferred for new data
  const encoder = new TextEncoder();
  const data = encoder.encode(edipi);
  const keyBytes = encoder.encode(EDIPI_KEY);

  // Simple but improved encryption using key-derived transformation
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    // Use multiple key bytes for each data byte (better diffusion)
    const k1 = keyBytes[i % keyBytes.length];
    const k2 = keyBytes[(i + 7) % keyBytes.length];
    const k3 = keyBytes[(i + 13) % keyBytes.length];
    result[i] = data[i] ^ k1 ^ ((k2 + i) & 0xFF) ^ ((k3 * (i + 1)) & 0xFF);
  }

  return btoa(String.fromCharCode(...result));
}

// Decrypt an EDIPI from JSON storage
export function decryptEdipi(encrypted: string): string {
  if (!encrypted) return "";

  // If it's already a plain EDIPI, return as-is
  if (/^\d{10}$/.test(encrypted)) {
    return encrypted;
  }

  if (!EDIPI_KEY) {
    console.warn("EDIPI decryption key not configured");
    return encrypted;
  }

  // Try decryption with improved algorithm
  const tryDecryptImproved = (): string | null => {
    try {
      const decoded = atob(encrypted);
      const encoder = new TextEncoder();
      const keyBytes = encoder.encode(EDIPI_KEY);
      const data = new Uint8Array([...decoded].map(c => c.charCodeAt(0)));

      const result = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) {
        const k1 = keyBytes[i % keyBytes.length];
        const k2 = keyBytes[(i + 7) % keyBytes.length];
        const k3 = keyBytes[(i + 13) % keyBytes.length];
        result[i] = data[i] ^ k1 ^ ((k2 + i) & 0xFF) ^ ((k3 * (i + 1)) & 0xFF);
      }

      const decrypted = new TextDecoder().decode(result);
      if (/^\d{10}$/.test(decrypted)) {
        return decrypted;
      }
      return null;
    } catch {
      return null;
    }
  };

  // Try legacy XOR decryption for backward compatibility
  const tryDecryptLegacy = (key: string): string | null => {
    try {
      const decoded = atob(encrypted);
      let result = "";
      for (let i = 0; i < decoded.length; i++) {
        const charCode = decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length);
        result += String.fromCharCode(charCode);
      }
      if (/^\d{10}$/.test(result)) {
        return result;
      }
      return null;
    } catch {
      return null;
    }
  };

  // Try improved algorithm first
  const improvedResult = tryDecryptImproved();
  if (improvedResult) return improvedResult;

  // Try legacy decryption with current key
  const legacyResult = tryDecryptLegacy(EDIPI_KEY);
  if (legacyResult) return legacyResult;

  // Try legacy with old default key for migration
  const legacyDefault = tryDecryptLegacy("DutySync2024");
  if (legacyDefault) return legacyDefault;

  console.warn("EDIPI decryption failed - key mismatch or invalid data");
  return encrypted;
}

// Async decryption for AES-GCM encrypted data
export async function decryptEdipiAsync(encrypted: string): Promise<string> {
  if (!encrypted) return "";
  if (/^\d{10}$/.test(encrypted)) return encrypted;
  if (!EDIPI_KEY) return encrypted;

  try {
    const key = await deriveKey(EDIPI_KEY);
    const combined = new Uint8Array(
      atob(encrypted).split("").map(c => c.charCodeAt(0))
    );

    // First 12 bytes are IV
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );

    const decrypted = new TextDecoder().decode(decryptedBuffer);
    if (/^\d{10}$/.test(decrypted)) {
      return decrypted;
    }
  } catch {
    // Fall back to sync decryption for legacy data
    return decryptEdipi(encrypted);
  }

  return decryptEdipi(encrypted);
}

// Check if a value looks like an encrypted EDIPI (base64 encoded)
function isEncryptedEdipi(value: string): boolean {
  // Encrypted EDIPIs are base64 and won't be 10 digits
  return value.length !== 10 || !/^\d{10}$/.test(value);
}

// LocalStorage keys
const KEYS = {
  units: "dutysync_units",
  personnel: "dutysync_personnel",
  dutyTypes: "dutysync_duty_types",
  dutyValues: "dutysync_duty_values",
  dutyRequirements: "dutysync_duty_requirements",
  dutySlots: "dutysync_duty_slots",
  nonAvailability: "dutysync_non_availability",
  dutyChangeRequests: "dutysync_duty_change_requests",
  swapApprovals: "dutysync_swap_approvals",
  swapRecommendations: "dutysync_swap_recommendations",
  qualifications: "dutysync_qualifications",
  blockedDuties: "dutysync_blocked_duties",
  users: "dutysync_users",
  rucs: "dutysync_rucs",
  seedDataLoaded: "dutysync_seed_loaded",
  approvedRosters: "dutysync_approved_rosters",
  dutyScoreEvents: "dutysync_duty_score_events",
  supernumeraryAssignments: "dutysync_supernumerary_assignments",
};

// Duty slot retention period (in months)
const DUTY_SLOT_RETENTION_MONTHS = 12;

/**
 * Get the cutoff date for duty slot retention (12 months ago)
 */
export function getDutySlotRetentionCutoff(): string {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - DUTY_SLOT_RETENTION_MONTHS);
  return cutoff.toISOString().split('T')[0]; // Return as YYYY-MM-DD string
}

/**
 * Clean up duty slots older than the retention period (12 months)
 * Returns the number of slots removed
 */
export function cleanupOldDutySlots(): number {
  const cutoffDate = getDutySlotRetentionCutoff();
  const slots = getFromStorage<DutySlot>(KEYS.dutySlots);
  const originalCount = slots.length;

  // Keep slots that are within the retention period
  const recentSlots = slots.filter(slot => slot.date_assigned >= cutoffDate);

  const removedCount = originalCount - recentSlots.length;

  if (removedCount > 0) {
    saveToStorage(KEYS.dutySlots, recentSlots);
    console.log(`[Data Retention] Cleaned up ${removedCount} duty slots older than ${DUTY_SLOT_RETENTION_MONTHS} months (before ${cutoffDate})`);
  }

  return removedCount;
}

// Track localStorage errors for diagnostics
let lastStorageError: { key: string; error: string; timestamp: Date } | null = null;

export function getLastStorageError(): { key: string; error: string; timestamp: Date } | null {
  return lastStorageError;
}

// Track skipped syncs due to missing RUC code
interface SkippedSync {
  operation: string;
  reason: string;
  timestamp: Date;
  itemCount?: number;
}

let skippedSyncs: SkippedSync[] = [];
const MAX_SKIPPED_SYNCS = 50;

function recordSkippedSync(operation: string, reason: string, itemCount?: number): void {
  skippedSyncs.push({
    operation,
    reason,
    timestamp: new Date(),
    itemCount,
  });
  // Keep only the last N entries
  if (skippedSyncs.length > MAX_SKIPPED_SYNCS) {
    skippedSyncs = skippedSyncs.slice(-MAX_SKIPPED_SYNCS);
  }
}

export function getSkippedSyncs(): SkippedSync[] {
  return [...skippedSyncs];
}

export function clearSkippedSyncs(): void {
  skippedSyncs = [];
}

// Validate RUC code is available before sync operations
function validateRucForSync(operation: string, itemCount?: number): string | null {
  const rucCode = getCurrentRuc();
  if (!rucCode) {
    console.warn(`[${operation}] No RUC code available, skipping Supabase sync`);
    recordSkippedSync(operation, "No RUC code available", itemCount);
    return null;
  }
  return rucCode;
}

// ============ Sync Supabase Data to localStorage ============
// These functions allow data-layer.ts to sync Supabase data to localStorage
// so that client-stores functions use the correct Supabase IDs

// Helper function for localStorage sync with error handling
function syncToLocalStorageWithErrorHandling<T>(
  key: string,
  data: T[],
  dataType: string
): boolean {
  if (typeof window === "undefined") return false;

  try {
    const jsonData = JSON.stringify(data);
    localStorage.setItem(key, jsonData);
    const currentVersion = cacheVersions.get(key) || 0;
    dataCache.set(key, { data, version: currentVersion });

    if (process.env.NODE_ENV === "development") {
      console.log(`[Sync] Synced ${data.length} ${dataType} from Supabase to localStorage`);
    }
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    lastStorageError = { key, error: errorMessage, timestamp: new Date() };

    if (errorMessage.includes("QuotaExceeded") || errorMessage.includes("quota")) {
      console.error(
        `[Sync] localStorage quota exceeded while syncing ${dataType}. ` +
        `Data has ${data.length} items.`
      );
    } else {
      console.error(`[Sync] Failed to sync ${dataType} to localStorage:`, errorMessage);
    }

    // Still update the in-memory cache so the app can continue
    const currentVersion = cacheVersions.get(key) || 0;
    dataCache.set(key, { data, version: currentVersion });
    return false;
  }
}

export function syncUnitsToLocalStorage(units: UnitSection[]): boolean {
  return syncToLocalStorageWithErrorHandling(KEYS.units, units, "units");
}

export function syncDutyTypesToLocalStorage(dutyTypes: DutyType[]): boolean {
  return syncToLocalStorageWithErrorHandling(KEYS.dutyTypes, dutyTypes, "duty types");
}

export function syncPersonnelToLocalStorage(personnel: Personnel[]): boolean {
  return syncToLocalStorageWithErrorHandling(KEYS.personnel, personnel, "personnel");
}

export function syncDutySlotsToLocalStorage(dutySlots: DutySlot[]): boolean {
  // Apply 12-month retention policy before syncing
  const cutoffDate = getDutySlotRetentionCutoff();
  const recentSlots = dutySlots.filter(slot => slot.date_assigned >= cutoffDate);

  if (recentSlots.length < dutySlots.length) {
    console.log(`[Data Retention] Filtered out ${dutySlots.length - recentSlots.length} duty slots older than 12 months during sync`);
  }

  return syncToLocalStorageWithErrorHandling(KEYS.dutySlots, recentSlots, "duty slots");
}

// ============ Migration: Sync localStorage TO Supabase ============
// One-time migration for data created before Supabase sync was working

export async function migrateLocalStorageToSupabase(): Promise<{
  dutyTypes: { synced: number; failed: number };
  dutySlots: { synced: number; failed: number };
}> {
  const orgId = getDefaultOrganizationId();
  if (!orgId) {
    console.error("[Migration] No organization ID found. Cannot migrate.");
    return { dutyTypes: { synced: 0, failed: 0 }, dutySlots: { synced: 0, failed: 0 } };
  }

  console.log("[Migration] Starting localStorage to Supabase migration...");
  const result = {
    dutyTypes: { synced: 0, failed: 0 },
    dutySlots: { synced: 0, failed: 0 },
  };

  // Step 1: Migrate duty types first (duty slots depend on them)
  const dutyTypes = getFromStorage<DutyType>(KEYS.dutyTypes);
  console.log(`[Migration] Found ${dutyTypes.length} duty types in localStorage`);

  for (const dt of dutyTypes) {
    try {
      const synced = await supabaseCreateDutyType(
        orgId,
        dt.unit_section_id,
        dt.duty_name,
        {
          id: dt.id,
          description: dt.description,
          personnelRequired: dt.slots_needed,
          rankFilterMode: dt.rank_filter_mode || "none",
          rankFilterValues: dt.rank_filter_values,
          sectionFilterMode: dt.section_filter_mode || "none",
          sectionFilterValues: dt.section_filter_values,
        }
      );
      if (synced) {
        result.dutyTypes.synced++;
      } else {
        result.dutyTypes.failed++;
      }
    } catch (err) {
      console.error("[Migration] Failed to sync duty type:", dt.id, err);
      result.dutyTypes.failed++;
    }
  }

  console.log(`[Migration] Duty types: ${result.dutyTypes.synced} synced, ${result.dutyTypes.failed} failed`);

  // Step 2: Migrate duty slots (now that duty types exist in Supabase)
  const dutySlots = getFromStorage<DutySlot>(KEYS.dutySlots);
  console.log(`[Migration] Found ${dutySlots.length} duty slots in localStorage`);

  for (const slot of dutySlots) {
    try {
      const synced = await supabaseCreateDutySlot(
        orgId,
        slot.duty_type_id,
        slot.personnel_id,
        slot.date_assigned, // Already a DateString
        slot.assigned_by || undefined,
        slot.id
      );
      if (synced) {
        result.dutySlots.synced++;
      } else {
        result.dutySlots.failed++;
      }
    } catch (err) {
      console.error("[Migration] Failed to sync duty slot:", slot.id, err);
      result.dutySlots.failed++;
    }
  }

  console.log(`[Migration] Duty slots: ${result.dutySlots.synced} synced, ${result.dutySlots.failed} failed`);
  console.log("[Migration] Migration complete!", result);

  return result;
}

// Expose migration function on window for console access
if (typeof window !== "undefined") {
  (window as unknown as { migrateLocalStorageToSupabase: typeof migrateLocalStorageToSupabase }).migrateLocalStorageToSupabase = migrateLocalStorageToSupabase;
}

// ============ In-Memory Cache Layer ============
// Caches parsed localStorage data to avoid repeated JSON.parse calls

interface CacheEntry<T> {
  data: T[];
  version: number;
}

// Global cache with version tracking for invalidation
const dataCache = new Map<string, CacheEntry<unknown>>();
const cacheVersions = new Map<string, number>();

// Initialize cache versions
for (const key of Object.values(KEYS)) {
  cacheVersions.set(key, 0);
}

// Cross-tab cache invalidation via storage events
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    // When a key is updated in another tab, invalidate its cache entry
    if (event.key && cacheVersions.has(event.key)) {
      const currentVersion = cacheVersions.get(event.key) || 0;
      cacheVersions.set(event.key, currentVersion + 1);
      dataCache.delete(event.key);
    }
    // When localStorage.clear() is called, event.key is null
    else if (event.key === null) {
      dataCache.clear();
      for (const k of cacheVersions.keys()) {
        cacheVersions.set(k, (cacheVersions.get(k) || 0) + 1);
      }
    }
  });
}

/**
 * Invalidate cache for a specific key
 * Call this when data is modified from external sources (sync, import)
 */
export function invalidateCache(key?: string): void {
  if (key) {
    const currentVersion = cacheVersions.get(key) || 0;
    cacheVersions.set(key, currentVersion + 1);
    dataCache.delete(key);
  } else {
    // Invalidate all caches
    dataCache.clear();
    for (const k of cacheVersions.keys()) {
      cacheVersions.set(k, (cacheVersions.get(k) || 0) + 1);
    }
  }
}

/**
 * Invalidate all data caches - useful after sync or import operations
 */
export function invalidateAllCaches(): void {
  invalidateCache();
}

// ============ RUC Reference Data ============

// RUC entry structure
export interface RucEntry {
  ruc: string;
  name: string | null;
}

// RUC data file structure
interface RucsData {
  rucs: RucEntry[];
}

// In-memory cache for RUCs (avoids repeated localStorage reads)
let rucsCache: RucEntry[] = [];
let rucsByCodeCache = new Map<string, RucEntry>();

function populateRucCache(data: RucEntry[]) {
  rucsCache = data;
  rucsByCodeCache.clear();
  for (const ruc of rucsCache) {
    rucsByCodeCache.set(ruc.ruc, ruc);
  }
}

// Load RUCs from the reference file
export async function loadRucs(): Promise<RucEntry[]> {
  if (typeof window === "undefined") return [];

  // If already loaded in memory, return it
  if (rucsCache.length > 0) {
    return rucsCache;
  }

  // Check if already in localStorage
  const cached = localStorage.getItem(KEYS.rucs);
  if (cached) {
    try {
      const parsedRucs = JSON.parse(cached);
      populateRucCache(parsedRucs);
      return rucsCache;
    } catch {
      // Continue to fetch from file if localStorage is corrupt
    }
  }

  try {
    const response = await fetch(`${getBasePath()}/data/rucs.json`);
    if (response.ok) {
      const data: RucsData = await response.json();
      if (data.rucs && Array.isArray(data.rucs)) {
        localStorage.setItem(KEYS.rucs, JSON.stringify(data.rucs));
        populateRucCache(data.rucs);
        return rucsCache;
      }
    }
  } catch (error) {
    console.error("Failed to load RUCs:", error);
  }
  return [];
}

// Get all RUCs from the in-memory cache (call loadRucs first to populate)
export function getAllRucs(): RucEntry[] {
  return rucsCache;
}

// Get a single RUC by code (O(1) lookup using Map)
export function getRucByCode(rucCode: string): RucEntry | undefined {
  return rucsByCodeCache.get(rucCode);
}

// Update the name of a RUC (unit admin function)
export function updateRucName(rucCode: string, name: string | null): boolean {
  if (typeof window === "undefined") return false;
  try {
    const ruc = rucsByCodeCache.get(rucCode);
    if (!ruc) return false;

    ruc.name = name;
    // The rucsCache array is updated by reference, so we just need to save it
    localStorage.setItem(KEYS.rucs, JSON.stringify(rucsCache));
    return true;
  } catch (error) {
    console.error("Failed to update RUC name:", error);
    return false;
  }
}

// Search RUCs by code or name
export function searchRucs(query: string): RucEntry[] {
  const q = query.toLowerCase();
  return getAllRucs().filter(r =>
    r.ruc.includes(q) ||
    (r.name && r.name.toLowerCase().includes(q))
  );
}

// Get RUC display name (name if set, otherwise just the code)
export function getRucDisplayName(rucCode: string): string {
  const ruc = getRucByCode(rucCode);
  if (ruc && ruc.name) {
    return `${ruc.ruc} - ${ruc.name}`;
  }
  return rucCode;
}

// Export RUCs data for saving back to file (admin function)
export function exportRucsData(): RucsData {
  return {
    rucs: getAllRucs(),
  };
}

// ============ Seed Data Loading ============

// Units index structure
interface UnitsIndex {
  units: Array<{
    ruc: string;
    name: string;
    description?: string;
  }>;
  version: string;
  updatedAt: string;
}

// Get available RUCs from the units index
export async function getAvailableRucs(): Promise<UnitsIndex["units"]> {
  try {
    const response = await fetch(`${getBasePath()}/data/units-index.json`);
    if (response.ok) {
      const data: UnitsIndex = await response.json();
      return data.units || [];
    }
  } catch (error) {
    console.error("Failed to load units index:", error);
  }
  return [];
}

// Raw personnel record from JSON (without required date fields)
interface RawPersonnelRecord {
  id: string;
  service_id: string;
  unit_section_id: string;
  first_name: string;
  last_name: string;
  rank: string;
  current_duty_score: number;
  created_at?: Date;
  updated_at?: Date;
}

// Return type for loadSeedDataIfNeeded
type SeedDataResult = {
  unitsLoaded: number;
  personnelLoaded: number;
  dutyTypesLoaded: number;
  dutySlotsLoaded: number;
  nonAvailabilityLoaded: number;
  qualificationsLoaded: number;
  dutyChangeRequestsLoaded: number;
  alreadyLoaded: boolean;
};

// Helper to create default seed data result
function createSeedDataResult(alreadyLoaded: boolean): SeedDataResult {
  return {
    unitsLoaded: 0,
    personnelLoaded: 0,
    dutyTypesLoaded: 0,
    dutySlotsLoaded: 0,
    nonAvailabilityLoaded: 0,
    qualificationsLoaded: 0,
    dutyChangeRequestsLoaded: 0,
    alreadyLoaded,
  };
}

// Load seed data from JSON files if localStorage is empty
// Uses atomic loading: either all data loads successfully or nothing is saved
export async function loadSeedDataIfNeeded(): Promise<SeedDataResult> {
  if (typeof window === "undefined") {
    return createSeedDataResult(false);
  }

  // Check if seed data was already loaded
  const seedLoaded = localStorage.getItem(KEYS.seedDataLoaded);
  if (seedLoaded === "true") {
    return createSeedDataResult(true);
  }

  // Check if there's existing data
  const existingUnits = getFromStorage<UnitSection>(KEYS.units);
  const existingPersonnel = getFromStorage<Personnel>(KEYS.personnel);

  if (existingUnits.length > 0 || existingPersonnel.length > 0) {
    // Mark as loaded since data exists
    localStorage.setItem(KEYS.seedDataLoaded, "true");
    return createSeedDataResult(true);
  }

  // Collect all data before saving (atomic operation)
  const allUnits: UnitSection[] = [];
  const allPersonnel: Personnel[] = [];
  const allDutyTypes: DutyType[] = [];
  const allDutyValues: DutyValue[] = [];
  const allDutyRequirements: DutyRequirement[] = [];
  const allDutySlots: DutySlot[] = [];
  const allNonAvailability: NonAvailability[] = [];
  const allQualifications: Qualification[] = [];
  const allDutyChangeRequests: DutyChangeRequest[] = [];

  try {
    // Load units index to get available RUCs
    const availableRucs = await getAvailableRucs();

    if (availableRucs.length === 0) {
      console.warn("No RUCs found in units index");
      return createSeedDataResult(false);
    }

    // Fetch all data in parallel for each RUC
    const fetchPromises = availableRucs.map(async (rucInfo) => {
      const ruc = rucInfo.ruc;
      const basePath = `${getBasePath()}/data/unit/${ruc}`;

      // Required files (must exist)
      const unitResponse = await fetch(`${basePath}/unit-structure.json`);
      const personnelResponse = await fetch(`${basePath}/unit-members.json`);

      // Optional files (may not exist yet)
      const dutyTypesResponse = await fetch(`${basePath}/duty-types.json`).catch(() => null);
      const dutyRosterResponse = await fetch(`${basePath}/duty-roster.json`).catch(() => null);
      const nonAvailabilityResponse = await fetch(`${basePath}/non-availability.json`).catch(() => null);
      const qualificationsResponse = await fetch(`${basePath}/qualifications.json`).catch(() => null);
      const dutyChangeRequestsResponse = await fetch(`${basePath}/duty-change-requests.json`).catch(() => null);

      // Both required fetches must succeed for this RUC
      if (!unitResponse.ok) {
        throw new Error(`Failed to fetch unit structure for RUC ${ruc}: ${unitResponse.status}`);
      }
      if (!personnelResponse.ok) {
        throw new Error(`Failed to fetch personnel for RUC ${ruc}: ${personnelResponse.status}`);
      }

      const unitData = await unitResponse.json();
      const personnelData = await personnelResponse.json();

      // Parse optional files if they exist and are valid
      const dutyTypesData = dutyTypesResponse?.ok ? await dutyTypesResponse.json() : null;
      const dutyRosterData = dutyRosterResponse?.ok ? await dutyRosterResponse.json() : null;
      const nonAvailabilityData = nonAvailabilityResponse?.ok ? await nonAvailabilityResponse.json() : null;
      const qualificationsData = qualificationsResponse?.ok ? await qualificationsResponse.json() : null;
      const dutyChangeRequestsData = dutyChangeRequestsResponse?.ok ? await dutyChangeRequestsResponse.json() : null;

      // Validate required data structure
      if (!unitData.units || !Array.isArray(unitData.units)) {
        throw new Error(`Invalid unit structure for RUC ${ruc}: missing units array`);
      }
      if (!personnelData.personnel || !Array.isArray(personnelData.personnel)) {
        throw new Error(`Invalid personnel data for RUC ${ruc}: missing personnel array`);
      }

      return { ruc, unitData, personnelData, dutyTypesData, dutyRosterData, nonAvailabilityData, qualificationsData, dutyChangeRequestsData };
    });

    // Wait for all fetches to complete
    const results = await Promise.all(fetchPromises);

    // Process all results after successful fetch
    for (const { ruc, unitData, personnelData, dutyTypesData, dutyRosterData, nonAvailabilityData, qualificationsData, dutyChangeRequestsData } of results) {
      // Add units with RUC field for proper sync filtering
      const unitsWithRuc = unitData.units.map((u: UnitSection) => ({ ...u, ruc }));
      allUnits.push(...unitsWithRuc);

      // Process and add personnel with decrypted EDIPIs and timestamps
      // Use the encrypted flag from the JSON file instead of magic check
      const isEncrypted = personnelData.encrypted === true;
      const personnelWithDates = personnelData.personnel.map((p: RawPersonnelRecord) => ({
        ...p,
        service_id: isEncrypted ? decryptEdipi(p.service_id) : p.service_id,
        created_at: p.created_at || new Date(),
        updated_at: p.updated_at || new Date(),
      }));
      allPersonnel.push(...personnelWithDates);

      // Add duty types, values, and requirements if present
      if (dutyTypesData) {
        if (dutyTypesData.dutyTypes && Array.isArray(dutyTypesData.dutyTypes)) {
          allDutyTypes.push(...dutyTypesData.dutyTypes);
        }
        if (dutyTypesData.dutyValues && Array.isArray(dutyTypesData.dutyValues)) {
          allDutyValues.push(...dutyTypesData.dutyValues);
        }
        if (dutyTypesData.dutyRequirements && Array.isArray(dutyTypesData.dutyRequirements)) {
          allDutyRequirements.push(...dutyTypesData.dutyRequirements);
        }
      }

      // Add duty slots if present
      if (dutyRosterData?.dutySlots && Array.isArray(dutyRosterData.dutySlots)) {
        allDutySlots.push(...dutyRosterData.dutySlots);
      }

      // Add non-availability if present
      if (nonAvailabilityData?.nonAvailability && Array.isArray(nonAvailabilityData.nonAvailability)) {
        allNonAvailability.push(...nonAvailabilityData.nonAvailability);
      }

      // Add qualifications if present
      if (qualificationsData?.qualifications && Array.isArray(qualificationsData.qualifications)) {
        allQualifications.push(...qualificationsData.qualifications);
      }

      // Add duty change requests if present
      if (dutyChangeRequestsData?.dutyChangeRequests && Array.isArray(dutyChangeRequestsData.dutyChangeRequests)) {
        allDutyChangeRequests.push(...dutyChangeRequestsData.dutyChangeRequests);
      }
    }

    // All data fetched and validated - now save atomically
    saveToStorage(KEYS.units, allUnits);
    saveToStorage(KEYS.personnel, allPersonnel);
    saveToStorage(KEYS.dutyTypes, allDutyTypes);
    saveToStorage(KEYS.dutyValues, allDutyValues);
    saveToStorage(KEYS.dutyRequirements, allDutyRequirements);
    saveToStorage(KEYS.dutySlots, allDutySlots);
    saveToStorage(KEYS.nonAvailability, allNonAvailability);
    saveToStorage(KEYS.qualifications, allQualifications);
    saveToStorage(KEYS.dutyChangeRequests, allDutyChangeRequests);

    // Only mark as loaded after all data is successfully saved
    localStorage.setItem(KEYS.seedDataLoaded, "true");

    console.log(`Seed data loaded: ${allUnits.length} units, ${allPersonnel.length} personnel, ${allDutyTypes.length} duty types, ${allDutySlots.length} duty slots, ${allNonAvailability.length} non-availability, ${allQualifications.length} qualifications, ${allDutyChangeRequests.length} duty change requests`);
    return {
      unitsLoaded: allUnits.length,
      personnelLoaded: allPersonnel.length,
      dutyTypesLoaded: allDutyTypes.length,
      dutySlotsLoaded: allDutySlots.length,
      nonAvailabilityLoaded: allNonAvailability.length,
      qualificationsLoaded: allQualifications.length,
      dutyChangeRequestsLoaded: allDutyChangeRequests.length,
      alreadyLoaded: false
    };
  } catch (error) {
    // Clean up any partial data on failure
    localStorage.removeItem(KEYS.units);
    localStorage.removeItem(KEYS.personnel);
    localStorage.removeItem(KEYS.dutyTypes);
    localStorage.removeItem(KEYS.dutyValues);
    localStorage.removeItem(KEYS.dutyRequirements);
    localStorage.removeItem(KEYS.dutySlots);
    localStorage.removeItem(KEYS.nonAvailability);
    localStorage.removeItem(KEYS.dutyChangeRequests);
    localStorage.removeItem(KEYS.qualifications);
    // Do NOT set seedDataLoaded - allow retry on next page load
    console.error("Failed to load seed data (atomic rollback):", error);
    return createSeedDataResult(false);
  }
}

// Load data for a specific RUC
export async function loadRucData(ruc: string): Promise<{
  unitsLoaded: number;
  personnelLoaded: number;
}> {
  let unitsLoaded = 0;
  let personnelLoaded = 0;

  try {
    // Load unit structure from RUC folder
    const unitResponse = await fetch(`${getBasePath()}/data/unit/${ruc}/unit-structure.json`);
    if (unitResponse.ok) {
      const unitData = await unitResponse.json();
      if (unitData.units && Array.isArray(unitData.units)) {
        const existingUnits = getFromStorage<UnitSection>(KEYS.units);
        // Filter out any existing units with same IDs to avoid duplicates
        const existingIds = new Set(existingUnits.map(u => u.id));
        const newUnits = unitData.units.filter((u: UnitSection) => !existingIds.has(u.id));
        const mergedUnits = [...existingUnits, ...newUnits];
        saveToStorage(KEYS.units, mergedUnits);
        unitsLoaded = newUnits.length;
      }
    }

    // Load personnel from RUC folder
    const personnelResponse = await fetch(`${getBasePath()}/data/unit/${ruc}/unit-members.json`);
    if (personnelResponse.ok) {
      const personnelData = await personnelResponse.json();
      if (personnelData.personnel && Array.isArray(personnelData.personnel)) {
        // Use the encrypted flag from the JSON file instead of magic check
        const isEncrypted = personnelData.encrypted === true;
        const personnelWithDates = personnelData.personnel.map((p: RawPersonnelRecord) => ({
          ...p,
          service_id: isEncrypted ? decryptEdipi(p.service_id) : p.service_id,
          created_at: p.created_at || new Date(),
          updated_at: p.updated_at || new Date(),
        }));
        const existingPersonnel = getFromStorage<Personnel>(KEYS.personnel);
        // Filter out duplicates by service_id (EDIPI)
        const existingEdipis = new Set(existingPersonnel.map(p => p.service_id));
        const newPersonnel = personnelWithDates.filter((p: Personnel) => !existingEdipis.has(p.service_id));
        const mergedPersonnel = [...existingPersonnel, ...newPersonnel];
        saveToStorage(KEYS.personnel, mergedPersonnel);
        personnelLoaded = newPersonnel.length;
      }
    }
  } catch (error) {
    console.error(`Failed to load data for RUC ${ruc}:`, error);
  }

  return { unitsLoaded, personnelLoaded };
}

// Force reload seed data (clears ALL existing data and reloads from JSON)
export async function reloadSeedData(): Promise<{
  unitsLoaded: number;
  personnelLoaded: number;
}> {
  if (typeof window === "undefined") {
    return { unitsLoaded: 0, personnelLoaded: 0 };
  }

  // Clear ALL existing data to ensure clean state
  Object.values(KEYS).forEach((key) => {
    localStorage.removeItem(key);
  });

  // Reload
  const result = await loadSeedDataIfNeeded();
  return { unitsLoaded: result.unitsLoaded, personnelLoaded: result.personnelLoaded };
}

// Helper to safely get from localStorage
function getFromStorage<T>(key: string): T[] {
  if (typeof window === "undefined") return [];

  // Check cache first
  const currentVersion = cacheVersions.get(key) || 0;
  const cached = dataCache.get(key) as CacheEntry<T> | undefined;

  if (cached && cached.version === currentVersion) {
    return cached.data;
  }

  // Cache miss - parse from localStorage
  try {
    const data = localStorage.getItem(key);
    const parsed: T[] = data ? JSON.parse(data) : [];

    // Store in cache
    dataCache.set(key, { data: parsed, version: currentVersion });

    return parsed;
  } catch (error) {
    console.error(`Failed to parse ${key} from localStorage. Clearing item.`, error);
    localStorage.removeItem(key);
    return [];
  }
}

// Helper to save to localStorage and update cache with error handling
function saveToStorage<T>(key: string, data: T[]): boolean {
  if (typeof window === "undefined") return false;

  try {
    const jsonData = JSON.stringify(data);
    localStorage.setItem(key, jsonData);

    // Update cache with new data
    const currentVersion = cacheVersions.get(key) || 0;
    dataCache.set(key, { data, version: currentVersion });
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    lastStorageError = { key, error: errorMessage, timestamp: new Date() };

    // Check if it's a quota exceeded error
    if (errorMessage.includes("QuotaExceeded") || errorMessage.includes("quota")) {
      console.error(
        `[Storage] localStorage quota exceeded while saving ${key}. ` +
        `Data has ${data.length} items. Consider clearing old data.`
      );
    } else {
      console.error(`[Storage] Failed to save ${key} to localStorage:`, errorMessage);
    }

    // Still update the in-memory cache so the app can continue
    const currentVersion = cacheVersions.get(key) || 0;
    dataCache.set(key, { data, version: currentVersion });
    return false;
  }
}

// Deduplicate array by ID
function deduplicateById<T extends { id: string }>(data: T[]): T[] {
  const seen = new Map<string, T>();
  // Keep the last occurrence (most recent)
  for (const item of data) {
    seen.set(item.id, item);
  }
  return Array.from(seen.values());
}

/**
 * Clean up duplicate entries in localStorage caused by merge issues
 * Should be called once on app startup
 */
export function deduplicateLocalStorageData(): void {
  if (typeof window === "undefined") return;

  const deduplicateAndSave = <T extends { id: string }>(key: string, name: string) => {
    const items = getFromStorage<T>(key);
    const dedupedItems = deduplicateById(items);
    if (dedupedItems.length !== items.length) {
      console.log(`Deduplicated ${name}: ${items.length} -> ${dedupedItems.length}`);
      saveToStorage(key, dedupedItems);
    }
  };

  deduplicateAndSave<UnitSection>(KEYS.units, "units");
  deduplicateAndSave<Personnel>(KEYS.personnel, "personnel");
  deduplicateAndSave<DutySlot>(KEYS.dutySlots, "duty slots");
  deduplicateAndSave<DutyType>(KEYS.dutyTypes, "duty types");
  deduplicateAndSave<NonAvailability>(KEYS.nonAvailability, "non-availability");

  // Apply 12-month retention policy for duty slots
  cleanupOldDutySlots();
}

// Unit Sections
export function getUnitSections(): UnitSection[] {
  return getFromStorage<UnitSection>(KEYS.units).sort((a, b) => {
    return getLevelOrder(a.hierarchy_level) - getLevelOrder(b.hierarchy_level);
  });
}

export function getUnitSectionById(id: string): UnitSection | undefined {
  return getFromStorage<UnitSection>(KEYS.units).find((u) => u.id === id);
}

export function createUnitSection(unit: UnitSection): UnitSection {
  const units = getFromStorage<UnitSection>(KEYS.units);
  units.push(unit);
  saveToStorage(KEYS.units, units);
  triggerAutoSave('unitStructure');
  return unit;
}

export function updateUnitSection(id: string, updates: Partial<UnitSection>): UnitSection | null {
  const units = getFromStorage<UnitSection>(KEYS.units);
  const idx = units.findIndex((u) => u.id === id);
  if (idx === -1) return null;
  units[idx] = { ...units[idx], ...updates, updated_at: new Date() };
  saveToStorage(KEYS.units, units);
  triggerAutoSave('unitStructure');
  return units[idx];
}

export function getChildUnits(parentId: string): UnitSection[] {
  return getFromStorage<UnitSection>(KEYS.units).filter((u) => u.parent_id === parentId);
}

// Get all descendant unit IDs (recursive) including the given unit ID
export function getAllDescendantUnitIds(unitId: string): string[] {
  const allUnits = getFromStorage<UnitSection>(KEYS.units);

  function findDescendants(currentUnitId: string): string[] {
    const result: string[] = [currentUnitId];
    const children = allUnits.filter((u) => u.parent_id === currentUnitId);
    for (const child of children) {
      result.push(...findDescendants(child.id));
    }
    return result;
  }

  return findDescendants(unitId);
}

// Get personnel from a unit and all its descendant units
export function getPersonnelByUnitWithDescendants(unitId: string): Personnel[] {
  const unitIds = new Set(getAllDescendantUnitIds(unitId));
  return getFromStorage<Personnel>(KEYS.personnel)
    .filter((p) => unitIds.has(p.unit_section_id))
    .map(p => ({
      ...p,
      service_id: isEncryptedEdipi(p.service_id) ? decryptEdipi(p.service_id) : p.service_id,
    }));
}

/**
 * Get the hierarchy path for a unit as a string
 * Example: "02301 > H Company > S1DV"
 */
export function getUnitHierarchyPath(unitId: string): string {
  const path: string[] = [];
  let currentUnit = getUnitSectionById(unitId);

  while (currentUnit) {
    // Use unit_code if available, otherwise use unit_name
    const label = currentUnit.unit_code || currentUnit.unit_name;
    path.unshift(label);
    currentUnit = currentUnit.parent_id ? getUnitSectionById(currentUnit.parent_id) : undefined;
  }

  return path.join(' > ');
}

/**
 * Get the ancestor chain for a unit (from unit up to root)
 * Returns array of unit IDs starting from the given unit
 */
export function getUnitAncestorChain(unitId: string): string[] {
  const chain: string[] = [];
  let currentUnit = getUnitSectionById(unitId);

  while (currentUnit) {
    chain.push(currentUnit.id);
    currentUnit = currentUnit.parent_id ? getUnitSectionById(currentUnit.parent_id) : undefined;
  }

  return chain;
}

/**
 * Find the Lowest Common Ancestor (LCA) unit for two personnel
 * This is the first unit in the hierarchy that both personnel fall under
 * Returns: { lcaUnitId: string, approverLevel: 'work_section' | 'section' | 'company' }
 */
export function findLowestCommonAncestor(
  personnelAId: string,
  personnelBId: string
): { lcaUnitId: string | null; approverLevel: 'work_section_manager' | 'section_manager' | 'company_manager' } {
  const personA = getPersonnelById(personnelAId);
  const personB = getPersonnelById(personnelBId);

  if (!personA || !personB) {
    return { lcaUnitId: null, approverLevel: 'company_manager' };
  }

  // Same work section - work section manager is the LCA approver
  if (personA.unit_section_id === personB.unit_section_id) {
    return { lcaUnitId: personA.unit_section_id, approverLevel: 'work_section_manager' };
  }

  const unitA = getUnitSectionById(personA.unit_section_id);
  const unitB = getUnitSectionById(personB.unit_section_id);

  if (!unitA || !unitB) {
    return { lcaUnitId: null, approverLevel: 'company_manager' };
  }

  // Same section (same parent) - section manager is the LCA approver
  if (unitA.parent_id && unitA.parent_id === unitB.parent_id) {
    return { lcaUnitId: unitA.parent_id, approverLevel: 'section_manager' };
  }

  // Get ancestor chains for both
  const chainA = new Set(getUnitAncestorChain(personA.unit_section_id));
  const chainB = getUnitAncestorChain(personB.unit_section_id);

  // Find first common ancestor (walking up from B)
  for (const unitId of chainB) {
    if (chainA.has(unitId)) {
      const unit = getUnitSectionById(unitId);
      if (!unit) continue;

      // Return immediately on first common ancestor - this is the LCA
      // Determine the approver level based on hierarchy level
      if (unit.hierarchy_level === 'work_section') {
        return { lcaUnitId: unitId, approverLevel: 'work_section_manager' };
      } else if (unit.hierarchy_level === 'section') {
        return { lcaUnitId: unitId, approverLevel: 'section_manager' };
      } else {
        // company, battalion, unit, or any other higher level
        return { lcaUnitId: unitId, approverLevel: 'company_manager' };
      }
    }
  }

  // Default to company manager if no common ancestor found
  return { lcaUnitId: null, approverLevel: 'company_manager' };
}

export function deleteUnitSection(id: string): boolean {
  const allUnits = getFromStorage<UnitSection>(KEYS.units);

  // Check for child units before deleting
  const children = allUnits.filter((u) => u.parent_id === id);
  if (children.length > 0) {
    throw new Error("Cannot delete a unit that has child units. Please delete or reassign them first.");
  }

  const filtered = allUnits.filter((u) => u.id !== id);
  if (filtered.length === allUnits.length) return false;
  saveToStorage(KEYS.units, filtered);
  triggerAutoSave('unitStructure');
  return true;
}

// Personnel
export function getAllPersonnel(): Personnel[] {
  const personnel = getFromStorage<Personnel>(KEYS.personnel);

  // Ensure service_ids are decrypted (handles legacy data or corrupted state)
  return personnel.map(p => ({
    ...p,
    // Decrypt if it looks like an encrypted value (not 10 digits)
    service_id: isEncryptedEdipi(p.service_id) ? decryptEdipi(p.service_id) : p.service_id,
  })).sort((a, b) => a.last_name.localeCompare(b.last_name));
}

export function getPersonnelByUnit(unitId: string): Personnel[] {
  return getFromStorage<Personnel>(KEYS.personnel)
    .filter((p) => p.unit_section_id === unitId)
    .map(p => ({
      ...p,
      service_id: isEncryptedEdipi(p.service_id) ? decryptEdipi(p.service_id) : p.service_id,
    }));
}

export function getPersonnelById(id: string): Personnel | undefined {
  const person = getFromStorage<Personnel>(KEYS.personnel).find((p) => p.id === id);
  if (!person) return undefined;
  return {
    ...person,
    service_id: isEncryptedEdipi(person.service_id) ? decryptEdipi(person.service_id) : person.service_id,
  };
}

export function createPersonnel(person: Personnel): Personnel {
  const personnel = getFromStorage<Personnel>(KEYS.personnel);
  personnel.push(person);
  saveToStorage(KEYS.personnel, personnel);
  triggerAutoSave('unitMembers');
  return person;
}

export function updatePersonnel(id: string, updates: Partial<Personnel>): Personnel | null {
  const personnel = getFromStorage<Personnel>(KEYS.personnel);
  const idx = personnel.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  personnel[idx] = { ...personnel[idx], ...updates, updated_at: new Date() };
  saveToStorage(KEYS.personnel, personnel);
  triggerAutoSave('unitMembers');

  // Sync to Supabase in background for specific field updates
  // Use a plain object type for Supabase updates to avoid Date vs string type conflicts
  const supabaseUpdates: Record<string, unknown> = {};
  if (updates.current_duty_score !== undefined) {
    supabaseUpdates.current_duty_score = updates.current_duty_score;
  }
  if (updates.phone_number !== undefined) {
    supabaseUpdates.phone_number = updates.phone_number;
  }

  if (Object.keys(supabaseUpdates).length > 0) {
    syncToSupabase(
      () => supabaseUpdatePersonnel(id, supabaseUpdates as Parameters<typeof supabaseUpdatePersonnel>[1]),
      "updatePersonnel"
    );
  }

  return personnel[idx];
}

export function deletePersonnel(id: string): boolean {
  const personnel = getFromStorage<Personnel>(KEYS.personnel);
  const filtered = personnel.filter((p) => p.id !== id);
  if (filtered.length === personnel.length) return false;
  saveToStorage(KEYS.personnel, filtered);
  triggerAutoSave('unitMembers');
  return true;
}

// Duty Types
export function getAllDutyTypes(): DutyType[] {
  return getFromStorage<DutyType>(KEYS.dutyTypes).sort((a, b) =>
    a.duty_name.localeCompare(b.duty_name)
  );
}

export function getDutyTypesByUnit(unitId: string): DutyType[] {
  return getFromStorage<DutyType>(KEYS.dutyTypes).filter((dt) => dt.unit_section_id === unitId);
}

// Get duty types from a unit and all its descendant units
export function getDutyTypesByUnitWithDescendants(unitId: string): DutyType[] {
  const unitIds = new Set(getAllDescendantUnitIds(unitId));
  return getFromStorage<DutyType>(KEYS.dutyTypes).filter((dt) => unitIds.has(dt.unit_section_id));
}

export function getDutyTypeById(id: string): DutyType | undefined {
  return getFromStorage<DutyType>(KEYS.dutyTypes).find((dt) => dt.id === id);
}

export function createDutyType(dutyType: DutyType): DutyType {
  const types = getFromStorage<DutyType>(KEYS.dutyTypes);
  types.push(dutyType);
  saveToStorage(KEYS.dutyTypes, types);
  triggerAutoSave('dutyTypes');

  // Sync to Supabase in background
  const orgId = getOrganizationIdFromUnit(dutyType.unit_section_id);
  if (orgId) {
    syncToSupabase(
      () => supabaseCreateDutyType(orgId, dutyType.unit_section_id, dutyType.duty_name, {
        id: dutyType.id,
        description: dutyType.description,
        personnelRequired: dutyType.slots_needed,
        rankFilterMode: dutyType.rank_filter_mode || "none",
        rankFilterValues: dutyType.rank_filter_values,
        sectionFilterMode: dutyType.section_filter_mode || "none",
        sectionFilterValues: dutyType.section_filter_values,
        requiresSupernumerary: dutyType.requires_supernumerary,
        supernumeraryCount: dutyType.supernumerary_count,
        supernumeraryPeriodType: dutyType.supernumerary_period_type,
        supernumeraryPeriodDays: dutyType.supernumerary_period_days,
        supernumeraryValue: dutyType.supernumerary_value,
      }),
      "createDutyType"
    );
  }

  return dutyType;
}

export function updateDutyType(id: string, updates: Partial<DutyType>): DutyType | null {
  const types = getFromStorage<DutyType>(KEYS.dutyTypes);
  const idx = types.findIndex((dt) => dt.id === id);
  if (idx === -1) return null;
  const updatedType = { ...types[idx], ...updates, updated_at: new Date() };
  types[idx] = updatedType;
  saveToStorage(KEYS.dutyTypes, types);
  triggerAutoSave('dutyTypes');

  // Sync to Supabase using upsert (createDutyType now uses upsert)
  // This handles both cases: record exists in Supabase, or was created locally first
  const orgId = getOrganizationIdFromUnit(updatedType.unit_section_id);
  if (orgId) {
    syncToSupabase(
      () => supabaseCreateDutyType(orgId, updatedType.unit_section_id, updatedType.duty_name, {
        id: updatedType.id,
        description: updatedType.description,
        personnelRequired: updatedType.slots_needed,
        rankFilterMode: updatedType.rank_filter_mode === null ? "none" : updatedType.rank_filter_mode,
        rankFilterValues: updatedType.rank_filter_values,
        sectionFilterMode: updatedType.section_filter_mode === null ? "none" : updatedType.section_filter_mode,
        sectionFilterValues: updatedType.section_filter_values,
        requiresSupernumerary: updatedType.requires_supernumerary,
        supernumeraryCount: updatedType.supernumerary_count,
        supernumeraryPeriodType: updatedType.supernumerary_period_type,
        supernumeraryPeriodDays: updatedType.supernumerary_period_days,
        supernumeraryValue: updatedType.supernumerary_value,
      }),
      "updateDutyType"
    );
  }

  return updatedType;
}

export function deleteDutyType(id: string): boolean {
  const types = getFromStorage<DutyType>(KEYS.dutyTypes);
  const filtered = types.filter((dt) => dt.id !== id);
  if (filtered.length === types.length) return false;
  saveToStorage(KEYS.dutyTypes, filtered);
  triggerAutoSave('dutyTypes');

  // Sync to Supabase in background
  syncToSupabase(() => supabaseDeleteDutyType(id), "deleteDutyType");

  return true;
}

// Duty Values
export function getDutyValueByDutyType(dutyTypeId: string): DutyValue | undefined {
  return getFromStorage<DutyValue>(KEYS.dutyValues).find((dv) => dv.duty_type_id === dutyTypeId);
}

export function createDutyValue(dutyValue: DutyValue): DutyValue {
  const values = getFromStorage<DutyValue>(KEYS.dutyValues);
  values.push(dutyValue);
  saveToStorage(KEYS.dutyValues, values);
  triggerAutoSave('dutyTypes');

  // Sync to Supabase in background
  syncToSupabase(
    () => supabaseCreateDutyValue(dutyValue.duty_type_id, {
      id: dutyValue.id,
      baseWeight: dutyValue.base_weight,
      weekendMultiplier: dutyValue.weekend_multiplier,
      holidayMultiplier: dutyValue.holiday_multiplier,
    }),
    "createDutyValue"
  );

  return dutyValue;
}

export function updateDutyValue(id: string, updates: Partial<DutyValue>): DutyValue | null {
  const values = getFromStorage<DutyValue>(KEYS.dutyValues);
  const idx = values.findIndex((dv) => dv.id === id);
  if (idx === -1) return null;
  const updatedValue = { ...values[idx], ...updates };
  values[idx] = updatedValue;
  saveToStorage(KEYS.dutyValues, values);
  triggerAutoSave('dutyTypes');

  // Sync to Supabase using upsert (createDutyValue now uses upsert)
  // This handles both cases: record exists in Supabase, or was created locally first
  syncToSupabase(
    () => supabaseCreateDutyValue(updatedValue.duty_type_id, {
      id: updatedValue.id,
      baseWeight: updatedValue.base_weight,
      weekendMultiplier: updatedValue.weekend_multiplier,
      holidayMultiplier: updatedValue.holiday_multiplier,
    }),
    "updateDutyValue"
  );

  return updatedValue;
}

export function deleteDutyValue(id: string): boolean {
  const values = getFromStorage<DutyValue>(KEYS.dutyValues);
  const filtered = values.filter((dv) => dv.id !== id);
  if (filtered.length === values.length) return false;
  saveToStorage(KEYS.dutyValues, filtered);
  triggerAutoSave('dutyTypes');

  // Sync to Supabase in background
  syncToSupabase(() => supabaseDeleteDutyValue(id), "deleteDutyValue");

  return true;
}

// Duty Requirements
export function getDutyRequirements(dutyTypeId: string): DutyRequirement[] {
  return getFromStorage<DutyRequirement>(KEYS.dutyRequirements).filter(
    (dr) => dr.duty_type_id === dutyTypeId
  );
}

export function addDutyRequirement(dutyTypeId: string, qualName: string): DutyRequirement {
  const requirements = getFromStorage<DutyRequirement>(KEYS.dutyRequirements);
  const requirement: DutyRequirement = {
    duty_type_id: dutyTypeId,
    required_qual_name: qualName,
  };
  requirements.push(requirement);
  saveToStorage(KEYS.dutyRequirements, requirements);
  triggerAutoSave('dutyTypes');

  // Sync to Supabase in background (need to find qualification ID by name)
  // TODO: Implement qualification lookup by name to get qualification_id for Supabase sync.
  syncToSupabase(
    async () => {
      // The app uses qual_name but database uses qualification_id
      // This would need a lookup to convert qual_name to qualification_id
      const errorMessage = `Duty requirement sync not yet implemented - requires qualification lookup for: ${qualName}`;
      console.warn(`[Supabase Sync] ${errorMessage}`);
      throw new Error(errorMessage);
    },
    "addDutyRequirement"
  );

  return requirement;
}

export function clearDutyRequirements(dutyTypeId: string): void {
  const requirements = getFromStorage<DutyRequirement>(KEYS.dutyRequirements);
  const filtered = requirements.filter((dr) => dr.duty_type_id !== dutyTypeId);
  saveToStorage(KEYS.dutyRequirements, filtered);
  triggerAutoSave('dutyTypes');

  // Sync to Supabase in background
  syncToSupabase(
    () => supabaseDeleteDutyRequirementsByDutyType(dutyTypeId),
    "clearDutyRequirements"
  );
}

// Duty Slots

/**
 * Normalize a date string to DateString (YYYY-MM-DD) format.
 * Handles both ISO timestamps (2025-12-01T00:00:00.000Z) and DateString (2025-12-01) formats.
 * This is critical for slot limit validation - dates must match exactly.
 */
function normalizeDateToDateString(date: string): DateString {
  // If it's already a DateString (YYYY-MM-DD), return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date as DateString;
  }
  // Handle ISO timestamp format by extracting the date part
  if (date.includes('T')) {
    return date.split('T')[0] as DateString;
  }
  // Fallback: try to extract YYYY-MM-DD pattern
  const match = date.match(/(\d{4}-\d{2}-\d{2})/);
  if (match) {
    return match[1] as DateString;
  }
  // Last resort: return as-is (will likely fail comparison but won't crash)
  return date as DateString;
}

export function getAllDutySlots(): DutySlot[] {
  // String comparison works correctly for YYYY-MM-DD format
  return getFromStorage<DutySlot>(KEYS.dutySlots).sort(
    (a, b) => a.date_assigned.localeCompare(b.date_assigned)
  );
}

export function getDutySlotById(id: string): DutySlot | undefined {
  return getFromStorage<DutySlot>(KEYS.dutySlots).find((s) => s.id === id);
}

export function getDutySlotsByDateRange(startDate: DateString, endDate: DateString): DutySlot[] {
  // Normalize dates for comparison - handles both ISO timestamps and DateString formats
  // YYYY-MM-DD format sorts correctly as strings
  return getFromStorage<DutySlot>(KEYS.dutySlots).filter((slot) => {
    const slotDate = normalizeDateToDateString(slot.date_assigned);
    return slotDate >= startDate && slotDate <= endDate;
  });
}

export function getDutySlotsByDate(dateStr: DateString): DutySlot[] {
  // Normalize dates for comparison - handles both ISO timestamps and DateString formats
  return getFromStorage<DutySlot>(KEYS.dutySlots).filter((slot) => {
    const slotDate = normalizeDateToDateString(slot.date_assigned);
    return slotDate === dateStr;
  });
}

export function getDutySlotsByDateAndType(dateStr: DateString, dutyTypeId: string): DutySlot[] {
  // Normalize dates for comparison - handles both ISO timestamps and DateString formats
  // This is critical for slot limit validation to work correctly
  return getFromStorage<DutySlot>(KEYS.dutySlots).filter((slot) => {
    const slotDate = normalizeDateToDateString(slot.date_assigned);
    return slotDate === dateStr && slot.duty_type_id === dutyTypeId;
  });
}

/**
 * Calculate duty score for a personnel from duty_slots.
 * Counts slots with status 'scheduled', 'approved', or 'completed'.
 * This gives an accurate score based on the current organization's data.
 */
export function calculateDutyScoreFromSlots(personnelId: string): number {
  const slots = getFromStorage<DutySlot>(KEYS.dutySlots);
  // Count scheduled, approved, and completed duties toward the score
  const relevantSlots = slots.filter(
    slot => slot.personnel_id === personnelId &&
            (slot.status === 'scheduled' || slot.status === 'approved' || slot.status === 'completed')
  );
  return relevantSlots.reduce((sum, slot) => sum + (slot.points || 0), 0);
}

/**
 * Get duty slots for a personnel that count toward their score.
 * Returns slots with status 'scheduled', 'approved', or 'completed'.
 */
export function getDutySlotsForScore(personnelId: string): DutySlot[] {
  const slots = getFromStorage<DutySlot>(KEYS.dutySlots);
  // Sort descending by date string (most recent first)
  return slots.filter(
    slot => slot.personnel_id === personnelId &&
            (slot.status === 'scheduled' || slot.status === 'approved' || slot.status === 'completed')
  ).sort((a, b) => b.date_assigned.localeCompare(a.date_assigned));
}

export function createDutySlot(slot: DutySlot): DutySlot {
  const slots = getFromStorage<DutySlot>(KEYS.dutySlots);
  slots.push(slot);
  saveToStorage(KEYS.dutySlots, slots);
  triggerAutoSave('dutyRoster');

  // Sync to Supabase in background using ID mapping
  // We need to look up by unique fields since local IDs may not match Supabase IDs
  const dutyType = getDutyTypeById(slot.duty_type_id);
  if (!dutyType) {
    console.warn("[Supabase Sync] createDutySlot: Duty type not found", { dutyTypeId: slot.duty_type_id });
    return slot;
  }

  // Get personnel to get their service_id for lookup
  const personnel = getPersonnelById(slot.personnel_id);
  if (!personnel) {
    console.warn("[Supabase Sync] createDutySlot: Personnel not found", { personnelId: slot.personnel_id });
    return slot;
  }

  // Get RUC code - try unit hierarchy first, fall back to current session RUC
  const unit = getUnitSectionById(dutyType.unit_section_id);
  const rucCode = unit?.ruc || getRucCodeFromUnitHierarchy(dutyType.unit_section_id) || getCurrentRuc();
  if (!rucCode) {
    console.warn("[Supabase Sync] createDutySlot: RUC code not found", {
      unitId: dutyType.unit_section_id,
      dutyTypeId: slot.duty_type_id,
      hint: "No RUC in unit hierarchy and no current session RUC"
    });
    return slot;
  }

  // date_assigned is already a DateString
  const dateStr = slot.date_assigned;

  if (process.env.NODE_ENV === "development") {
    console.log("[Supabase Sync] createDutySlot: Syncing slot to Supabase with mapping", {
      slotId: slot.id,
      rucCode,
      dutyTypeName: dutyType.duty_name,
      personnelServiceId: personnel.service_id,
      date: dateStr
    });
  }

  // Use the mapping function that looks up by unique fields
  // Only pass assigned_by if it's a valid UUID (localStorage may have "admin" or other non-UUID values)
  const validAssignedBy = isValidUUID(slot.assigned_by) ? slot.assigned_by : undefined;

  syncToSupabase(
    () => supabaseCreateDutySlotWithMapping(
      rucCode,
      dutyType.duty_name,
      personnel.service_id,
      dateStr,
      validAssignedBy,
      slot.points
    ),
    "createDutySlot"
  );

  return slot;
}

// Helper to get RUC code by traversing unit hierarchy
function getRucCodeFromUnitHierarchy(unitId: string): string | null {
  const units = getFromStorage<UnitSection>(KEYS.units);
  let currentUnit = units.find(u => u.id === unitId);

  if (process.env.NODE_ENV === 'development') {
    console.log("[getRucCodeFromUnitHierarchy] DEBUG: Starting search for unitId:", unitId);
    console.log("[getRucCodeFromUnitHierarchy] DEBUG: Found unit:", currentUnit ? { id: currentUnit.id, name: currentUnit.unit_name, ruc: currentUnit.ruc } : null);
  }

  // Traverse up the hierarchy looking for a unit with a RUC code
  while (currentUnit) {
    if (currentUnit.ruc) {
      if (process.env.NODE_ENV === 'development') {
        console.log("[getRucCodeFromUnitHierarchy] DEBUG: Found RUC:", currentUnit.ruc, "on unit:", currentUnit.unit_name);
      }
      return currentUnit.ruc;
    }
    if (!currentUnit.parent_id) {
      if (process.env.NODE_ENV === 'development') {
        console.log("[getRucCodeFromUnitHierarchy] DEBUG: No parent_id, stopping at unit:", currentUnit.unit_name);
      }
      break;
    }
    const parentUnit = units.find(u => u.id === currentUnit!.parent_id);
    if (process.env.NODE_ENV === 'development') {
      console.log("[getRucCodeFromUnitHierarchy] DEBUG: Traversing to parent:", parentUnit ? { id: parentUnit.id, name: parentUnit.unit_name, ruc: parentUnit.ruc } : null);
    }
    currentUnit = parentUnit;
  }

  if (process.env.NODE_ENV === 'development') {
    console.log("[getRucCodeFromUnitHierarchy] DEBUG: No RUC found in hierarchy");
  }
  return null;
}

export function updateDutySlot(id: string, updates: Partial<DutySlot>): DutySlot | null {
  const slots = getFromStorage<DutySlot>(KEYS.dutySlots);
  const idx = slots.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  slots[idx] = { ...slots[idx], ...updates, updated_at: new Date() };
  saveToStorage(KEYS.dutySlots, slots);
  triggerAutoSave('dutyRoster');

  // Sync to Supabase in background
  const supabaseUpdates: Record<string, unknown> = {};
  if (updates.personnel_id !== undefined) supabaseUpdates.personnel_id = updates.personnel_id;
  if (updates.status !== undefined) supabaseUpdates.status = updates.status;
  if (updates.date_assigned !== undefined) {
    supabaseUpdates.date_assigned = updates.date_assigned; // Already a DateString
  }
  if (Object.keys(supabaseUpdates).length > 0) {
    syncToSupabase(() => supabaseUpdateDutySlot(id, supabaseUpdates), "updateDutySlot");
  }

  return slots[idx];
}

/**
 * Mark a single duty slot as completed.
 * Only allowed if the duty date has passed (is before today).
 */
export function markDutyAsCompleted(slotId: string): { success: boolean; error?: string } {
  const today = getTodayString();
  const slots = getFromStorage<DutySlot>(KEYS.dutySlots);
  const slot = slots.find(s => s.id === slotId);

  if (!slot) {
    return { success: false, error: "Duty slot not found" };
  }

  // Only allow completion if date has passed
  if (slot.date_assigned >= today) {
    return { success: false, error: "Cannot mark future or current day duties as completed" };
  }

  // Only allow completion of scheduled or approved duties
  if (slot.status !== 'scheduled' && slot.status !== 'approved') {
    return { success: false, error: `Duty is already ${slot.status}` };
  }

  const updated = updateDutySlot(slotId, { status: 'completed' });
  if (updated) {
    return { success: true };
  }
  return { success: false, error: "Failed to update duty slot" };
}

/**
 * Auto-complete all past duties that are still scheduled or approved.
 * Called when data is loaded to ensure past duties are marked completed.
 * Returns the number of duties that were marked as completed.
 */
export function autoCompletePastDuties(): number {
  const today = getTodayString();
  const slots = getFromStorage<DutySlot>(KEYS.dutySlots);

  let completedCount = 0;
  const updatedSlots = slots.map(slot => {
    // Only auto-complete if:
    // 1. Date is in the past (before today)
    // 2. Status is 'scheduled' or 'approved'
    // 3. Slot has a personnel assigned
    if (
      slot.date_assigned < today &&
      (slot.status === 'scheduled' || slot.status === 'approved') &&
      slot.personnel_id
    ) {
      completedCount++;
      return { ...slot, status: 'completed' as const, updated_at: new Date() };
    }
    return slot;
  });

  if (completedCount > 0) {
    saveToStorage(KEYS.dutySlots, updatedSlots);
    console.log(`[AutoComplete] Marked ${completedCount} past duties as completed`);

    // Sync completed status to Supabase for each updated slot
    updatedSlots
      .filter(slot => slot.date_assigned < today && slot.status === 'completed')
      .forEach(slot => {
        syncToSupabase(
          () => supabaseUpdateDutySlot(slot.id, { status: 'completed' }),
          "autoCompleteDuty"
        );
      });
  }

  return completedCount;
}

export function deleteDutySlot(id: string): boolean {
  const slots = getFromStorage<DutySlot>(KEYS.dutySlots);

  // Find the slot before deleting so we can sync to Supabase using unique fields
  const slotToDelete = slots.find((s) => s.id === id);
  if (!slotToDelete) return false;

  const filtered = slots.filter((s) => s.id !== id);
  saveToStorage(KEYS.dutySlots, filtered);
  triggerAutoSave('dutyRoster');

  // Sync to Supabase using mapping (unique fields) since local IDs may not match Supabase IDs
  const dutyType = getDutyTypeById(slotToDelete.duty_type_id);
  const personnel = getPersonnelById(slotToDelete.personnel_id);
  const rucCode = dutyType ? getRucCodeFromUnitHierarchy(dutyType.unit_section_id) || getCurrentRuc() : null;

  if (dutyType && personnel && rucCode) {
    // date_assigned is already a DateString
    syncToSupabase(
      () => supabaseDeleteDutySlotWithMapping(
        rucCode,
        dutyType.duty_name,
        personnel.service_id,
        slotToDelete.date_assigned
      ),
      "deleteDutySlot"
    );
  } else {
    // Fallback to ID-based delete if we can't get all required info for mapping
    syncToSupabase(() => supabaseDeleteDutySlot(id), "deleteDutySlot");
  }

  return true;
}

export function clearDutySlotsInRange(startDate: DateString, endDate: DateString, unitId?: string): number {
  const slots = getFromStorage<DutySlot>(KEYS.dutySlots);
  let count = 0;
  const filtered = slots.filter((slot) => {
    // Simple string comparison - timezone safe with DateString
    const inRange = slot.date_assigned >= startDate && slot.date_assigned <= endDate;
    if (!inRange) return true;
    if (unitId) {
      const dutyType = getDutyTypeById(slot.duty_type_id);
      if (dutyType?.unit_section_id !== unitId) return true;
    }
    count++;
    return false;
  });
  saveToStorage(KEYS.dutySlots, filtered);
  if (count > 0) {
    triggerAutoSave('dutyRoster');

    // Sync to Supabase in background
    if (unitId) {
      const orgId = getOrganizationIdFromUnit(unitId);
      if (orgId) {
        syncToSupabase(
          () => supabaseDeleteDutySlotsInRange(
            orgId,
            startDate,
            endDate,
            unitId
          ),
          "clearDutySlotsInRange"
        );
      }
    }
  }
  return count;
}

export function clearDutySlotsByDutyType(dutyTypeId: string, startDate: DateString, endDate: DateString): number {
  const slots = getFromStorage<DutySlot>(KEYS.dutySlots);
  let count = 0;
  const filtered = slots.filter((slot) => {
    // Keep slots that don't match this duty type
    if (slot.duty_type_id !== dutyTypeId) return true;
    // Simple string comparison - timezone safe with DateString
    const inRange = slot.date_assigned >= startDate && slot.date_assigned <= endDate;
    if (!inRange) return true;
    // This slot matches - remove it
    count++;
    return false;
  });
  saveToStorage(KEYS.dutySlots, filtered);

  if (count > 0) {
    triggerAutoSave('dutyRoster');

    // Sync to Supabase using mapping
    const dutyType = getDutyTypeById(dutyTypeId);
    if (dutyType) {
      const rucCode = getRucCodeFromUnitHierarchy(dutyType.unit_section_id) || getCurrentRuc();
      if (rucCode) {
        syncToSupabase(
          () => supabaseDeleteDutySlotsByDutyTypeWithMapping(
            rucCode,
            dutyType.duty_name,
            startDate,
            endDate
          ),
          "clearDutySlotsByDutyType"
        );
      } else {
        console.error(`[clearDutySlotsByDutyType] Could not sync deletion to Supabase: RUC code not found for duty type ${dutyTypeId}`);
      }
    } else {
      console.error(`[clearDutySlotsByDutyType] Could not sync deletion to Supabase: Duty type ${dutyTypeId} not found`);
    }
  }

  return count;
}

// ============================================================================
// SUPERNUMERARY ASSIGNMENTS
// ============================================================================

export function getAllSupernumeraryAssignments(): SupernumeraryAssignment[] {
  return getFromStorage<SupernumeraryAssignment>(KEYS.supernumeraryAssignments);
}

export function getSupernumeraryAssignmentById(id: string): SupernumeraryAssignment | undefined {
  return getAllSupernumeraryAssignments().find((sa) => sa.id === id);
}

export function getSupernumeraryAssignmentsByDutyType(dutyTypeId: string): SupernumeraryAssignment[] {
  return getAllSupernumeraryAssignments().filter((sa) => sa.duty_type_id === dutyTypeId);
}

export function getSupernumeraryAssignmentsByOrganization(organizationId: string): SupernumeraryAssignment[] {
  return getAllSupernumeraryAssignments().filter((sa) => sa.organization_id === organizationId);
}

export function getSupernumeraryAssignmentsByPersonnel(personnelId: string): SupernumeraryAssignment[] {
  return getAllSupernumeraryAssignments().filter((sa) => sa.personnel_id === personnelId);
}

// Get active supernumerary assignments for a date (within period_start and period_end)
export function getActiveSupernumeraryAssignments(dateStr: DateString): SupernumeraryAssignment[] {
  return getAllSupernumeraryAssignments().filter((sa) =>
    sa.period_start <= dateStr && sa.period_end >= dateStr
  );
}

// Get supernumerary assignments that overlap with a date range
// An assignment overlaps if its period intersects with the given range
export function getSupernumeraryAssignmentsInRange(startDate: DateString, endDate: DateString): SupernumeraryAssignment[] {
  return getAllSupernumeraryAssignments().filter((sa) =>
    // Assignment overlaps if: assignment starts before range ends AND assignment ends after range starts
    sa.period_start <= endDate && sa.period_end >= startDate
  );
}

// Get active supernumerary for a specific duty type on a date
export function getActiveSupernumeraryForDutyType(dutyTypeId: string, dateStr: DateString): SupernumeraryAssignment[] {
  return getAllSupernumeraryAssignments().filter((sa) =>
    sa.duty_type_id === dutyTypeId &&
    sa.period_start <= dateStr &&
    sa.period_end >= dateStr
  );
}

export function createSupernumeraryAssignment(assignment: SupernumeraryAssignment): SupernumeraryAssignment {
  const assignments = getAllSupernumeraryAssignments();
  assignments.push(assignment);
  saveToStorage(KEYS.supernumeraryAssignments, assignments);
  triggerAutoSave('supernumeraryAssignments');

  // Sync to Supabase (fire-and-forget)
  supabaseCreateSupernumeraryAssignment(
    assignment.organization_id,
    assignment.duty_type_id,
    assignment.personnel_id,
    assignment.period_start,
    assignment.period_end,
    assignment.id
  ).catch((err) => console.error("Failed to sync supernumerary to Supabase:", err));

  return assignment;
}

export function updateSupernumeraryAssignment(
  id: string,
  updates: Partial<SupernumeraryAssignment>
): SupernumeraryAssignment | null {
  const assignments = getAllSupernumeraryAssignments();
  const idx = assignments.findIndex((sa) => sa.id === id);
  if (idx === -1) return null;

  const updated = { ...assignments[idx], ...updates, updated_at: new Date() };
  assignments[idx] = updated;
  saveToStorage(KEYS.supernumeraryAssignments, assignments);
  triggerAutoSave('supernumeraryAssignments');

  // Sync to Supabase (fire-and-forget) - convert Date to string for Supabase
  const supabaseUpdates: Record<string, unknown> = { ...updates };
  if (supabaseUpdates.created_at instanceof Date) {
    supabaseUpdates.created_at = (supabaseUpdates.created_at as Date).toISOString();
  }
  if (supabaseUpdates.updated_at instanceof Date) {
    supabaseUpdates.updated_at = (supabaseUpdates.updated_at as Date).toISOString();
  }
  supabaseUpdateSupernumeraryAssignment(id, supabaseUpdates)
    .catch((err) => console.error("Failed to sync supernumerary update to Supabase:", err));

  return updated;
}

export function deleteSupernumeraryAssignment(id: string): boolean {
  const assignments = getAllSupernumeraryAssignments();
  const filtered = assignments.filter((sa) => sa.id !== id);
  if (filtered.length === assignments.length) return false;

  saveToStorage(KEYS.supernumeraryAssignments, filtered);
  triggerAutoSave('supernumeraryAssignments');

  // Sync to Supabase (fire-and-forget)
  supabaseDeleteSupernumeraryAssignment(id)
    .catch((err) => console.error("Failed to sync supernumerary delete to Supabase:", err));

  return true;
}

// Increment activation count when supernumerary is activated for a duty
export function incrementSupernumeraryActivation(id: string): SupernumeraryAssignment | null {
  const assignment = getSupernumeraryAssignmentById(id);
  if (!assignment) return null;

  return updateSupernumeraryAssignment(id, {
    activation_count: assignment.activation_count + 1,
  });
}

// Clear supernumerary assignments for a date range and duty type
export function clearSupernumeraryAssignmentsByDutyType(
  dutyTypeId: string,
  startDate: DateString,
  endDate: DateString
): number {
  const assignments = getAllSupernumeraryAssignments();
  let count = 0;
  const filtered = assignments.filter((sa) => {
    if (sa.duty_type_id !== dutyTypeId) return true;
    // Check if period overlaps with the date range
    const overlaps = sa.period_start <= endDate && sa.period_end >= startDate;
    if (!overlaps) return true;
    count++;
    return false;
  });

  if (count > 0) {
    saveToStorage(KEYS.supernumeraryAssignments, filtered);
    triggerAutoSave('supernumeraryAssignments');

    // Sync to Supabase (fire-and-forget)
    supabaseDeleteSupernumeraryAssignmentsByDutyType(dutyTypeId, startDate, endDate)
      .catch((err) => console.error("Failed to sync supernumerary bulk delete to Supabase:", err));
  }

  return count;
}

// ============ Duty Slots Migration to Supabase ============

/**
 * Migrate duty slots from localStorage to Supabase by mapping IDs to unique fields.
 * This function looks up personnel by service_id and duty types by name.
 * Use this when localStorage IDs don't match Supabase IDs.
 *
 * Call from browser console: window.migrateDutySlotsToSupabase()
 */
export async function migrateDutySlotsToSupabase(rucCode?: string): Promise<{
  total: number;
  migrated: number;
  errors: string[];
}> {
  const result = { total: 0, migrated: 0, errors: [] as string[] };

  // Get duty slots from localStorage
  const dutySlots = getFromStorage<DutySlot>(KEYS.dutySlots);
  result.total = dutySlots.length;

  if (dutySlots.length === 0) {
    result.errors.push("No duty slots found in localStorage");
    return result;
  }

  console.log(`[Migration] Found ${dutySlots.length} duty slots in localStorage`);

  // Get all personnel and duty types from localStorage for mapping
  const personnel = getFromStorage<Personnel>(KEYS.personnel);
  const dutyTypes = getFromStorage<DutyType>(KEYS.dutyTypes);
  const units = getFromStorage<UnitSection>(KEYS.units);

  // Build lookup maps
  const personnelById = new Map<string, Personnel>();
  personnel.forEach(p => personnelById.set(p.id, p));

  const dutyTypeById = new Map<string, DutyType>();
  dutyTypes.forEach(dt => dutyTypeById.set(dt.id, dt));

  // Map unit to RUC code (look for ruc property or parent unit's ruc)
  const unitToRuc = new Map<string, string>();
  units.forEach(u => {
    if (u.ruc) {
      unitToRuc.set(u.id, u.ruc);
    }
  });

  // Determine RUC code - use provided one or try to find from units
  let targetRuc = rucCode;
  if (!targetRuc) {
    // Try to find a RUC from the units
    const rucValues = [...unitToRuc.values()];
    if (rucValues.length > 0) {
      targetRuc = rucValues[0];
    } else {
      result.errors.push("No RUC code provided and couldn't find one in localStorage. Pass a RUC code as parameter.");
      return result;
    }
  }

  console.log(`[Migration] Using RUC code: ${targetRuc}`);

  // Build migration data
  const migrationSlots: Array<{
    rucCode: string;
    dutyTypeName: string;
    personnelServiceId: string;
    dateAssigned: string;
    assignedBy?: string;
    points?: number;
  }> = [];

  for (const slot of dutySlots) {
    const person = personnelById.get(slot.personnel_id);
    const dutyType = dutyTypeById.get(slot.duty_type_id);

    if (!person) {
      result.errors.push(`Slot ${slot.id}: Personnel ${slot.personnel_id} not found in localStorage`);
      continue;
    }

    if (!dutyType) {
      result.errors.push(`Slot ${slot.id}: Duty type ${slot.duty_type_id} not found in localStorage`);
      continue;
    }

    migrationSlots.push({
      rucCode: targetRuc,
      dutyTypeName: dutyType.duty_name,
      personnelServiceId: person.service_id,
      dateAssigned: slot.date_assigned, // Already a DateString
      assignedBy: slot.assigned_by || undefined,
      points: slot.points,
    });
  }

  console.log(`[Migration] Prepared ${migrationSlots.length} slots for migration`);

  if (migrationSlots.length === 0) {
    result.errors.push("No valid slots to migrate");
    return result;
  }

  // Call the Supabase migration function
  const migrationResult = await supabaseCreateDutySlotsWithMapping(migrationSlots);
  result.migrated = migrationResult.created;
  result.errors.push(...migrationResult.errors);

  console.log(`[Migration] Complete! ${result.migrated}/${result.total} slots migrated`);
  if (result.errors.length > 0) {
    console.log(`[Migration] Errors:`, result.errors.slice(0, 10));
    if (result.errors.length > 10) {
      console.log(`[Migration] ... and ${result.errors.length - 10} more errors`);
    }
  }

  return result;
}

// Expose migration function on window for console access
if (typeof window !== "undefined") {
  (window as unknown as { migrateDutySlotsToSupabase: typeof migrateDutySlotsToSupabase }).migrateDutySlotsToSupabase = migrateDutySlotsToSupabase;
}

// ============ Roster Approval ============

export interface ApprovedRoster {
  id: string;
  unit_id: string;
  year: number;
  month: number; // 0-11 (JavaScript month format)
  approved_by: string;
  approved_at: Date;
  scores_applied: boolean;
}

// Get all approved rosters
export function getAllApprovedRosters(): ApprovedRoster[] {
  return getFromStorage<ApprovedRoster>(KEYS.approvedRosters);
}

// Check if a roster for a specific unit/month is approved
export function isRosterApproved(unitId: string, year: number, month: number): ApprovedRoster | null {
  const approvals = getFromStorage<ApprovedRoster>(KEYS.approvedRosters);
  return approvals.find(
    (a) => a.unit_id === unitId && a.year === year && a.month === month
  ) || null;
}

// Sync status tracking for roster approval
export interface ApprovalSyncStatus {
  slotsUpdated: number;
  slotsNotFound: number; // Slots that don't exist in Supabase yet
  slotErrors: string[];
  scoresUpdated: number;
  scoreErrors: string[];
  allSynced: boolean;
}

// Approve a roster and apply duty scores to personnel
export async function approveRoster(
  unitId: string,
  year: number,
  month: number,
  approvedBy: string
): Promise<{ approval: ApprovedRoster; scoresApplied: number; eventsCreated: number; syncStatus: ApprovalSyncStatus }> {
  // Check if already approved
  const existing = isRosterApproved(unitId, year, month);
  if (existing) {
    throw new Error("This roster has already been approved.");
  }

  // Format roster month for score events (YYYY-MM)
  const rosterMonth = `${year}-${String(month + 1).padStart(2, "0")}`;

  // Get the date range for the month (use string comparison to avoid timezone issues)
  const startDate = new Date(year, month, 1);
  const endDate = new Date(year, month + 1, 0); // Last day of month
  const startDateStr = formatDateToString(startDate);
  const endDateStr = formatDateToString(endDate);

  // Get all duty slots for this month
  // Note: We match slots by duty_type_id existence, not by unit hierarchy
  // The Unit Admin role already controls access - if they can see the roster, they can approve it
  const allSlots = getFromStorage<DutySlot>(KEYS.dutySlots);
  const dutyTypes = getAllDutyTypes();
  const dutyTypesById = new Map(dutyTypes.map((dt) => [dt.id, dt]));

  // Get all duty type IDs that exist in localStorage (for matching slots)
  const allDutyTypeIds = new Set(dutyTypes.map((dt) => dt.id));


  // Filter slots by date range AND by whether their duty type exists in localStorage
  const monthSlots = allSlots.filter((slot) => {
    // Use string comparison to avoid timezone issues with date parsing
    const dateValue = slot.date_assigned as unknown;
    const slotDateStr = dateValue instanceof Date
      ? formatDateToString(dateValue)
      : String(dateValue).split('T')[0];  // Handle ISO date strings

    // Match if: in date range AND duty type exists in localStorage
    return (
      slotDateStr >= startDateStr &&
      slotDateStr <= endDateStr &&
      allDutyTypeIds.has(slot.duty_type_id)
    );
  });


  // Create duty score events and calculate personnel totals
  const personnelScores = new Map<string, number>();
  const scoreEvents: DutyScoreEvent[] = [];

  for (const slot of monthSlots) {
    if (!slot.personnel_id) continue;

    // Get duty type info
    const dutyType = dutyTypesById.get(slot.duty_type_id);
    if (!dutyType) continue;

    // Get duty value for this duty type
    const dutyValue = getDutyValueByDutyType(slot.duty_type_id);
    const baseWeight = dutyValue?.base_weight ?? 1;
    const weekendMultiplier = dutyValue?.weekend_multiplier ?? DEFAULT_WEEKEND_MULTIPLIER;
    const holidayMultiplier = dutyValue?.holiday_multiplier ?? DEFAULT_HOLIDAY_MULTIPLIER;

    // Calculate points using string-based date utilities (holiday takes precedence over weekend)
    let points = baseWeight;
    if (isHolidayStr(slot.date_assigned)) {
      points = baseWeight * holidayMultiplier;
    } else if (isWeekendStr(slot.date_assigned)) {
      points = baseWeight * weekendMultiplier;
    }

    // Create score event for this duty
    const event: DutyScoreEvent = {
      id: crypto.randomUUID(),
      personnel_id: slot.personnel_id,
      duty_slot_id: slot.id,
      unit_section_id: dutyType.unit_section_id,
      duty_type_name: dutyType.duty_name,
      points,
      date_earned: slot.date_assigned, // Already a DateString
      roster_month: rosterMonth,
      approved_by: approvedBy,
      created_at: new Date(),
    };
    scoreEvents.push(event);

    // Add to personnel's total for cached score update
    const currentTotal = personnelScores.get(slot.personnel_id) || 0;
    personnelScores.set(slot.personnel_id, currentTotal + points);
  }

  // Save all score events
  const eventsCreated = createDutyScoreEvents(scoreEvents);

  // Update slot status to "approved" for all slots in this roster
  // monthSlots contains references to objects in allSlots, so we can update them directly
  for (const slot of monthSlots) {
    slot.status = "approved";
    slot.updated_at = new Date();
  }
  saveToStorage(KEYS.dutySlots, allSlots);
  triggerAutoSave('dutySlots');

  // Initialize sync status tracking
  const syncStatus: ApprovalSyncStatus = {
    slotsUpdated: 0,
    slotsNotFound: 0,
    slotErrors: [],
    scoresUpdated: 0,
    scoreErrors: [],
    allSynced: true,
  };

  // Sync slot status updates to Supabase using mapping (local IDs may differ from Supabase IDs)
  // Get RUC from unit hierarchy first, fallback to session RUC
  const rucCode = getRucCodeFromUnitHierarchy(unitId) || validateRucForSync("approveRoster-slots", monthSlots.length);

  if (rucCode) {
    const personnelById = new Map(getAllPersonnel().map(p => [p.id, p]));

    const slotsToUpdate = monthSlots
      .filter(slot => slot.personnel_id)
      .map(slot => {
        const dutyType = dutyTypesById.get(slot.duty_type_id);
        const person = personnelById.get(slot.personnel_id);
        return {
          dutyTypeName: dutyType?.duty_name || "",
          personnelServiceId: person?.service_id || "",
          dateAssigned: slot.date_assigned,
        };
      })
      .filter(s => s.dutyTypeName && s.personnelServiceId);

    if (slotsToUpdate.length > 0) {
      try {
        const result = await supabaseUpdateDutySlotsStatusWithMapping(rucCode, slotsToUpdate, "approved");
        syncStatus.slotsUpdated = result.updated;
        syncStatus.slotsNotFound = result.notFound;
        syncStatus.slotErrors = result.errors;

        if (result.errors.length > 0 || result.updated < slotsToUpdate.length) {
          syncStatus.allSynced = false;
        }
        logSyncOperation("SYNC", "approveSlotStatuses", result.errors.length === 0 && result.notFound === 0, `${result.updated}/${slotsToUpdate.length} slots${result.notFound > 0 ? `, ${result.notFound} not found` : ''}`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        syncStatus.slotErrors.push(`Sync failed: ${errorMsg}`);
        syncStatus.allSynced = false;
        recordSyncError(`approveSlotStatuses: ${errorMsg}`);
      }
    }
  } else if (isSupabaseConfigured()) {
    syncStatus.allSynced = false;
    syncStatus.slotErrors.push("No RUC code available for sync");
  }

  // Update cached scores on personnel records (for quick lookups)
  // This recalculates the entire score from events for accuracy
  const personnel = getFromStorage<Personnel>(KEYS.personnel);
  let scoresApplied = 0;
  const updatedPersonnelScores: { serviceId: string; newScore: number }[] = [];

  for (const [personnelId, points] of personnelScores) {
    const idx = personnel.findIndex((p) => p.id === personnelId);
    if (idx !== -1) {
      // Add points to existing score (events track the history)
      const newScore = (personnel[idx].current_duty_score || 0) + points;
      personnel[idx].current_duty_score = newScore;
      personnel[idx].updated_at = new Date();
      scoresApplied++;
      // Track by service_id for Supabase sync (local IDs may differ from Supabase IDs)
      updatedPersonnelScores.push({ serviceId: personnel[idx].service_id, newScore });
    }
  }

  saveToStorage(KEYS.personnel, personnel);
  if (scoresApplied > 0) {
    triggerAutoSave('unitMembers');

    // Sync personnel scores to Supabase - await all updates in parallel
    // Use service_id for lookup since local IDs may differ from Supabase IDs
    // Re-use rucCode from earlier to avoid redundant check and ensure correct org context
    if (rucCode && isSupabaseConfigured()) {
      if (process.env.NODE_ENV === 'development') {
        console.log("[approveRoster] DEBUG: Syncing personnel scores with rucCode:", rucCode);
      }
      const scorePromises = updatedPersonnelScores.map(async ({ serviceId, newScore }) => {
        try {
          const success = await supabaseUpdatePersonnelByServiceId(rucCode, serviceId, { current_duty_score: newScore });
          if (success) {
            syncStatus.scoresUpdated++;
            return { success: true, serviceId };
          } else {
            syncStatus.scoreErrors.push(`Failed to update score for personnel ${serviceId}`);
            return { success: false, serviceId };
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          syncStatus.scoreErrors.push(`Personnel ${serviceId}: ${errorMsg}`);
          return { success: false, serviceId };
        }
      });

      // Wait for all score updates to complete
      const results = await Promise.all(scorePromises);
      const failedCount = results.filter(r => !r.success).length;
      if (failedCount > 0) {
        syncStatus.allSynced = false;
        console.warn(`[approveRoster] Score sync incomplete: ${syncStatus.scoresUpdated}/${updatedPersonnelScores.length} updated`);
      }
      logSyncOperation("SYNC", "approvePersonnelScores", failedCount === 0, `${syncStatus.scoresUpdated}/${updatedPersonnelScores.length} scores`);
    } else if (isSupabaseConfigured()) {
      syncStatus.allSynced = false;
      syncStatus.scoreErrors.push("No RUC code available for score sync");
    }
  }

  // Create approval record
  const approval: ApprovedRoster = {
    id: crypto.randomUUID(),
    unit_id: unitId,
    year,
    month,
    approved_by: approvedBy,
    approved_at: new Date(),
    scores_applied: true,
  };

  const approvals = getFromStorage<ApprovedRoster>(KEYS.approvedRosters);
  approvals.push(approval);
  saveToStorage(KEYS.approvedRosters, approvals);
  triggerAutoSave('approvedRosters');

  // Notify listeners that personnel and duty slots have changed
  // This triggers dashboard refresh for any listening components
  notifyDataChanged(["personnel", "dutySlots"]);

  return { approval, scoresApplied, eventsCreated, syncStatus };
}

// Unapprove a roster (for corrections - does NOT reverse scores)
export function unapproveRoster(unitId: string, year: number, month: number): boolean {
  const approvals = getFromStorage<ApprovedRoster>(KEYS.approvedRosters);
  const filtered = approvals.filter(
    (a) => !(a.unit_id === unitId && a.year === year && a.month === month)
  );
  if (filtered.length === approvals.length) return false;
  saveToStorage(KEYS.approvedRosters, filtered);
  triggerAutoSave('approvedRosters');

  // Revert slot status from "approved" back to "scheduled"
  const startDate = new Date(year, month, 1);
  const endDate = new Date(year, month + 1, 0);
  const startDateStr = formatDateToString(startDate);
  const endDateStr = formatDateToString(endDate);

  const allSlots = getFromStorage<DutySlot>(KEYS.dutySlots);
  const dutyTypes = getAllDutyTypes();
  const dutyTypesById = new Map(dutyTypes.map((dt) => [dt.id, dt]));

  // Get all duty type IDs that exist in localStorage (for matching slots)
  // We match by duty type existence, not unit hierarchy (same as approveRoster)
  const allDutyTypeIds = new Set(dutyTypes.map((dt) => dt.id));

  interface SlotToRevert {
    id: string;
    duty_type_id: string;
    personnel_id: string;
    date_assigned: DateString;
  }
  const slotsToRevert: SlotToRevert[] = [];
  for (let i = 0; i < allSlots.length; i++) {
    const slot = allSlots[i];
    const dateValue = slot.date_assigned as unknown;
    const slotDateStr = dateValue instanceof Date
      ? formatDateToString(dateValue)
      : String(dateValue).split('T')[0];

    if (
      slotDateStr >= startDateStr &&
      slotDateStr <= endDateStr &&
      allDutyTypeIds.has(slot.duty_type_id) &&
      slot.status === "approved"
    ) {
      allSlots[i].status = "scheduled";
      allSlots[i].updated_at = new Date();
      slotsToRevert.push({
        id: slot.id,
        duty_type_id: slot.duty_type_id,
        personnel_id: slot.personnel_id,
        date_assigned: slot.date_assigned,
      });
    }
  }

  if (slotsToRevert.length > 0) {
    saveToStorage(KEYS.dutySlots, allSlots);
    triggerAutoSave('dutySlots');

    // Sync slot status updates to Supabase using mapping (local IDs may differ from Supabase IDs)
    const rucCode = validateRucForSync("unapproveRoster", slotsToRevert.length);
    if (rucCode) {
      const personnelById = new Map(getAllPersonnel().map(p => [p.id, p]));
      const mappedSlots = slotsToRevert
        .filter(slot => slot.personnel_id)
        .map(slot => {
          const dutyType = dutyTypesById.get(slot.duty_type_id);
          const person = personnelById.get(slot.personnel_id);
          return {
            dutyTypeName: dutyType?.duty_name || "",
            personnelServiceId: person?.service_id || "",
            dateAssigned: slot.date_assigned, // Already a DateString
          };
        })
        .filter(s => s.dutyTypeName && s.personnelServiceId);

      if (mappedSlots.length > 0) {
        syncToSupabase(
          () => supabaseUpdateDutySlotsStatusWithMapping(rucCode, mappedSlots, "scheduled"),
          "revertSlotStatuses"
        );
      }
    }

    // Notify listeners that duty slots have changed
    notifyDataChanged(["dutySlots"]);
  }

  return true;
}

// ============ Duty Score Events ============
// Historical tracking of duty points earned

// Get all duty score events
export function getAllDutyScoreEvents(): DutyScoreEvent[] {
  // Sort descending by date string (most recent first)
  return getFromStorage<DutyScoreEvent>(KEYS.dutyScoreEvents).sort(
    (a, b) => b.date_earned.localeCompare(a.date_earned)
  );
}

// Get score events for a specific personnel
export function getScoreEventsByPersonnel(personnelId: string): DutyScoreEvent[] {
  return getFromStorage<DutyScoreEvent>(KEYS.dutyScoreEvents)
    .filter((e) => e.personnel_id === personnelId)
    .sort((a, b) => new Date(b.date_earned).getTime() - new Date(a.date_earned).getTime());
}

// Get score events for a roster month
export function getScoreEventsByRosterMonth(rosterMonth: string): DutyScoreEvent[] {
  return getFromStorage<DutyScoreEvent>(KEYS.dutyScoreEvents)
    .filter((e) => e.roster_month === rosterMonth)
    .sort((a, b) => new Date(a.date_earned).getTime() - new Date(b.date_earned).getTime());
}

// Create a duty score event
export function createDutyScoreEvent(event: DutyScoreEvent): DutyScoreEvent {
  const events = getFromStorage<DutyScoreEvent>(KEYS.dutyScoreEvents);
  events.push(event);
  saveToStorage(KEYS.dutyScoreEvents, events);
  triggerAutoSave('dutyScoreEvents');
  return event;
}

// Create multiple duty score events (batch insert)
export function createDutyScoreEvents(newEvents: DutyScoreEvent[]): number {
  if (newEvents.length === 0) return 0;
  const events = getFromStorage<DutyScoreEvent>(KEYS.dutyScoreEvents);
  events.push(...newEvents);
  saveToStorage(KEYS.dutyScoreEvents, events);
  triggerAutoSave('dutyScoreEvents');

  // Get RUC code for Supabase sync with validation
  const rucCode = validateRucForSync("createDutyScoreEvents", newEvents.length);
  if (!rucCode) {
    return newEvents.length;
  }

  // Build lookup maps for O(1) lookups (performance optimization)
  const personnelMap = new Map(getAllPersonnel().map(p => [p.id, p]));
  const unitMap = new Map(getUnitSections().map(u => [u.id, u]));

  // Map events with service_id and unit_name for Supabase sync
  const mappedEvents: Array<{
    personnelServiceId: string;
    dutyTypeName: string;
    unitName: string;
    points: number;
    dateEarned: string;
    rosterMonth: string;
    approvedByServiceId?: string;
  }> = [];

  for (const e of newEvents) {
    // Look up personnel to get service_id
    const personnel = personnelMap.get(e.personnel_id);
    if (!personnel) {
      console.warn(`[createDutyScoreEvents] Personnel not found: ${e.personnel_id}`);
      continue;
    }

    // Look up unit to get unit_name
    const unit = unitMap.get(e.unit_section_id);
    if (!unit) {
      console.warn(`[createDutyScoreEvents] Unit not found: ${e.unit_section_id}`);
      continue;
    }

    // Look up approver service_id if approved_by is set
    let approverServiceId: string | undefined;
    if (e.approved_by) {
      const approver = personnelMap.get(e.approved_by);
      if (approver) {
        approverServiceId = approver.service_id;
      }
    }

    mappedEvents.push({
      personnelServiceId: personnel.service_id,
      dutyTypeName: e.duty_type_name,
      unitName: unit.unit_name,
      points: e.points,
      dateEarned: formatDateToString(new Date(e.date_earned)),
      rosterMonth: e.roster_month,
      approvedByServiceId: approverServiceId,
    });
  }

  // Sync to Supabase using mapping function
  if (mappedEvents.length > 0) {
    syncToSupabase(
      () => supabaseCreateDutyScoreEventsWithMapping(rucCode, mappedEvents),
      "createDutyScoreEventsWithMapping"
    );
  }

  return newEvents.length;
}

// Delete score events for a roster month (useful if un-approving and re-approving)
export function deleteScoreEventsByRosterMonth(rosterMonth: string): number {
  const events = getFromStorage<DutyScoreEvent>(KEYS.dutyScoreEvents);
  const filtered = events.filter((e) => e.roster_month !== rosterMonth);
  const deletedCount = events.length - filtered.length;
  if (deletedCount > 0) {
    saveToStorage(KEYS.dutyScoreEvents, filtered);
    triggerAutoSave('dutyScoreEvents');
  }
  return deletedCount;
}

// Calculate personnel duty score from events within a date range
// Default: last 12 months
export function calculatePersonnelScore(
  personnelId: string,
  options?: {
    startDate?: Date;
    endDate?: Date;
    monthsBack?: number;
  }
): number {
  const events = getFromStorage<DutyScoreEvent>(KEYS.dutyScoreEvents)
    .filter((e) => e.personnel_id === personnelId);

  // Determine date range
  let startDate: Date;
  let endDate: Date = new Date();

  if (options?.startDate && options?.endDate) {
    startDate = options.startDate;
    endDate = options.endDate;
  } else {
    // Default: last 12 months
    const monthsBack = options?.monthsBack ?? 12;
    startDate = new Date();
    startDate.setMonth(startDate.getMonth() - monthsBack);
  }

  // Sum points within date range
  return events
    .filter((e) => {
      const eventDate = new Date(e.date_earned);
      return eventDate >= startDate && eventDate <= endDate;
    })
    .reduce((sum, e) => sum + e.points, 0);
}

// Calculate scores for all personnel (returns Map of personnelId -> score)
export function calculateAllPersonnelScores(
  options?: {
    startDate?: Date;
    endDate?: Date;
    monthsBack?: number;
  }
): Map<string, number> {
  const events = getFromStorage<DutyScoreEvent>(KEYS.dutyScoreEvents);

  // Determine date range
  let startDate: Date;
  let endDate: Date = new Date();

  if (options?.startDate && options?.endDate) {
    startDate = options.startDate;
    endDate = options.endDate;
  } else {
    const monthsBack = options?.monthsBack ?? 12;
    startDate = new Date();
    startDate.setMonth(startDate.getMonth() - monthsBack);
  }

  // Build scores map
  const scores = new Map<string, number>();

  for (const event of events) {
    const eventDate = new Date(event.date_earned);
    if (eventDate >= startDate && eventDate <= endDate) {
      const current = scores.get(event.personnel_id) || 0;
      scores.set(event.personnel_id, current + event.points);
    }
  }

  return scores;
}

// Get personnel score breakdown (grouped by month)
export function getPersonnelScoreBreakdown(
  personnelId: string,
  options?: { monthsBack?: number }
): { month: string; points: number; events: DutyScoreEvent[] }[] {
  const monthsBack = options?.monthsBack ?? 12;
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - monthsBack);

  const events = getFromStorage<DutyScoreEvent>(KEYS.dutyScoreEvents)
    .filter((e) => {
      if (e.personnel_id !== personnelId) return false;
      const eventDate = new Date(e.date_earned);
      return eventDate >= startDate;
    })
    .sort((a, b) => new Date(a.date_earned).getTime() - new Date(b.date_earned).getTime());

  // Group by roster_month
  const byMonth = new Map<string, DutyScoreEvent[]>();
  for (const event of events) {
    const existing = byMonth.get(event.roster_month) || [];
    existing.push(event);
    byMonth.set(event.roster_month, existing);
  }

  // Convert to array and calculate totals
  return Array.from(byMonth.entries())
    .map(([month, monthEvents]) => ({
      month,
      points: monthEvents.reduce((sum, e) => sum + e.points, 0),
      events: monthEvents,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

// Non-Availability
export function getAllNonAvailability(): NonAvailability[] {
  // String comparison works correctly for YYYY-MM-DD format
  return getFromStorage<NonAvailability>(KEYS.nonAvailability).sort(
    (a, b) => a.start_date.localeCompare(b.start_date)
  );
}

export function getNonAvailabilityByPersonnel(personnelId: string): NonAvailability[] {
  return getFromStorage<NonAvailability>(KEYS.nonAvailability).filter(
    (na) => na.personnel_id === personnelId
  );
}

export function getNonAvailabilityById(id: string): NonAvailability | undefined {
  return getFromStorage<NonAvailability>(KEYS.nonAvailability).find((na) => na.id === id);
}

export function getActiveNonAvailability(personnelId: string, dateStr: DateString): NonAvailability | undefined {
  // Simple string comparison - timezone safe with DateString
  return getFromStorage<NonAvailability>(KEYS.nonAvailability).find((na) => {
    if (na.personnel_id !== personnelId) return false;
    if (na.status !== "approved") return false;
    return dateStr >= na.start_date && dateStr <= na.end_date;
  });
}

export function createNonAvailability(na: NonAvailability): NonAvailability {
  const list = getFromStorage<NonAvailability>(KEYS.nonAvailability);
  list.push(na);
  saveToStorage(KEYS.nonAvailability, list);
  triggerAutoSave('nonAvailability');

  // Sync to Supabase in background
  const personnel = getPersonnelById(na.personnel_id);
  if (personnel) {
    const orgId = getOrganizationIdFromUnit(personnel.unit_section_id);
    if (orgId) {
      syncToSupabase(
        () => supabaseCreateNonAvailability(
          orgId,
          na.personnel_id,
          na.start_date, // Already a DateString
          na.end_date,   // Already a DateString
          {
            id: na.id,
            reason: na.reason,
            status: na.status,
            submittedBy: na.submitted_by || undefined,
            approvedBy: na.approved_by || undefined,
          }
        ),
        "createNonAvailability"
      );
    }
  }

  return na;
}

export function updateNonAvailability(id: string, updates: Partial<NonAvailability>): NonAvailability | null {
  const list = getFromStorage<NonAvailability>(KEYS.nonAvailability);
  const idx = list.findIndex((na) => na.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...updates };
  saveToStorage(KEYS.nonAvailability, list);
  triggerAutoSave('nonAvailability');

  // Sync to Supabase in background
  const supabaseUpdates: Record<string, unknown> = {};
  if (updates.start_date) supabaseUpdates.start_date = updates.start_date; // Already a DateString
  if (updates.end_date) supabaseUpdates.end_date = updates.end_date; // Already a DateString
  if (updates.reason !== undefined) supabaseUpdates.reason = updates.reason;
  if (updates.status !== undefined) supabaseUpdates.status = updates.status;
  if (updates.approved_by !== undefined) supabaseUpdates.approved_by = updates.approved_by;
  if (updates.recommended_by !== undefined) supabaseUpdates.recommended_by = updates.recommended_by;
  if (updates.recommended_at !== undefined) supabaseUpdates.recommended_at = updates.recommended_at instanceof Date
    ? updates.recommended_at.toISOString()
    : updates.recommended_at;

  if (Object.keys(supabaseUpdates).length > 0) {
    syncToSupabase(
      () => supabaseUpdateNonAvailability(id, supabaseUpdates),
      "updateNonAvailability"
    );
  }

  return list[idx];
}

export function deleteNonAvailability(id: string): boolean {
  const list = getFromStorage<NonAvailability>(KEYS.nonAvailability);
  const filtered = list.filter((na) => na.id !== id);
  if (filtered.length === list.length) return false;
  saveToStorage(KEYS.nonAvailability, filtered);
  triggerAutoSave('nonAvailability');

  // Sync to Supabase in background
  syncToSupabase(() => supabaseDeleteNonAvailability(id), "deleteNonAvailability");

  return true;
}

// ============ Duty Change Requests ============

/**
 * Determine the required approver level based on the two personnel's unit relationship
 * - Same work section → work_section manager
 * - Different work sections, same section → section manager
 * - Different sections → company manager
 */
export function determineApproverLevel(
  personnel1Id: string,
  personnel2Id: string
): 'work_section' | 'section' | 'company' {
  const personnel1 = getPersonnelById(personnel1Id);
  const personnel2 = getPersonnelById(personnel2Id);

  if (!personnel1 || !personnel2) {
    return 'company'; // Default to highest level if we can't determine
  }

  const unit1 = getUnitSectionById(personnel1.unit_section_id);
  const unit2 = getUnitSectionById(personnel2.unit_section_id);

  if (!unit1 || !unit2) {
    return 'company';
  }

  // Same work section (same unit_section_id)
  if (personnel1.unit_section_id === personnel2.unit_section_id) {
    return 'work_section';
  }

  // Get parent sections
  const section1 = unit1.parent_id ? getUnitSectionById(unit1.parent_id) : null;
  const section2 = unit2.parent_id ? getUnitSectionById(unit2.parent_id) : null;

  // Same section (same parent)
  if (section1 && section2 && section1.id === section2.id) {
    return 'section';
  }

  // Different sections - company manager needed
  return 'company';
}

/**
 * Get the display name for an approver level
 */
export function getApproverLevelName(level: 'work_section' | 'section' | 'company'): string {
  switch (level) {
    case 'work_section': return 'Work Section Manager';
    case 'section': return 'Section Manager';
    case 'company': return 'Company Manager';
    default:
      // TypeScript exhaustiveness check - if new levels are added, this ensures they're handled
      return 'Unknown Approver';
  }
}

/**
 * Check if a user can approve a duty change request based on their role and the required level
 */
export function canApproveChangeRequest(
  userRoles: { name: string; scope_unit_id?: string | null }[],
  requiredLevel: 'work_section' | 'section' | 'company',
  personnel1Id: string,
  personnel2Id: string
): boolean {
  const personnel1 = getPersonnelById(personnel1Id);
  const personnel2 = getPersonnelById(personnel2Id);

  if (!personnel1 || !personnel2) return false;

  // Get unit IDs for both personnel
  const unitIds = new Set([personnel1.unit_section_id, personnel2.unit_section_id]);

  // Check each role
  for (const role of userRoles) {
    if (!role.scope_unit_id) continue;

    // Get all units this role has authority over
    const scopeUnitIds = getAllDescendantUnitIds(role.scope_unit_id);
    const scopeSet = new Set(scopeUnitIds);

    // Check if both personnel are within scope
    const bothInScope = [...unitIds].every(id => scopeSet.has(id));
    if (!bothInScope) continue;

    // Check role level matches required level
    switch (requiredLevel) {
      case 'work_section':
        if (role.name === 'Work Section Manager' || role.name === 'Section Manager' ||
            role.name === 'Company Manager' || role.name === 'Unit Manager' ||
            role.name === 'Unit Admin' || role.name === 'App Admin') {
          return true;
        }
        break;
      case 'section':
        if (role.name === 'Section Manager' || role.name === 'Company Manager' ||
            role.name === 'Unit Manager' || role.name === 'Unit Admin' || role.name === 'App Admin') {
          return true;
        }
        break;
      case 'company':
        if (role.name === 'Company Manager' || role.name === 'Unit Manager' ||
            role.name === 'Unit Admin' || role.name === 'App Admin') {
          return true;
        }
        break;
    }
  }

  return false;
}

/**
 * Check if a user can recommend (but not approve) a duty change request
 * Returns true if the user is a manager but not in the direct approval chain
 */
export function canRecommendChangeRequest(
  userRoles: { name: string; scope_unit_id?: string | null }[],
  personnel1Id: string,
  personnel2Id: string
): boolean {
  // Must be a manager of some kind
  const managerRoles = ['Work Section Manager', 'Section Manager', 'Company Manager', 'Unit Manager'];
  const hasManagerRole = userRoles.some(r => managerRoles.includes(r.name));
  if (!hasManagerRole) return false;

  const personnel1 = getPersonnelById(personnel1Id);
  const personnel2 = getPersonnelById(personnel2Id);
  if (!personnel1 || !personnel2) return false;

  // Check if user has authority over either personnel (if so, they should approve, not recommend)
  const unitIds = new Set([personnel1.unit_section_id, personnel2.unit_section_id]);

  for (const role of userRoles) {
    if (!role.scope_unit_id) continue;
    if (!managerRoles.includes(role.name)) continue;

    const scopeUnitIds = getAllDescendantUnitIds(role.scope_unit_id);
    const scopeSet = new Set(scopeUnitIds);

    // If at least one personnel is in scope, user is in approval chain - should approve not recommend
    const anyInScope = [...unitIds].some(id => scopeSet.has(id));
    if (anyInScope) return false;
  }

  // User is a manager but neither personnel is in their scope - they can recommend
  return true;
}

// ============================================================================
// SWAP APPROVALS (localStorage)
// ============================================================================

export function getAllSwapApprovals(): SwapApproval[] {
  return getFromStorage<SwapApproval>(KEYS.swapApprovals);
}

export function getSwapApprovalsByRequestId(requestId: string): SwapApproval[] {
  return getFromStorage<SwapApproval>(KEYS.swapApprovals)
    .filter(a => a.duty_change_request_id === requestId)
    .sort((a, b) => a.approval_order - b.approval_order);
}

export function saveSwapApproval(approval: SwapApproval): SwapApproval {
  const list = getFromStorage<SwapApproval>(KEYS.swapApprovals);
  const idx = list.findIndex(a => a.id === approval.id);
  if (idx >= 0) {
    list[idx] = approval;
  } else {
    list.push(approval);
  }
  saveToStorage(KEYS.swapApprovals, list);
  return approval;
}

export function saveSwapApprovals(approvals: SwapApproval[]): void {
  const list = getFromStorage<SwapApproval>(KEYS.swapApprovals);
  for (const approval of approvals) {
    const idx = list.findIndex(a => a.id === approval.id);
    if (idx >= 0) {
      list[idx] = approval;
    } else {
      list.push(approval);
    }
  }
  saveToStorage(KEYS.swapApprovals, list);
}

export function deleteSwapApprovalsByRequestId(requestId: string): void {
  const list = getFromStorage<SwapApproval>(KEYS.swapApprovals);
  const filtered = list.filter(a => a.duty_change_request_id !== requestId);
  saveToStorage(KEYS.swapApprovals, filtered);
}

// ============================================================================
// SWAP RECOMMENDATIONS (localStorage)
// ============================================================================

export function getAllSwapRecommendations(): SwapRecommendation[] {
  return getFromStorage<SwapRecommendation>(KEYS.swapRecommendations);
}

export function getSwapRecommendationsByRequestId(requestId: string): SwapRecommendation[] {
  return getFromStorage<SwapRecommendation>(KEYS.swapRecommendations)
    .filter(r => r.duty_change_request_id === requestId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function saveSwapRecommendation(recommendation: SwapRecommendation): SwapRecommendation {
  const list = getFromStorage<SwapRecommendation>(KEYS.swapRecommendations);
  // Check if user already has a recommendation for this request
  const idx = list.findIndex(r =>
    r.duty_change_request_id === recommendation.duty_change_request_id &&
    r.recommender_id === recommendation.recommender_id
  );
  if (idx >= 0) {
    list[idx] = recommendation;
  } else {
    list.push(recommendation);
  }
  saveToStorage(KEYS.swapRecommendations, list);

  // Sync to Supabase
  syncToSupabase(
    () => supabaseCreateSwapRecommendation({
      id: recommendation.id,
      duty_change_request_id: recommendation.duty_change_request_id,
      recommender_id: recommendation.recommender_id,
      recommendation: recommendation.recommendation,
      comment: recommendation.comment,
    }),
    "createSwapRecommendation"
  );

  return recommendation;
}

export function deleteSwapRecommendationsByRequestId(requestId: string): void {
  const list = getFromStorage<SwapRecommendation>(KEYS.swapRecommendations);
  const filtered = list.filter(r => r.duty_change_request_id !== requestId);
  saveToStorage(KEYS.swapRecommendations, filtered);

  // Sync to Supabase
  syncToSupabase(
    () => supabaseDeleteSwapRecommendationsByRequestId(requestId),
    "deleteSwapRecommendations"
  );
}

// ============================================================================
// DUTY CHANGE REQUESTS (Two-Row Swap Model)
// Each swap creates two linked rows - one for each person's side
// ============================================================================

export function getAllDutyChangeRequests(): DutyChangeRequest[] {
  return getFromStorage<DutyChangeRequest>(KEYS.dutyChangeRequests).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export function getDutyChangeRequestById(id: string): DutyChangeRequest | undefined {
  return getFromStorage<DutyChangeRequest>(KEYS.dutyChangeRequests).find((r) => r.id === id);
}

export function getDutyChangeRequestsBySwapPairId(swapPairId: string): DutyChangeRequest[] {
  return getFromStorage<DutyChangeRequest>(KEYS.dutyChangeRequests)
    .filter(r => r.swap_pair_id === swapPairId);
}

export function getDutyChangeRequestsByPersonnel(personnelId: string): DutyChangeRequest[] {
  return getFromStorage<DutyChangeRequest>(KEYS.dutyChangeRequests).filter(
    (r) => r.personnel_id === personnelId || r.swap_partner_id === personnelId
  );
}

export function getPendingDutyChangeRequests(): DutyChangeRequest[] {
  return getFromStorage<DutyChangeRequest>(KEYS.dutyChangeRequests).filter(
    (r) => r.status === 'pending'
  );
}

/**
 * Check if a person meets all requirements for a duty type
 */
export function meetsAllDutyRequirements(personnelId: string, dutyTypeId: string): boolean {
  const requirements = getDutyRequirements(dutyTypeId);
  if (requirements.length === 0) return true; // No requirements = anyone can do it

  return requirements.every(req => hasQualification(personnelId, req.required_qual_name));
}

/**
 * Get the missing qualifications for a person to perform a duty type
 */
export function getMissingQualifications(personnelId: string, dutyTypeId: string): string[] {
  const requirements = getDutyRequirements(dutyTypeId);
  return requirements
    .filter(req => !hasQualification(personnelId, req.required_qual_name))
    .map(req => req.required_qual_name);
}

/**
 * Build the approval chain for a single person's side of the swap
 * Returns approvals needed based on their chain of command
 * lcaApproverLevel determines which level is the actual approver (LCA manager)
 * Levels below LCA can only recommend, not approve
 */
export function buildApprovalChainForPerson(
  personnelId: string,
  requestId: string,
  lcaApproverLevel: 'work_section_manager' | 'section_manager' | 'company_manager' = 'company_manager'
): SwapApproval[] {
  const approvals: SwapApproval[] = [];
  const person = getPersonnelById(personnelId);

  // Helper to determine if this level is the approver (LCA) or just a recommender
  const isApproverLevel = (level: 'work_section_manager' | 'section_manager' | 'company_manager') => {
    return level === lcaApproverLevel;
  };

  if (!person) {
    // Default to company level if can't determine
    approvals.push({
      id: crypto.randomUUID(),
      duty_change_request_id: requestId,
      approval_order: 1,
      approver_type: 'company_manager',
      scope_unit_id: null,
      is_approver: true, // Default to approver when we can't determine
      status: 'pending',
      approved_by: null,
      approved_at: null,
      rejection_reason: null,
      created_at: new Date(),
    });
    return approvals;
  }

  const unit = getUnitSectionById(person.unit_section_id);

  // Work Section Manager - approval or recommendation based on LCA
  approvals.push({
    id: crypto.randomUUID(),
    duty_change_request_id: requestId,
    approval_order: 1,
    approver_type: 'work_section_manager',
    scope_unit_id: person.unit_section_id,
    is_approver: isApproverLevel('work_section_manager'),
    status: 'pending',
    approved_by: null,
    approved_at: null,
    rejection_reason: null,
    created_at: new Date(),
  });

  // Only add higher levels if LCA is at that level or higher
  if (lcaApproverLevel !== 'work_section_manager') {
    // Section Manager (if unit has a parent)
    if (unit?.parent_id) {
      const section = getUnitSectionById(unit.parent_id);
      if (section) {
        approvals.push({
          id: crypto.randomUUID(),
          duty_change_request_id: requestId,
          approval_order: 2,
          approver_type: 'section_manager',
          scope_unit_id: section.id,
          is_approver: isApproverLevel('section_manager'),
          status: 'pending',
          approved_by: null,
          approved_at: null,
          rejection_reason: null,
          created_at: new Date(),
        });

        // Company Manager (if section has a parent and LCA is at company level)
        if (lcaApproverLevel === 'company_manager' && section.parent_id) {
          approvals.push({
            id: crypto.randomUUID(),
            duty_change_request_id: requestId,
            approval_order: 3,
            approver_type: 'company_manager',
            scope_unit_id: section.parent_id,
            is_approver: true, // Company manager is always the approver at this level
            status: 'pending',
            approved_by: null,
            approved_at: null,
            rejection_reason: null,
            created_at: new Date(),
          });
        }
      }
    }
  }

  return approvals;
}

/**
 * Determine if cross-section swap requires higher level approvals
 */
export function determineRequiredApprovalLevel(
  personAId: string,
  personBId: string
): 'work_section' | 'section' | 'company' {
  const personA = getPersonnelById(personAId);
  const personB = getPersonnelById(personBId);

  if (!personA || !personB) return 'company';

  // Same work section - only work section manager needed
  if (personA.unit_section_id === personB.unit_section_id) {
    return 'work_section';
  }

  const unitA = getUnitSectionById(personA.unit_section_id);
  const unitB = getUnitSectionById(personB.unit_section_id);

  if (!unitA || !unitB) return 'company';

  // Same section (same parent) - section manager needed
  if (unitA.parent_id && unitA.parent_id === unitB.parent_id) {
    return 'section';
  }

  // Different sections - company manager needed
  return 'company';
}

/**
 * Create a duty swap with two linked rows
 * Returns the swap_pair_id and both request objects
 */
export function createDutySwap(params: {
  personAId: string;
  personASlotId: string;
  personBId: string;
  personBSlotId: string;
  requesterId: string;
  reason: string;
}): { swapPairId: string; requestA: DutyChangeRequest; requestB: DutyChangeRequest } {
  const swapPairId = crypto.randomUUID();
  const now = new Date();

  // Get slots to determine duty types
  const slotA = getDutySlotById(params.personASlotId);
  const slotB = getDutySlotById(params.personBSlotId);

  // Determine who initiated - they auto-accept
  const personA = getPersonnelById(params.personAId);
  const isPersonARequester = personA?.id === params.personAId;

  // Create Request A (Person A's side)
  const requestA: DutyChangeRequest = {
    id: crypto.randomUUID(),
    swap_pair_id: swapPairId,
    personnel_id: params.personAId,
    giving_slot_id: params.personASlotId,
    receiving_slot_id: params.personBSlotId,
    swap_partner_id: params.personBId,
    requester_id: params.requesterId,
    reason: params.reason,
    status: 'pending',
    partner_accepted: isPersonARequester, // Requester auto-accepts their side
    partner_accepted_at: isPersonARequester ? now : null,
    partner_accepted_by: isPersonARequester ? params.requesterId : null,
    rejection_reason: null,
    created_at: now,
    updated_at: now,
  };

  // Create Request B (Person B's side)
  const requestB: DutyChangeRequest = {
    id: crypto.randomUUID(),
    swap_pair_id: swapPairId,
    personnel_id: params.personBId,
    giving_slot_id: params.personBSlotId,
    receiving_slot_id: params.personASlotId,
    swap_partner_id: params.personAId,
    requester_id: params.requesterId,
    reason: params.reason,
    status: 'pending',
    partner_accepted: !isPersonARequester, // Non-requester needs to accept
    partner_accepted_at: !isPersonARequester ? now : null,
    partner_accepted_by: !isPersonARequester ? params.requesterId : null,
    rejection_reason: null,
    created_at: now,
    updated_at: now,
  };

  // Save to localStorage
  const list = getFromStorage<DutyChangeRequest>(KEYS.dutyChangeRequests);
  list.push(requestA, requestB);
  saveToStorage(KEYS.dutyChangeRequests, list);
  triggerAutoSave('dutyChangeRequests');

  // Find the LCA to determine who can approve vs recommend
  const { approverLevel } = findLowestCommonAncestor(params.personAId, params.personBId);

  // Build and save approval chains for each person
  // Pass LCA level so we know which step is the actual approver
  const approvalsA = buildApprovalChainForPerson(params.personAId, requestA.id, approverLevel);
  const approvalsB = buildApprovalChainForPerson(params.personBId, requestB.id, approverLevel);
  saveSwapApprovals([...approvalsA, ...approvalsB]);

  // Sync to Supabase
  if (personA) {
    const orgId = getOrganizationIdFromUnit(personA.unit_section_id);
    if (orgId) {
      // Sync request A
      syncToSupabase(
        () => supabaseCreateDutyChangeRequest(orgId, {
          id: requestA.id,
          swapPairId: swapPairId,
          personnelId: requestA.personnel_id,
          givingSlotId: requestA.giving_slot_id,
          receivingSlotId: requestA.receiving_slot_id,
          swapPartnerId: requestA.swap_partner_id,
          requestedBy: requestA.requester_id,
          reason: requestA.reason,
          partnerAccepted: requestA.partner_accepted,
          partnerAcceptedAt: requestA.partner_accepted_at?.toISOString() || null,
          partnerAcceptedBy: requestA.partner_accepted_by,
        }),
        "createDutyChangeRequest"
      );

      // Sync request B
      syncToSupabase(
        () => supabaseCreateDutyChangeRequest(orgId, {
          id: requestB.id,
          swapPairId: swapPairId,
          personnelId: requestB.personnel_id,
          givingSlotId: requestB.giving_slot_id,
          receivingSlotId: requestB.receiving_slot_id,
          swapPartnerId: requestB.swap_partner_id,
          requestedBy: requestB.requester_id,
          reason: requestB.reason,
          partnerAccepted: requestB.partner_accepted,
          partnerAcceptedAt: requestB.partner_accepted_at?.toISOString() || null,
          partnerAcceptedBy: requestB.partner_accepted_by,
        }),
        "createDutyChangeRequest"
      );

      // Sync approvals
      const allApprovals = [...approvalsA, ...approvalsB].map(a => ({
        id: a.id,
        duty_change_request_id: a.duty_change_request_id,
        approval_order: a.approval_order,
        approver_type: a.approver_type,
        scope_unit_id: a.scope_unit_id,
        status: a.status as "pending" | "approved" | "rejected",
      }));
      syncToSupabase(
        () => supabaseCreateSwapApprovals(allApprovals),
        "createSwapApprovals"
      );
    }
  }

  return { swapPairId, requestA, requestB };
}

export function updateDutyChangeRequest(
  id: string,
  updates: Partial<DutyChangeRequest>
): DutyChangeRequest | null {
  const list = getFromStorage<DutyChangeRequest>(KEYS.dutyChangeRequests);
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...updates, updated_at: new Date() };
  saveToStorage(KEYS.dutyChangeRequests, list);
  triggerAutoSave('dutyChangeRequests');

  // Sync to Supabase in background
  const supabaseUpdates: {
    status?: "pending" | "approved" | "rejected";
    partnerAccepted?: boolean;
    partnerAcceptedAt?: string | null;
    partnerAcceptedBy?: string | null;
    rejectionReason?: string | null;
    reason?: string;
  } = {};
  if (updates.status !== undefined) supabaseUpdates.status = updates.status;
  if (updates.partner_accepted !== undefined) supabaseUpdates.partnerAccepted = updates.partner_accepted;
  if (updates.partner_accepted_at !== undefined) {
    supabaseUpdates.partnerAcceptedAt = updates.partner_accepted_at
      ? (updates.partner_accepted_at instanceof Date
          ? updates.partner_accepted_at.toISOString()
          : updates.partner_accepted_at)
      : null;
  }
  if (updates.partner_accepted_by !== undefined) supabaseUpdates.partnerAcceptedBy = updates.partner_accepted_by;
  if (updates.rejection_reason !== undefined) supabaseUpdates.rejectionReason = updates.rejection_reason;
  if (updates.reason !== undefined) supabaseUpdates.reason = updates.reason;

  if (Object.keys(supabaseUpdates).length > 0) {
    syncToSupabase(
      () => supabaseUpdateDutyChangeRequest(id, supabaseUpdates),
      "updateDutyChangeRequest"
    );
  }

  return list[idx];
}

/**
 * Accept a swap request (partner acceptance)
 */
export function acceptSwapRequest(
  requestId: string,
  accepterId: string
): { success: boolean; error?: string; swapCompleted?: boolean } {
  const request = getDutyChangeRequestById(requestId);
  if (!request) return { success: false, error: 'Request not found' };
  if (request.status !== 'pending') return { success: false, error: 'Request is not pending' };
  if (request.partner_accepted) return { success: false, error: 'Already accepted' };

  const now = new Date();

  // Update this request's partner_accepted
  updateDutyChangeRequest(requestId, {
    partner_accepted: true,
    partner_accepted_at: now,
    partner_accepted_by: accepterId,
  });

  // Also update the partner's row to show this person accepted
  const partnerRequests = getDutyChangeRequestsBySwapPairId(request.swap_pair_id)
    .filter(r => r.id !== requestId);

  for (const partnerReq of partnerRequests) {
    updateDutyChangeRequest(partnerReq.id, {
      partner_accepted: true,
      partner_accepted_at: now,
      partner_accepted_by: accepterId,
    });
  }

  // Check if swap is now fully approved (both accepted + all approvals complete)
  // This handles the case where no approvals are needed
  if (isSwapFullyApproved(request.swap_pair_id)) {
    const swapError = _executeDutySwap(request.swap_pair_id);
    if (swapError) {
      return { success: false, error: swapError };
    }

    // Mark both requests as approved
    const requests = getDutyChangeRequestsBySwapPairId(request.swap_pair_id);
    for (const req of requests) {
      updateDutyChangeRequest(req.id, { status: 'approved' });
    }

    return { success: true, swapCompleted: true };
  }

  return { success: true, swapCompleted: false };
}

/**
 * Execute the duty swap by swapping personnel assignments between slots
 * This is called when both sides have all approvals complete
 *
 * IMPORTANT: This operation is atomic - both slots are updated in a single
 * localStorage write to prevent inconsistent state if interrupted.
 */
function _executeDutySwap(swapPairId: string): string | undefined {
  const requests = getDutyChangeRequestsBySwapPairId(swapPairId);
  if (requests.length !== 2) {
    return 'Invalid swap pair - expected 2 requests';
  }

  const [reqA, reqB] = requests;

  // Load all slots once for atomic update
  const allSlots = getFromStorage<DutySlot>(KEYS.dutySlots);

  const slotAIdx = allSlots.findIndex(s => s.id === reqA.giving_slot_id);
  const slotBIdx = allSlots.findIndex(s => s.id === reqB.giving_slot_id);

  if (slotAIdx === -1 || slotBIdx === -1) {
    return 'One or both duty slots no longer exist';
  }

  const slotA = allSlots[slotAIdx];
  const slotB = allSlots[slotBIdx];
  const now = new Date();

  // Store original personnel IDs before swapping
  const originalPersonnelA = slotA.personnel_id;
  const originalPersonnelB = slotB.personnel_id;

  // SlotA: originally assigned to personA, now assigned to personB (reqA.swap_partner_id)
  allSlots[slotAIdx] = {
    ...slotA,
    personnel_id: reqA.swap_partner_id,
    status: 'swapped',
    swapped_at: now,
    swapped_from_personnel_id: originalPersonnelA,
    swap_pair_id: swapPairId,
    updated_at: now
  };

  // SlotB: originally assigned to personB, now assigned to personA (reqB.swap_partner_id)
  allSlots[slotBIdx] = {
    ...slotB,
    personnel_id: reqB.swap_partner_id,
    status: 'swapped',
    swapped_at: now,
    swapped_from_personnel_id: originalPersonnelB,
    swap_pair_id: swapPairId,
    updated_at: now
  };

  // Atomic save - both slots updated in single localStorage write
  saveToStorage(KEYS.dutySlots, allSlots);
  triggerAutoSave('dutyRoster');

  // Sync to Supabase (non-blocking)
  syncToSupabase(() => supabaseUpdateDutySlot(slotA.id, {
    personnel_id: reqA.swap_partner_id,
    status: 'swapped',
  }), "executeDutySwap-slotA");

  syncToSupabase(() => supabaseUpdateDutySlot(slotB.id, {
    personnel_id: reqB.swap_partner_id,
    status: 'swapped',
  }), "executeDutySwap-slotB");

  return undefined;
}

/**
 * Check if a swap is fully approved on both sides
 */
function isSwapFullyApproved(swapPairId: string): boolean {
  const requests = getDutyChangeRequestsBySwapPairId(swapPairId);
  if (requests.length !== 2) return false;

  // Both partners must have accepted
  if (!requests.every(r => r.partner_accepted)) return false;

  // All approvals for both requests must be approved
  for (const req of requests) {
    const approvals = getSwapApprovalsByRequestId(req.id);
    if (approvals.length === 0) continue; // No approvals needed
    if (!approvals.every(a => a.status === 'approved')) return false;
  }

  return true;
}

/**
 * Approve a specific step in a duty change request
 */
export function approveSwapApproval(
  approvalId: string,
  approverId: string
): { success: boolean; error?: string; swapCompleted?: boolean } {
  const allApprovals = getAllSwapApprovals();
  const approval = allApprovals.find(a => a.id === approvalId);

  if (!approval) return { success: false, error: 'Approval not found' };
  if (approval.status !== 'pending') return { success: false, error: 'Approval is not pending' };

  const request = getDutyChangeRequestById(approval.duty_change_request_id);
  if (!request) return { success: false, error: 'Request not found' };
  if (request.status !== 'pending') return { success: false, error: 'Request is not pending' };
  if (!request.partner_accepted) return { success: false, error: 'Partner has not accepted yet' };

  // Update the approval
  const updatedApproval: SwapApproval = {
    ...approval,
    status: 'approved',
    approved_by: approverId,
    approved_at: new Date(),
  };
  saveSwapApproval(updatedApproval);

  // Sync to Supabase
  syncToSupabase(
    () => supabaseUpdateSwapApproval(approvalId, {
      status: 'approved',
      approvedBy: approverId,
      approvedAt: new Date().toISOString(),
    }),
    "updateSwapApproval"
  );

  // Check if the entire swap is now fully approved
  if (isSwapFullyApproved(request.swap_pair_id)) {
    // Execute the swap
    const swapError = _executeDutySwap(request.swap_pair_id);
    if (swapError) {
      return { success: false, error: swapError };
    }

    // Mark both requests as approved
    const requests = getDutyChangeRequestsBySwapPairId(request.swap_pair_id);
    for (const req of requests) {
      updateDutyChangeRequest(req.id, { status: 'approved' });
    }

    return { success: true, swapCompleted: true };
  }

  return { success: true, swapCompleted: false };
}

/**
 * Reject a swap - marks both sides as rejected
 */
export function rejectSwap(
  requestId: string,
  rejecterId: string,
  reason: string
): { success: boolean; error?: string } {
  const request = getDutyChangeRequestById(requestId);
  if (!request) return { success: false, error: 'Request not found' };
  if (request.status !== 'pending') return { success: false, error: 'Request is not pending' };

  // Reject both sides of the swap
  const requests = getDutyChangeRequestsBySwapPairId(request.swap_pair_id);
  for (const req of requests) {
    updateDutyChangeRequest(req.id, {
      status: 'rejected',
      rejection_reason: reason,
    });
  }

  return { success: true };
}

/**
 * Delete a swap - removes both rows and their approvals
 */
export function deleteSwap(swapPairId: string): boolean {
  const requests = getDutyChangeRequestsBySwapPairId(swapPairId);
  if (requests.length === 0) return false;

  // Delete approvals and recommendations for each request
  for (const req of requests) {
    deleteSwapApprovalsByRequestId(req.id);
    deleteSwapRecommendationsByRequestId(req.id);
  }

  // Delete the requests
  const list = getFromStorage<DutyChangeRequest>(KEYS.dutyChangeRequests);
  const filtered = list.filter(r => r.swap_pair_id !== swapPairId);
  saveToStorage(KEYS.dutyChangeRequests, filtered);
  triggerAutoSave('dutyChangeRequests');

  // Sync to Supabase
  syncToSupabase(
    () => supabaseDeleteDutyChangeRequestsBySwapPairId(swapPairId),
    "deleteDutyChangeRequestsBySwapPairId"
  );

  return true;
}

/**
 * Add a recommendation to a swap request
 */
export function addSwapRecommendation(
  requestId: string,
  userId: string,
  recommendation: 'recommend' | 'not_recommend',
  comment: string
): SwapRecommendation | null {
  const request = getDutyChangeRequestById(requestId);
  if (!request) return null;
  if (request.status !== 'pending') return null;

  const rec: SwapRecommendation = {
    id: crypto.randomUUID(),
    duty_change_request_id: requestId,
    recommender_id: userId,
    recommendation,
    comment,
    created_at: new Date(),
  };

  return saveSwapRecommendation(rec);
}

/**
 * Get all swap pairs with enriched data
 */
export function getAllSwapPairs(status?: 'pending' | 'approved' | 'rejected'): SwapPair[] {
  const allRequests = getAllDutyChangeRequests();
  const swapPairMap = new Map<string, DutyChangeRequest[]>();

  // Group requests by swap_pair_id
  for (const req of allRequests) {
    if (status && req.status !== status) continue;
    const existing = swapPairMap.get(req.swap_pair_id) || [];
    existing.push(req);
    swapPairMap.set(req.swap_pair_id, existing);
  }

  const swapPairs: SwapPair[] = [];

  for (const [swapPairId, requests] of swapPairMap) {
    if (requests.length !== 2) continue; // Invalid swap pair

    const [reqA, reqB] = requests;

    // Determine overall status
    let overallStatus: 'pending' | 'approved' | 'rejected' = 'pending';
    if (reqA.status === 'rejected' || reqB.status === 'rejected') {
      overallStatus = 'rejected';
    } else if (reqA.status === 'approved' && reqB.status === 'approved') {
      overallStatus = 'approved';
    }

    swapPairs.push({
      swap_pair_id: swapPairId,
      requester_id: reqA.requester_id,
      reason: reqA.reason,
      status: overallStatus,
      created_at: reqA.created_at,
      personA: {
        request: reqA,
        personnel_id: reqA.personnel_id,
        giving_slot_id: reqA.giving_slot_id,
        receiving_slot_id: reqA.receiving_slot_id,
        approvals: getSwapApprovalsByRequestId(reqA.id),
        partner_accepted: reqA.partner_accepted,
      },
      personB: {
        request: reqB,
        personnel_id: reqB.personnel_id,
        giving_slot_id: reqB.giving_slot_id,
        receiving_slot_id: reqB.receiving_slot_id,
        approvals: getSwapApprovalsByRequestId(reqB.id),
        partner_accepted: reqB.partner_accepted,
      },
    });
  }

  return swapPairs.sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

// Enriched swap pair with personnel and duty type info for UI display
export interface EnrichedSwapPair extends SwapPair {
  personADetails?: {
    personnel?: Personnel;
    givingSlot?: DutySlot;
    receivingSlot?: DutySlot;
    givingDutyType?: DutyType;
    receivingDutyType?: DutyType;
  };
  personBDetails?: {
    personnel?: Personnel;
    givingSlot?: DutySlot;
    receivingSlot?: DutySlot;
    givingDutyType?: DutyType;
    receivingDutyType?: DutyType;
  };
  recommendations: SwapRecommendation[];
}

export function getEnrichedSwapPairs(status?: 'pending' | 'approved' | 'rejected'): EnrichedSwapPair[] {
  const swapPairs = getAllSwapPairs(status);
  const personnel = getAllPersonnel();
  const dutySlots = getAllDutySlots();
  const dutyTypes = getAllDutyTypes();

  const personnelMap = new Map(personnel.map(p => [p.id, p]));
  const slotMap = new Map(dutySlots.map(s => [s.id, s]));
  const dutyTypeMap = new Map(dutyTypes.map(dt => [dt.id, dt]));

  return swapPairs.map(pair => {
    const givingSlotA = slotMap.get(pair.personA.giving_slot_id);
    const receivingSlotA = slotMap.get(pair.personA.receiving_slot_id);
    const givingSlotB = slotMap.get(pair.personB.giving_slot_id);
    const receivingSlotB = slotMap.get(pair.personB.receiving_slot_id);

    // Get recommendations from both requests
    const recsA = getSwapRecommendationsByRequestId(pair.personA.request.id);
    const recsB = getSwapRecommendationsByRequestId(pair.personB.request.id);

    return {
      ...pair,
      personADetails: {
        personnel: personnelMap.get(pair.personA.personnel_id),
        givingSlot: givingSlotA,
        receivingSlot: receivingSlotA,
        givingDutyType: givingSlotA ? dutyTypeMap.get(givingSlotA.duty_type_id) : undefined,
        receivingDutyType: receivingSlotA ? dutyTypeMap.get(receivingSlotA.duty_type_id) : undefined,
      },
      personBDetails: {
        personnel: personnelMap.get(pair.personB.personnel_id),
        givingSlot: givingSlotB,
        receivingSlot: receivingSlotB,
        givingDutyType: givingSlotB ? dutyTypeMap.get(givingSlotB.duty_type_id) : undefined,
        receivingDutyType: receivingSlotB ? dutyTypeMap.get(receivingSlotB.duty_type_id) : undefined,
      },
      recommendations: [...recsA, ...recsB],
    };
  });
}

// Get swap pairs involving a specific personnel (as either personA or personB)
export function getSwapPairsByPersonnel(personnelId: string, status?: 'pending' | 'approved' | 'rejected'): SwapPair[] {
  const allPairs = getAllSwapPairs(status);
  return allPairs.filter(pair =>
    pair.personA.personnel_id === personnelId ||
    pair.personB.personnel_id === personnelId
  );
}

// Qualifications
export function hasQualification(personnelId: string, qualName: string): boolean {
  return getFromStorage<Qualification>(KEYS.qualifications).some(
    (q) => q.personnel_id === personnelId && q.qual_name === qualName
  );
}

export function getQualificationsByPersonnel(personnelId: string): Qualification[] {
  return getFromStorage<Qualification>(KEYS.qualifications).filter(
    (q) => q.personnel_id === personnelId
  );
}

export function addQualification(personnelId: string, qualName: string): Qualification {
  const quals = getFromStorage<Qualification>(KEYS.qualifications);
  const qual: Qualification = {
    personnel_id: personnelId,
    qual_name: qualName,
    granted_at: new Date(),
  };
  quals.push(qual);
  saveToStorage(KEYS.qualifications, quals);
  triggerAutoSave('qualifications');
  return qual;
}

export function removeQualification(personnelId: string, qualName: string): boolean {
  const quals = getFromStorage<Qualification>(KEYS.qualifications);
  const filtered = quals.filter(
    (q) => !(q.personnel_id === personnelId && q.qual_name === qualName)
  );
  if (filtered.length === quals.length) return false;
  saveToStorage(KEYS.qualifications, filtered);
  triggerAutoSave('qualifications');
  return true;
}

// Blocked Duties
export function getAllBlockedDuties(): BlockedDuty[] {
  // String comparison works correctly for YYYY-MM-DD format
  return getFromStorage<BlockedDuty>(KEYS.blockedDuties).sort(
    (a, b) => a.start_date.localeCompare(b.start_date)
  );
}

export function getBlockedDutiesByDutyType(dutyTypeId: string): BlockedDuty[] {
  return getFromStorage<BlockedDuty>(KEYS.blockedDuties).filter(
    (bd) => bd.duty_type_id === dutyTypeId
  );
}

export function getBlockedDutiesByUnit(unitId: string): BlockedDuty[] {
  return getFromStorage<BlockedDuty>(KEYS.blockedDuties).filter(
    (bd) => bd.unit_section_id === unitId
  );
}

export function getBlockedDutyById(id: string): BlockedDuty | undefined {
  return getFromStorage<BlockedDuty>(KEYS.blockedDuties).find((bd) => bd.id === id);
}

// Check if a duty is blocked on a specific date
export function isDutyBlockedOnDate(dutyTypeId: string, dateStr: DateString): BlockedDuty | undefined {
  // Simple string comparison - timezone safe with DateString
  return getFromStorage<BlockedDuty>(KEYS.blockedDuties).find((bd) => {
    if (bd.duty_type_id !== dutyTypeId) return false;
    return dateStr >= bd.start_date && dateStr <= bd.end_date;
  });
}

// Get all active blocks for a duty type (blocks that overlap with today or future)
export function getActiveBlocksForDutyType(dutyTypeId: string): BlockedDuty[] {
  const todayStr = getTodayString();

  return getFromStorage<BlockedDuty>(KEYS.blockedDuties).filter((bd) => {
    if (bd.duty_type_id !== dutyTypeId) return false;
    return bd.end_date >= todayStr; // Block end is today or in the future
  });
}

export function createBlockedDuty(blockedDuty: BlockedDuty): BlockedDuty {
  const list = getFromStorage<BlockedDuty>(KEYS.blockedDuties);
  list.push(blockedDuty);
  saveToStorage(KEYS.blockedDuties, list);
  triggerAutoSave('blockedDuties');
  return blockedDuty;
}

export function deleteBlockedDuty(id: string): boolean {
  const list = getFromStorage<BlockedDuty>(KEYS.blockedDuties);
  const filtered = list.filter((bd) => bd.id !== id);
  if (filtered.length === list.length) return false;
  saveToStorage(KEYS.blockedDuties, filtered);
  triggerAutoSave('blockedDuties');
  return true;
}

// Delete all blocks for specific duty types
export function deleteBlocksForDutyTypes(dutyTypeIds: string[]): number {
  const list = getFromStorage<BlockedDuty>(KEYS.blockedDuties);
  const idsSet = new Set(dutyTypeIds);
  const filtered = list.filter((bd) => !idsSet.has(bd.duty_type_id));
  const deletedCount = list.length - filtered.length;
  if (deletedCount > 0) {
    saveToStorage(KEYS.blockedDuties, filtered);
    triggerAutoSave('blockedDuties');
  }
  return deletedCount;
}

// ============ Enriched Types Helpers ============

// Get duty types with their requirements and duty values
export interface EnrichedDutyType extends DutyType {
  requirements: DutyRequirement[];
  duty_value: DutyValue | null;
}

export function getEnrichedDutyTypes(unitId?: string): EnrichedDutyType[] {
  let dutyTypes = getAllDutyTypes();
  if (unitId) {
    dutyTypes = dutyTypes.filter((dt) => dt.unit_section_id === unitId);
  }

  return dutyTypes.map((dt) => ({
    ...dt,
    requirements: getDutyRequirements(dt.id),
    duty_value: getDutyValueByDutyType(dt.id) || null,
  }));
}

// Get duty slots with their duty type and personnel info
export interface EnrichedSlot extends DutySlot {
  duty_type: { id: string; duty_name: string; unit_section_id: string } | null;
  personnel: { id: string; first_name: string; last_name: string; rank: string; unit_section_id: string } | null;
  assigned_by_info: {
    type: "scheduler" | "user";
    display: string; // "Automated by Scheduler" or "RANK FIRSTNAME LASTNAME - SECTION"
    personnel?: { id: string; rank: string; first_name: string; last_name: string; section?: string };
  } | null;
}

/**
 * Build assigned_by_info for a user-assigned duty slot.
 * Extracts to reduce duplication between getEnrichedSlots and optimistic UI updates.
 */
export function buildUserAssignedByInfo(assigner: Personnel | null): NonNullable<EnrichedSlot["assigned_by_info"]> {
  if (!assigner) {
    return {
      type: "user",
      display: "Assigned by User",
    };
  }

  const assignerUnit = getUnitSectionById(assigner.unit_section_id);
  const sectionName = assignerUnit?.unit_name || "";
  return {
    type: "user",
    display: `${assigner.rank} ${assigner.first_name} ${assigner.last_name}${sectionName ? ` - ${sectionName}` : ""}`,
    personnel: {
      id: assigner.id,
      rank: assigner.rank,
      first_name: assigner.first_name,
      last_name: assigner.last_name,
      section: sectionName,
    },
  };
}

// Track missing data for diagnostics
interface DataIntegrityIssue {
  type: 'missing_personnel' | 'missing_duty_type';
  referenceId: string;
  referencedFrom: string;
  slotId: string;
  timestamp: Date;
}

let dataIntegrityIssues: DataIntegrityIssue[] = [];
let lastIntegrityWarningTime = 0;
const INTEGRITY_WARNING_THROTTLE_MS = 5000; // Only warn every 5 seconds

// Get current data integrity issues
export function getDataIntegrityIssues(): DataIntegrityIssue[] {
  return [...dataIntegrityIssues];
}

// Clear data integrity issues (call after data reload)
export function clearDataIntegrityIssues(): void {
  dataIntegrityIssues = [];
}

// Report data integrity summary
export function reportDataIntegrity(): { missingPersonnel: number; missingDutyTypes: number; details: DataIntegrityIssue[] } {
  const missingPersonnel = dataIntegrityIssues.filter(i => i.type === 'missing_personnel').length;
  const missingDutyTypes = dataIntegrityIssues.filter(i => i.type === 'missing_duty_type').length;

  if (missingPersonnel > 0 || missingDutyTypes > 0) {
    console.warn(`[Data Integrity] Issues found: ${missingPersonnel} missing personnel, ${missingDutyTypes} missing duty types`);
  }

  return {
    missingPersonnel,
    missingDutyTypes,
    details: [...dataIntegrityIssues],
  };
}

export function getEnrichedSlots(startDate?: DateString, endDate?: DateString, unitId?: string): EnrichedSlot[] {
  let slots: DutySlot[];

  if (startDate && endDate) {
    slots = getDutySlotsByDateRange(startDate, endDate);
  } else {
    slots = getAllDutySlots();
  }

  if (unitId) {
    const unitDutyTypes = getDutyTypesByUnit(unitId);
    const unitDutyTypeIds = new Set(unitDutyTypes.map((dt) => dt.id));
    slots = slots.filter((slot) => unitDutyTypeIds.has(slot.duty_type_id));
  }

  // Track missing data in this batch for throttled logging
  const batchMissingPersonnel: string[] = [];
  const batchMissingDutyTypes: string[] = [];

  const enrichedSlots = slots.map((slot) => {
    const dutyType = getDutyTypeById(slot.duty_type_id);
    const personnel = slot.personnel_id ? getPersonnelById(slot.personnel_id) : undefined;

    // Track missing personnel for diagnostics
    if (slot.personnel_id && !personnel) {
      batchMissingPersonnel.push(slot.personnel_id);
      dataIntegrityIssues.push({
        type: 'missing_personnel',
        referenceId: slot.personnel_id,
        referencedFrom: 'duty_slot.personnel_id',
        slotId: slot.id,
        timestamp: new Date(),
      });
    }

    // Track missing duty types for diagnostics
    if (slot.duty_type_id && !dutyType) {
      batchMissingDutyTypes.push(slot.duty_type_id);
      dataIntegrityIssues.push({
        type: 'missing_duty_type',
        referenceId: slot.duty_type_id,
        referencedFrom: 'duty_slot.duty_type_id',
        slotId: slot.id,
        timestamp: new Date(),
      });
    }

    // Determine assigned_by_info
    let assigned_by_info: EnrichedSlot["assigned_by_info"] = null;
    if (slot.assigned_by) {
      // Check if it's a valid UUID (user ID) or a string like "admin"/"scheduler"
      if (isValidUUID(slot.assigned_by)) {
        // Try to find the personnel who assigned this duty
        const assigner = getPersonnelById(slot.assigned_by) || null;
        assigned_by_info = buildUserAssignedByInfo(assigner);
      } else {
        // Non-UUID value like "admin" or "scheduler"
        assigned_by_info = {
          type: "scheduler",
          display: "Automated by Scheduler",
        };
      }
    }

    return {
      ...slot,
      duty_type: dutyType ? { id: dutyType.id, duty_name: dutyType.duty_name, unit_section_id: dutyType.unit_section_id } : null,
      personnel: personnel ? { id: personnel.id, first_name: personnel.first_name, last_name: personnel.last_name, rank: personnel.rank, unit_section_id: personnel.unit_section_id } : null,
      assigned_by_info,
    };
  });

  // Throttled warning for missing data (avoid console spam)
  const now = Date.now();
  if ((batchMissingPersonnel.length > 0 || batchMissingDutyTypes.length > 0) &&
      (now - lastIntegrityWarningTime > INTEGRITY_WARNING_THROTTLE_MS)) {
    lastIntegrityWarningTime = now;

    if (batchMissingPersonnel.length > 0) {
      const uniqueIds = [...new Set(batchMissingPersonnel)];
      console.warn(
        `[Data Integrity] ${batchMissingPersonnel.length} duty slots reference ${uniqueIds.length} missing personnel. ` +
        `This may indicate data was not loaded or organization mismatch. First few IDs: ${uniqueIds.slice(0, 3).join(', ')}`
      );
    }

    if (batchMissingDutyTypes.length > 0) {
      const uniqueIds = [...new Set(batchMissingDutyTypes)];
      console.warn(
        `[Data Integrity] ${batchMissingDutyTypes.length} duty slots reference ${uniqueIds.length} missing duty types. ` +
        `First few IDs: ${uniqueIds.slice(0, 3).join(', ')}`
      );
    }
  }

  // Cap the issues list to prevent memory bloat
  if (dataIntegrityIssues.length > 1000) {
    dataIntegrityIssues = dataIntegrityIssues.slice(-500);
  }

  return enrichedSlots;
}

// Get non-availability requests with personnel info
export interface EnrichedNonAvailability extends NonAvailability {
  personnel: { id: string; first_name: string; last_name: string; rank: string; unit_section_id: string } | null;
}

export function getEnrichedNonAvailability(status?: string): EnrichedNonAvailability[] {
  let requests = getAllNonAvailability();
  if (status) {
    requests = requests.filter((r) => r.status === status);
  }

  return requests.map((req) => {
    const personnel = getPersonnelById(req.personnel_id);
    return {
      ...req,
      personnel: personnel ? { id: personnel.id, first_name: personnel.first_name, last_name: personnel.last_name, rank: personnel.rank, unit_section_id: personnel.unit_section_id } : null,
    };
  });
}

// Import personnel from parsed CSV data
export function importPersonnel(
  records: Array<{
    service_id: string;
    first_name: string;
    last_name: string;
    rank: string;
    unit_name?: string;
    unit_section_id?: string;
  }>,
  defaultUnitId?: string
): { created: number; updated: number; errors: string[] } {
  const personnel = getFromStorage<Personnel>(KEYS.personnel);
  const units = getFromStorage<UnitSection>(KEYS.units);
  const result = { created: 0, updated: 0, errors: [] as string[] };

  for (const record of records) {
    try {
      // Find unit
      let unitId = record.unit_section_id || defaultUnitId;
      if (!unitId && record.unit_name) {
        const unit = units.find((u) => u.unit_name.toLowerCase() === record.unit_name!.toLowerCase());
        if (unit) unitId = unit.id;
      }

      if (!unitId) {
        result.errors.push(`No unit found for ${record.service_id}`);
        continue;
      }

      // Check if personnel exists
      const existingIdx = personnel.findIndex((p) => p.service_id === record.service_id);

      if (existingIdx !== -1) {
        // Update existing
        personnel[existingIdx] = {
          ...personnel[existingIdx],
          first_name: record.first_name,
          last_name: record.last_name,
          rank: record.rank,
          unit_section_id: unitId,
          updated_at: new Date(),
        };
        result.updated++;
      } else {
        // Create new
        const newPerson: Personnel = {
          id: crypto.randomUUID(),
          service_id: record.service_id,
          first_name: record.first_name,
          last_name: record.last_name,
          rank: record.rank,
          phone_number: null,
          unit_section_id: unitId,
          current_duty_score: 0,
          created_at: new Date(),
          updated_at: new Date(),
        };
        personnel.push(newPerson);
        result.created++;
      }
    } catch (err) {
      result.errors.push(`Error processing ${record.service_id}: ${err}`);
    }
  }

  saveToStorage(KEYS.personnel, personnel);
  return result;
}

// ============ Manpower TSV Import ============

interface ManpowerRecord {
  rank: string;
  name: string;
  edipi: string;
  sex: string;
  edd: string;
  unit: string;
  category: string;
  dutyStatus: string;
  location: string;
  startDate: string;
  endDate: string;
}

// Parse a name like "LASTNAME JR, FIRSTNAME M." into first/last
function parseName(name: string): { first_name: string; last_name: string } {
  const parts = name.split(",").map(s => s.trim());
  const lastName = parts[0] || "";
  const firstName = parts[1]?.split(" ")[0] || "";
  return { first_name: firstName, last_name: lastName };
}

// Parse unit code like "02301-H-S1DV-CUST" into hierarchy levels
// Pattern: BASE-COMPANY-SECTION-WORKSECTION
function parseUnitCode(unitCode: string): {
  base: string;
  company: string | null;
  section: string | null;
  workSection: string | null;
  ruc: string;  // Keep for backward compat
} {
  const parts = unitCode.split("-");

  if (parts.length >= 4) {
    // Full: 02301-H-S1DV-CUST
    return {
      base: parts[0],
      company: parts[1],
      section: parts[2],
      workSection: parts.slice(3).join("-"),
      ruc: parts.slice(0, 3).join("-"),
    };
  } else if (parts.length === 3) {
    // No work section: 02301-H-S1DV
    return {
      base: parts[0],
      company: parts[1],
      section: parts[2],
      workSection: null,
      ruc: unitCode,
    };
  } else if (parts.length === 2) {
    // Just base and company: 02301-H
    return {
      base: parts[0],
      company: parts[1],
      section: null,
      workSection: null,
      ruc: unitCode,
    };
  }
  return {
    base: unitCode,
    company: null,
    section: null,
    workSection: null,
    ruc: unitCode,
  };
}

// Clean TSV value by removing weird quote patterns
function cleanTsvValue(value: string): string {
  return value
    .replace(/^["'\s]+|["'\s]+$/g, "") // Remove leading/trailing quotes and spaces
    .replace(/"\s*"/g, "") // Remove empty quote pairs
    .trim();
}

// Parse date from format like "2025/08/08" or "2025/12/10"
// Returns DateString (YYYY-MM-DD) format
function parseManpowerDate(dateStr: string): DateString | null {
  const cleaned = cleanTsvValue(dateStr);
  if (!cleaned || cleaned === "" || cleaned === '""') return null;
  const match = cleaned.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (match) {
    // Return as DateString (YYYY-MM-DD) format, validating it's a real date
    const parsedDateString = `${match[1]}-${match[2]}-${match[3]}`;
    if (isValidDateString(parsedDateString)) {
      return parsedDateString;
    }
  }
  return null;
}

// Parse a line handling quoted fields with commas
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote inside quoted field
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // Field separator
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  // Push last field
  result.push(current.trim());
  return result;
}

// Detect delimiter (tab or comma) from content
function detectDelimiter(content: string): "tab" | "comma" {
  const lines = content.split("\n").slice(0, 5);
  let tabCount = 0;
  let commaCount = 0;

  for (const line of lines) {
    tabCount += (line.match(/\t/g) || []).length;
    commaCount += (line.match(/,/g) || []).length;
  }

  return tabCount > commaCount ? "tab" : "comma";
}

// Parse the Morning Report format (supports both CSV and TSV)
export function parseManpowerTsv(content: string): ManpowerRecord[] {
  const lines = content.split("\n");
  const records: ManpowerRecord[] = [];
  const delimiter = detectDelimiter(content);

  // Find the header row (contains "Rank" and "EDIPI")
  let headerIdx = -1;
  const headerColumns: { [key: string]: number } = {};

  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const line = lines[i].toLowerCase();
    if (line.includes("rank") && line.includes("edipi") && line.includes("name")) {
      headerIdx = i;

      // Parse header to get column indices
      const headerValues = delimiter === "tab"
        ? lines[i].split("\t").map(v => cleanTsvValue(v).toLowerCase())
        : parseCsvLine(lines[i]).map(v => cleanTsvValue(v).toLowerCase());

      headerValues.forEach((col, idx) => {
        if (col.includes("rank")) headerColumns["rank"] = idx;
        if (col.includes("name") && !col.includes("unit")) headerColumns["name"] = idx;
        if (col.includes("edipi")) headerColumns["edipi"] = idx;
        if (col.includes("sex") || col.includes("gender")) headerColumns["sex"] = idx;
        if (col.includes("edd") || col.includes("ets") || col.includes("end date of service")) headerColumns["edd"] = idx;
        if (col.includes("unit") || col.includes("ruc")) headerColumns["unit"] = idx;
        if (col.includes("category") || col.includes("cat")) headerColumns["category"] = idx;
        if (col.includes("status") || col.includes("duty status")) headerColumns["dutyStatus"] = idx;
        if (col.includes("location") || col.includes("loc")) headerColumns["location"] = idx;
        if (col.includes("start") && col.includes("date")) headerColumns["startDate"] = idx;
        if (col.includes("end") && col.includes("date")) headerColumns["endDate"] = idx;
      });
      break;
    }
  }

  if (headerIdx === -1) {
    throw new Error("Could not find header row with Rank, Name, EDIPI columns");
  }

  // Parse data rows (after header)
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Split by detected delimiter
    const values = delimiter === "tab"
      ? line.split("\t").map(v => cleanTsvValue(v))
      : parseCsvLine(line).map(v => cleanTsvValue(v));

    // Need at least rank, name, edipi
    if (values.length < 3) continue;

    // Get values by column index if available, otherwise use positional
    const rank = headerColumns["rank"] !== undefined ? values[headerColumns["rank"]] : values[0];
    const name = headerColumns["name"] !== undefined ? values[headerColumns["name"]] : values[1];
    const edipiRaw = headerColumns["edipi"] !== undefined ? values[headerColumns["edipi"]] : values[2];

    // Validate EDIPI is 10 digits
    const edipi = edipiRaw?.replace(/\D/g, "");
    if (!edipi || edipi.length !== 10) continue;

    records.push({
      rank: rank || "",
      name: name || "",
      edipi: edipi,
      sex: headerColumns["sex"] !== undefined ? values[headerColumns["sex"]] || "" : values[3] || "",
      edd: headerColumns["edd"] !== undefined ? values[headerColumns["edd"]] || "" : values[4] || "",
      unit: headerColumns["unit"] !== undefined ? values[headerColumns["unit"]] || "" : values[5] || "",
      category: headerColumns["category"] !== undefined ? values[headerColumns["category"]] || "" : values[6] || "",
      dutyStatus: headerColumns["dutyStatus"] !== undefined ? values[headerColumns["dutyStatus"]] || "" : values[7] || "",
      location: headerColumns["location"] !== undefined ? values[headerColumns["location"]] || "" : values[8] || "",
      startDate: headerColumns["startDate"] !== undefined ? values[headerColumns["startDate"]] || "" : values[9] || "",
      endDate: headerColumns["endDate"] !== undefined ? values[headerColumns["endDate"]] || "" : values[10] || "",
    });
  }

  return records;
}

// Import manpower data - REPLACES all existing personnel
export function importManpowerData(
  records: ManpowerRecord[]
): {
  personnel: { created: number; updated: number };
  units: { created: number };
  nonAvailability: { created: number };
  errors: string[];
  ruc: string | null;
} {
  const result = {
    personnel: { created: 0, updated: 0 },
    units: { created: 0 },
    nonAvailability: { created: 0 },
    errors: [] as string[],
    ruc: null as string | null,
  };

  // Guard: prevent accidental data wipe from empty file
  if (records.length === 0) {
    result.errors.push("Import file is empty or contains no valid records. No data was changed.");
    return result;
  }

  // Load existing units to preserve IDs when units match by name
  const existingUnits = getFromStorage<UnitSection>(KEYS.units);
  const existingUnitsByName = new Map<string, UnitSection>();
  existingUnits.forEach(u => {
    existingUnitsByName.set(u.unit_name, u);
  });

  // Will store the final units and personnel
  const units: UnitSection[] = [];
  const newPersonnel: Personnel[] = [];
  const newNonAvailList: NonAvailability[] = [];

  // Track units by name for lookup and creation
  const unitMap = new Map<string, string>(); // name -> id

  // Track hierarchy: unit -> company -> section -> workSection
  const topUnitSet = new Set<string>();
  const companySet = new Set<string>();
  const sectionSet = new Set<string>();
  const workSectionSet = new Set<string>();

  // First pass: collect all unique unit levels from records
  for (const record of records) {
    if (!record.unit) continue;
    const parsed = parseUnitCode(record.unit);

    if (parsed.base) {
      topUnitSet.add(parsed.base);

      if (parsed.company) {
        const companyName = `${parsed.company} Company`;
        companySet.add(`${parsed.base}|${companyName}`);

        if (parsed.section) {
          sectionSet.add(`${parsed.base}|${companyName}|${parsed.section}`);

          if (parsed.workSection) {
            workSectionSet.add(`${parsed.base}|${companyName}|${parsed.section}|${parsed.workSection}`);
          }
        }
      }
    }
  }

  // Capture the first RUC found (most reports are for a single unit)
  if (topUnitSet.size > 0) {
    result.ruc = Array.from(topUnitSet)[0];
  }

  // Create top-level Unit (reuse existing ID if unit exists by name)
  for (const unitName of topUnitSet) {
    if (!unitMap.has(unitName)) {
      const existingUnit = existingUnitsByName.get(unitName);
      const newUnit: UnitSection = {
        id: existingUnit?.id || crypto.randomUUID(),
        parent_id: null,
        unit_name: unitName,
        unit_code: existingUnit?.unit_code || unitName,
        hierarchy_level: "unit",
        description: existingUnit?.description || unitName,
        created_at: existingUnit?.created_at || new Date(),
        updated_at: new Date(),
      };
      units.push(newUnit);
      unitMap.set(unitName, newUnit.id);
      result.units.created++;
    }
  }

  // Create Company units under their Unit (reuse existing ID if unit exists by name)
  for (const combo of companySet) {
    const [topUnit, companyName] = combo.split("|");
    if (!unitMap.has(companyName)) {
      const parentId = unitMap.get(topUnit);
      const existingUnit = existingUnitsByName.get(companyName);
      const newUnit: UnitSection = {
        id: existingUnit?.id || crypto.randomUUID(),
        parent_id: parentId || null,
        unit_name: companyName,
        unit_code: existingUnit?.unit_code || companyName,
        hierarchy_level: "company",
        description: existingUnit?.description || companyName,
        created_at: existingUnit?.created_at || new Date(),
        updated_at: new Date(),
      };
      units.push(newUnit);
      unitMap.set(companyName, newUnit.id);
      result.units.created++;
    }
  }

  // Create Section units under their Company (reuse existing ID if unit exists by name)
  for (const combo of sectionSet) {
    const [, companyName, sectionCode] = combo.split("|");
    if (!unitMap.has(sectionCode)) {
      const parentId = unitMap.get(companyName);
      const existingUnit = existingUnitsByName.get(sectionCode);
      const newUnit: UnitSection = {
        id: existingUnit?.id || crypto.randomUUID(),
        parent_id: parentId || null,
        unit_name: sectionCode,
        unit_code: existingUnit?.unit_code || sectionCode,
        hierarchy_level: "section",
        description: existingUnit?.description || sectionCode,
        created_at: existingUnit?.created_at || new Date(),
        updated_at: new Date(),
      };
      units.push(newUnit);
      unitMap.set(sectionCode, newUnit.id);
      result.units.created++;
    }
  }

  // Create Work Section units under their Section (reuse existing ID if unit exists by name)
  for (const combo of workSectionSet) {
    const [, , sectionCode, workSectionCode] = combo.split("|");
    if (!unitMap.has(workSectionCode)) {
      const parentId = unitMap.get(sectionCode);
      const existingUnit = existingUnitsByName.get(workSectionCode);
      const newUnit: UnitSection = {
        id: existingUnit?.id || crypto.randomUUID(),
        parent_id: parentId || null,
        unit_name: workSectionCode,
        unit_code: existingUnit?.unit_code || workSectionCode,
        hierarchy_level: "work_section",
        description: existingUnit?.description || workSectionCode,
        created_at: existingUnit?.created_at || new Date(),
        updated_at: new Date(),
      };
      units.push(newUnit);
      unitMap.set(workSectionCode, newUnit.id);
      result.units.created++;
    }
  }

  // Second pass: create personnel (replace all)
  for (const record of records) {
    try {
      const { first_name, last_name } = parseName(record.name);
      const parsed = parseUnitCode(record.unit);

      // Assign to lowest level unit available
      let unitId: string | undefined;
      if (parsed.workSection) {
        unitId = unitMap.get(parsed.workSection);
      } else if (parsed.section) {
        unitId = unitMap.get(parsed.section);
      } else if (parsed.company) {
        unitId = unitMap.get(`${parsed.company} Company`);
      }

      if (!unitId) {
        result.errors.push(`No unit for ${record.edipi}: ${record.unit}`);
        continue;
      }

      // Create new personnel record
      const newPerson: Personnel = {
        id: crypto.randomUUID(),
        service_id: record.edipi,
        first_name,
        last_name,
        rank: record.rank,
        phone_number: null,
        unit_section_id: unitId,
        current_duty_score: 0,
        created_at: new Date(),
        updated_at: new Date(),
      };
      newPersonnel.push(newPerson);
      result.personnel.created++;

      // Create non-availability if on Leave or TAD
      if (record.category === "Leave" || record.category === "TAD") {
        const startDate = parseManpowerDate(record.startDate);
        const endDate = parseManpowerDate(record.endDate);

        if (startDate && endDate) {
          const newNa: NonAvailability = {
            id: crypto.randomUUID(),
            personnel_id: newPerson.id,
            start_date: startDate,
            end_date: endDate,
            reason: `${record.category}: ${record.dutyStatus} - ${record.location}`,
            status: "approved",
            submitted_by: null, // Auto-imported, no submitter
            recommended_by: null,
            recommended_at: null,
            approved_by: null, // Auto-approved on import
            created_at: new Date(),
          };
          newNonAvailList.push(newNa);
          result.nonAvailability.created++;
        }
      }
    } catch (err) {
      result.errors.push(`Error processing ${record.edipi}: ${err}`);
    }
  }

  // Save all data - personnel is REPLACED, units are merged
  saveToStorage(KEYS.units, units);
  saveToStorage(KEYS.personnel, newPersonnel);
  saveToStorage(KEYS.nonAvailability, newNonAvailList);

  return result;
}

// Get personnel by EDIPI (service_id)
export function getPersonnelByEdipi(edipi: string): Personnel | undefined {
  const personnel = getFromStorage<Personnel>(KEYS.personnel);
  // Find by comparing decrypted service_id
  const person = personnel.find(p => {
    const decryptedId = isEncryptedEdipi(p.service_id)
      ? decryptEdipi(p.service_id)
      : p.service_id;
    return decryptedId === edipi;
  });
  if (!person) return undefined;
  return {
    ...person,
    service_id: isEncryptedEdipi(person.service_id) ? decryptEdipi(person.service_id) : person.service_id,
  };
}

// ============ User Management (from localStorage) ============

interface StoredUser {
  id: string;
  edipi: string;
  email: string;
  password?: string;
  personnel_id?: string | null;
  can_approve_non_availability?: boolean;
  roles: Array<{
    id?: string;
    role_name: string;
    scope_unit_id: string | null;
    created_at?: string | Date;
  }>;
  created_at?: string;
}

export function getAllUsers(): StoredUser[] {
  // Return users from the seed data cache (loaded from public/data/user/)
  // Ensure EDIPI is decrypted (in case cache has encrypted values)
  return getAllSeedUsers().map(u => ({
    ...u,
    edipi: isEncryptedEdipi(u.edipi) ? decryptEdipi(u.edipi) : u.edipi,
  }));
}

export function getUserById(id: string): StoredUser | undefined {
  return getAllUsers().find((u) => u.id === id);
}

export function updateUser(userId: string, updates: { email?: string }): StoredUser | null {
  // Find user in the seed cache
  const user = seedUsersCache.find((u) => u.id === userId);
  if (!user) return null;

  // Apply updates directly to the cached user
  if (updates.email !== undefined) {
    user.email = updates.email;
  }

  return {
    ...user,
    edipi: isEncryptedEdipi(user.edipi) ? decryptEdipi(user.edipi) : user.edipi,
  };
}

export function deleteUser(userId: string): boolean {
  // Note: This only removes from memory cache. To persist, update seed data files.
  const idx = seedUsersCache.findIndex((u) => u.id === userId);
  if (idx === -1) return false;

  const user = seedUsersCache[idx];
  seedUsersCache.splice(idx, 1);
  seedUsersByEdipiCache.delete(user.edipi);

  console.warn("User deleted from memory cache. To persist, remove from public/data/user/");
  return true;
}

export function assignUserRole(
  userId: string,
  roleName: string,
  scopeUnitId?: string | null
): boolean {
  // Note: This only updates memory cache. To persist, update seed data files.
  const user = seedUsersCache.find((u) => u.id === userId);
  if (!user) return false;

  // Initialize roles array if needed
  user.roles = user.roles || [];

  // Check if this exact role already exists (same role name AND same scope unit)
  const roleExists = user.roles.some(
    (r: { role_name: string; scope_unit_id: string | null }) =>
      r.role_name === roleName && r.scope_unit_id === (scopeUnitId || null)
  );

  if (roleExists) {
    // Role already exists, nothing to do
    return true;
  }

  // Add the new role (allows multiple Unit Admin roles for different units)
  const newRole = {
    id: `role-${Date.now()}`,
    role_name: roleName,
    scope_unit_id: scopeUnitId || null,
  };
  user.roles.push(newRole);

  // Save to localStorage cache for persistence across page refresh
  saveUserUpdateToCache(userId, user.roles, user.can_approve_non_availability);

  // Update the EDIPI cache map as well
  seedUsersByEdipiCache.set(user.edipi, user);

  console.log("[assignUserRole] Role assigned and cached to localStorage.");
  return true;
}

// Remove a role from a user
export function removeUserRole(
  userId: string,
  roleName: string,
  scopeUnitId?: string | null
): boolean {
  // Note: This only updates memory cache. To persist, update seed data files.
  const user = seedUsersCache.find((u) => u.id === userId);
  console.log("[removeUserRole] Looking for user:", userId, "found:", !!user);

  if (!user || !user.roles) return false;

  const initialLength = user.roles.length;
  console.log("[removeUserRole] User has", initialLength, "roles");
  console.log("[removeUserRole] Looking for role:", roleName, "scope:", scopeUnitId);
  console.log("[removeUserRole] Current roles:", user.roles.map(r => ({ role_name: r.role_name, scope_unit_id: r.scope_unit_id })));

  // Remove the matching role (must match both role name AND scope unit)
  user.roles = user.roles.filter(
    (r: { role_name: string; scope_unit_id: string | null }) =>
      !(r.role_name === roleName && r.scope_unit_id === (scopeUnitId || null))
  );

  const removed = user.roles.length < initialLength;
  console.log("[removeUserRole] After filter:", user.roles.length, "roles. Removed:", removed);

  if (removed) {
    // Save to localStorage cache for persistence across page refresh
    saveUserUpdateToCache(userId, user.roles, user.can_approve_non_availability);

    // Update the EDIPI cache map as well
    seedUsersByEdipiCache.set(user.edipi, user);

    console.log("[removeUserRole] Role removed and cached to localStorage.");
  }
  return removed;
}

// Update user's non-availability approval permission
export function updateUserApprovalPermission(
  userId: string,
  canApprove: boolean
): boolean {
  const user = seedUsersCache.find((u) => u.id === userId);
  if (!user) return false;

  user.can_approve_non_availability = canApprove;

  // Save to localStorage cache for persistence across page refresh
  saveUserUpdateToCache(userId, user.roles || [], canApprove);

  // Update the EDIPI cache map as well
  seedUsersByEdipiCache.set(user.edipi, user);

  console.log("[updateUserApprovalPermission] Permission updated and cached to localStorage.");
  return true;
}

// ============ Seed User Data Loading ============

// User entry in the users index
export interface UserIndexEntry {
  id: string;
  edipi_encrypted: string;
  email: string;
}

// Users index structure for seed data
interface UsersIndex {
  users: UserIndexEntry[];
  version: string;
  updatedAt: string;
}

// Raw user record from JSON (password excluded, edipi encrypted)
interface SeedUserRecord {
  id: string;
  edipi_encrypted: string;
  email: string;
  personnel_id?: string | null;
  can_approve_non_availability?: boolean;
  roles: Array<{
    id?: string;
    role_name: string;
    scope_unit_id: string | null;
    created_at?: string;
  }>;
  created_at: string;
}

// ============ In-Memory Seed Users Cache ============
// Seed users are loaded from public/data/user/ and cached in memory
// localStorage is used to cache local updates until they're deployed

// localStorage key for user updates cache
const USER_UPDATES_CACHE_KEY = "dutysync_user_updates";

interface UserUpdateCache {
  [userId: string]: {
    roles: Array<{
      id?: string;
      role_name: string;
      scope_unit_id: string | null;
    }>;
    can_approve_non_availability?: boolean;
    updatedAt: string;
  };
}

// Get cached user updates from localStorage
function getUserUpdatesCache(): UserUpdateCache {
  if (typeof window === "undefined") return {};
  try {
    const cached = localStorage.getItem(USER_UPDATES_CACHE_KEY);
    return cached ? JSON.parse(cached) : {};
  } catch {
    return {};
  }
}

// Save user update to localStorage cache
function saveUserUpdateToCache(userId: string, roles: Array<{ id?: string; role_name: string; scope_unit_id: string | null }>, canApproveNA?: boolean) {
  if (typeof window === "undefined") return;
  const cache = getUserUpdatesCache();
  cache[userId] = {
    roles,
    can_approve_non_availability: canApproveNA,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(USER_UPDATES_CACHE_KEY, JSON.stringify(cache));
}

// Remove a user from the updates cache (e.g., after successful deployment)
export function clearUserUpdateCache(userId?: string) {
  if (typeof window === "undefined") return;
  if (userId) {
    const cache = getUserUpdatesCache();
    delete cache[userId];
    localStorage.setItem(USER_UPDATES_CACHE_KEY, JSON.stringify(cache));
  } else {
    localStorage.removeItem(USER_UPDATES_CACHE_KEY);
  }
}

interface SeedUserWithPassword extends StoredUser {
  password_hash?: string; // Optional password hash from seed data
}

let seedUsersCache: SeedUserWithPassword[] = [];
let seedUsersByEdipiCache = new Map<string, SeedUserWithPassword>();

function populateSeedUserCache(users: SeedUserWithPassword[]) {
  seedUsersCache = users;
  seedUsersByEdipiCache.clear();
  for (const user of seedUsersCache) {
    seedUsersByEdipiCache.set(user.edipi, user);
  }
}

// Get a seed user by EDIPI (O(1) lookup)
export function getSeedUserByEdipi(edipi: string): SeedUserWithPassword | undefined {
  return seedUsersByEdipiCache.get(edipi);
}

// Check if a user exists in seed data
export function seedUserExists(edipi: string): boolean {
  return seedUsersByEdipiCache.has(edipi);
}

// Get all seed users from cache
export function getAllSeedUsers(): SeedUserWithPassword[] {
  return seedUsersCache;
}

// Get available seed users from the users index
export async function getAvailableSeedUsers(): Promise<UsersIndex["users"]> {
  try {
    const response = await fetch(`${getBasePath()}/data/users-index.json`);
    if (response.ok) {
      const data: UsersIndex = await response.json();
      return data.users || [];
    }
  } catch (error) {
    console.error("Failed to load users index:", error);
  }
  return [];
}

// Load seed users from JSON files into memory cache (no localStorage)
export async function loadSeedUsers(forceReload = false): Promise<{ usersLoaded: number }> {
  if (typeof window === "undefined") {
    return { usersLoaded: 0 };
  }

  // If already loaded and not forcing reload, return cached count
  if (seedUsersCache.length > 0 && !forceReload) {
    return { usersLoaded: seedUsersCache.length };
  }

  try {
    const availableSeedUsers = await getAvailableSeedUsers();
    if (availableSeedUsers.length === 0) {
      return { usersLoaded: 0 };
    }

    const loadedUsers: SeedUserWithPassword[] = [];

    // Fetch each user file in parallel (files are named by user ID)
    const fetchPromises = availableSeedUsers.map(async (userInfo) => {
      const response = await fetch(`${getBasePath()}/data/user/${userInfo.id}.json`);
      if (!response.ok) {
        console.warn(`Failed to fetch user ${userInfo.id}: ${response.status}`);
        return null;
      }
      const userData: SeedUserRecord & { password_hash?: string } = await response.json();
      return userData;
    });

    const results = await Promise.all(fetchPromises);

    for (const userData of results) {
      if (!userData) continue;

      // Decrypt EDIPI
      const decryptedEdipi = decryptEdipi(userData.edipi_encrypted);

      // Add user with decrypted EDIPI to cache
      const user: SeedUserWithPassword = {
        id: userData.id,
        edipi: decryptedEdipi,
        email: userData.email,
        personnel_id: userData.personnel_id || null,
        roles: userData.roles,
        can_approve_non_availability: userData.can_approve_non_availability,
        created_at: userData.created_at,
        password_hash: userData.password_hash,
      };
      loadedUsers.push(user);
    }

    // Apply any cached updates from localStorage (for changes not yet deployed)
    const cachedUpdates = getUserUpdatesCache();
    for (const user of loadedUsers) {
      const cachedUpdate = cachedUpdates[user.id];
      if (cachedUpdate) {
        console.log(`[loadSeedUsers] Applying cached update for user ${user.id}`);
        user.roles = cachedUpdate.roles;
        if (cachedUpdate.can_approve_non_availability !== undefined) {
          user.can_approve_non_availability = cachedUpdate.can_approve_non_availability;
        }
      }
    }

    // Populate the in-memory cache
    populateSeedUserCache(loadedUsers);
    console.log(`Seed users loaded into memory: ${loadedUsers.length}`);

    return { usersLoaded: loadedUsers.length };
  } catch (error) {
    console.error("Failed to load seed users:", error);
    return { usersLoaded: 0 };
  }
}

// Export a single user to JSON format (for saving to /data/user/)
export function exportUserToSeedFormat(userId: string): {
  indexEntry: UserIndexEntry;
  userData: SeedUserRecord;
} | null {
  const user = getUserById(userId);
  if (!user) return null;

  const encryptedEdipi = encryptEdipi(user.edipi);

  return {
    indexEntry: {
      id: user.id,
      edipi_encrypted: encryptedEdipi,
      email: user.email,
    },
    userData: {
      id: user.id,
      edipi_encrypted: encryptedEdipi,
      email: user.email,
      personnel_id: user.personnel_id || null,
      roles: user.roles.map((r) => ({
        id: r.id,
        role_name: r.role_name,
        scope_unit_id: r.scope_unit_id,
        created_at: typeof r === "object" && "created_at" in r ? String(r.created_at) : new Date().toISOString(),
      })),
      created_at: user.created_at || new Date().toISOString(),
    },
  };
}

// Export all users to JSON format
export function exportAllUsers(): {
  users: Array<Omit<StoredUser, "password">>;
  exportedAt: string;
  version: string;
} {
  const users = getAllUsers().map((u) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...userWithoutPassword } = u;
    return userWithoutPassword;
  });

  return {
    users,
    exportedAt: new Date().toISOString(),
    version: "1.0",
  };
}

// Create user JSON file for seed data (encrypted EDIPI, no password)
export function createUserSeedFile(user: StoredUser): {
  filename: string;
  content: SeedUserRecord;
} {
  const encryptedEdipi = encryptEdipi(user.edipi);

  return {
    filename: `${encryptedEdipi}.json`,
    content: {
      id: user.id,
      edipi_encrypted: encryptedEdipi,
      email: user.email,
      personnel_id: user.personnel_id || null,
      roles: user.roles.map((r) => ({
        id: r.id,
        role_name: r.role_name,
        scope_unit_id: r.scope_unit_id,
        created_at: typeof r === "object" && "created_at" in r ? String(r.created_at) : new Date().toISOString(),
      })),
      created_at: user.created_at || new Date().toISOString(),
    },
  };
}

// ============ Data Export Functions ============

export interface ExportData {
  units: UnitSection[];
  personnel: Personnel[];
  dutyTypes: DutyType[];
  dutySlots: DutySlot[];
  nonAvailability: NonAvailability[];
  exportedAt: string;
  version: string;
}

// Export all data as a downloadable JSON file
export function exportAllData(): ExportData {
  return {
    units: getFromStorage<UnitSection>(KEYS.units),
    personnel: getFromStorage<Personnel>(KEYS.personnel),
    dutyTypes: getFromStorage<DutyType>(KEYS.dutyTypes),
    dutySlots: getFromStorage<DutySlot>(KEYS.dutySlots),
    nonAvailability: getFromStorage<NonAvailability>(KEYS.nonAvailability),
    exportedAt: new Date().toISOString(),
    version: "1.0",
  };
}

// Export units only
export function exportUnits(): { units: UnitSection[]; exportedAt: string; version: string } {
  return {
    units: getFromStorage<UnitSection>(KEYS.units),
    exportedAt: new Date().toISOString(),
    version: "1.0",
  };
}

// Export personnel only
export function exportPersonnel(): { personnel: Personnel[]; exportedAt: string; version: string } {
  return {
    personnel: getFromStorage<Personnel>(KEYS.personnel),
    exportedAt: new Date().toISOString(),
    version: "1.0",
  };
}

// Export unit structure in seed file format (for public/data/unit/{ruc}/unit-structure.json)
export function exportUnitStructure(): { units: Array<{
  id: string;
  parent_id: string | null;
  unit_name: string;
  unit_code: string;
  hierarchy_level: string;
  description: string;
  created_at: string;
  updated_at: string;
}>; exportedAt: string; version: string } {
  const units = getFromStorage<UnitSection>(KEYS.units);
  // Format units for seed file, preserving original timestamps
  const formattedUnits = units.map(u => ({
    id: u.id,
    parent_id: u.parent_id,
    unit_name: u.unit_name,
    unit_code: u.unit_code || u.unit_name,
    hierarchy_level: u.hierarchy_level,
    description: u.description || u.unit_name,
    created_at: new Date(u.created_at).toISOString(),
    updated_at: new Date(u.updated_at).toISOString(),
  }));

  return {
    units: formattedUnits,
    exportedAt: new Date().toISOString(),
    version: "1.1",
  };
}

// Export unit members in seed file format (for public/data/unit/{ruc}/unit-members.json)
export function exportUnitMembers(): { personnel: Array<{
  id: string;
  service_id: string;
  first_name: string;
  last_name: string;
  rank: string;
  unit_section_id: string;
  current_duty_score: number;
}>; exportedAt: string; version: string; encrypted: boolean; encryptedAt: string } {
  const personnel = getFromStorage<Personnel>(KEYS.personnel);
  // Format personnel for seed file (keep service_id encrypted, remove timestamps)
  const formattedPersonnel = personnel.map(p => ({
    id: p.id,
    service_id: isEncryptedEdipi(p.service_id) ? p.service_id : encryptEdipi(p.service_id),
    first_name: p.first_name,
    last_name: p.last_name,
    rank: p.rank,
    unit_section_id: p.unit_section_id,
    current_duty_score: p.current_duty_score,
  }));

  const now = new Date().toISOString();
  return {
    personnel: formattedPersonnel,
    exportedAt: now,
    version: "1.1",
    encrypted: true,
    encryptedAt: now,
  };
}

// Export duty types in seed file format (for public/data/unit/{ruc}/duty-types.json)
export function exportDutyTypes(unitId?: string): {
  dutyTypes: DutyType[];
  dutyValues: DutyValue[];
  dutyRequirements: DutyRequirement[];
  exportedAt: string;
  version: string;
  description: string;
} {
  let dutyTypes = getFromStorage<DutyType>(KEYS.dutyTypes);
  const allDutyValues = getFromStorage<DutyValue>(KEYS.dutyValues);
  const allDutyRequirements = getFromStorage<DutyRequirement>(KEYS.dutyRequirements);

  // Filter by unit if specified
  if (unitId) {
    dutyTypes = dutyTypes.filter(dt => dt.unit_section_id === unitId);
  }

  // Get duty type IDs for filtering related data
  const dutyTypeIds = new Set(dutyTypes.map(dt => dt.id));

  // Filter values and requirements to match the duty types
  const dutyValues = allDutyValues.filter(dv => dutyTypeIds.has(dv.duty_type_id));
  const dutyRequirements = allDutyRequirements.filter(dr => dutyTypeIds.has(dr.duty_type_id));

  return {
    dutyTypes,
    dutyValues,
    dutyRequirements,
    exportedAt: new Date().toISOString(),
    version: "1.0",
    description: "Duty type definitions, point values, and qualification requirements for this unit",
  };
}

// Export duty roster in seed file format (for public/data/unit/{ruc}/duty-roster.json)
export function exportDutyRoster(unitId?: string): {
  dutySlots: DutySlot[];
  supernumeraryAssignments: SupernumeraryAssignment[];
  exportedAt: string;
  version: string;
  description: string;
} {
  let dutySlots = getFromStorage<DutySlot>(KEYS.dutySlots);
  let supernumeraryAssignments = getFromStorage<SupernumeraryAssignment>(KEYS.supernumeraryAssignments);

  // Filter by unit if specified (via duty type's unit_section_id)
  if (unitId) {
    const unitDutyTypes = getFromStorage<DutyType>(KEYS.dutyTypes)
      .filter(dt => dt.unit_section_id === unitId);
    const unitDutyTypeIds = new Set(unitDutyTypes.map(dt => dt.id));
    dutySlots = dutySlots.filter(ds => unitDutyTypeIds.has(ds.duty_type_id));
    supernumeraryAssignments = supernumeraryAssignments.filter(sa => unitDutyTypeIds.has(sa.duty_type_id));
  }

  return {
    dutySlots,
    supernumeraryAssignments,
    exportedAt: new Date().toISOString(),
    version: "1.1",
    description: "Scheduled duty assignments and supernumerary (standby) personnel for this unit",
  };
}

// Export non-availability in seed file format (for public/data/unit/{ruc}/non-availability.json)
export function exportNonAvailability(unitId?: string): {
  nonAvailability: NonAvailability[];
  exportedAt: string;
  version: string;
  description: string;
} {
  let nonAvailability = getFromStorage<NonAvailability>(KEYS.nonAvailability);

  // Filter by unit if specified (via personnel's unit_section_id)
  if (unitId) {
    const unitPersonnel = getFromStorage<Personnel>(KEYS.personnel)
      .filter(p => p.unit_section_id === unitId);
    const unitPersonnelIds = new Set(unitPersonnel.map(p => p.id));
    nonAvailability = nonAvailability.filter(na => unitPersonnelIds.has(na.personnel_id));
  }

  return {
    nonAvailability,
    exportedAt: new Date().toISOString(),
    version: "1.0",
    description: "Non-availability requests (leave, TAD, etc.) for personnel in this unit",
  };
}

// Export qualifications in seed file format (for public/data/unit/{ruc}/qualifications.json)
export function exportQualifications(unitId?: string): {
  qualifications: Qualification[];
  exportedAt: string;
  version: string;
  description: string;
} {
  let qualifications = getFromStorage<Qualification>(KEYS.qualifications);

  // Filter by unit if specified (via personnel's unit_section_id)
  if (unitId) {
    const unitPersonnel = getFromStorage<Personnel>(KEYS.personnel)
      .filter(p => p.unit_section_id === unitId);
    const unitPersonnelIds = new Set(unitPersonnel.map(p => p.id));
    qualifications = qualifications.filter(q => unitPersonnelIds.has(q.personnel_id));
  }

  return {
    qualifications,
    exportedAt: new Date().toISOString(),
    version: "1.0",
    description: "Personnel qualifications and certifications for this unit",
  };
}

// Export duty change requests in seed file format (for public/data/unit/{ruc}/duty-change-requests.json)
export function exportDutyChangeRequests(unitId?: string): {
  dutyChangeRequests: DutyChangeRequest[];
  exportedAt: string;
  version: string;
  description: string;
} {
  let requests = getFromStorage<DutyChangeRequest>(KEYS.dutyChangeRequests);

  // Filter by unit if specified (via personnel's unit_section_id)
  if (unitId) {
    const unitPersonnelIds = new Set(getPersonnelByUnit(unitId).map(p => p.id));
    requests = requests.filter(r =>
      unitPersonnelIds.has(r.personnel_id) ||
      unitPersonnelIds.has(r.swap_partner_id)
    );
  }

  return {
    dutyChangeRequests: requests,
    exportedAt: new Date().toISOString(),
    version: "1.0",
    description: "Duty swap/change requests for personnel in this unit",
  };
}

// Helper to download data as JSON file
export function downloadAsJson(data: object, filename: string): void {
  if (typeof window === "undefined") return;

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Import data from exported JSON
export function importExportedData(data: ExportData): {
  units: number;
  personnel: number;
  dutyTypes: number;
  dutySlots: number;
  nonAvailability: number;
} {
  const result = { units: 0, personnel: 0, dutyTypes: 0, dutySlots: 0, nonAvailability: 0 };

  if (data.units && Array.isArray(data.units)) {
    saveToStorage(KEYS.units, data.units);
    result.units = data.units.length;
  }

  if (data.personnel && Array.isArray(data.personnel)) {
    saveToStorage(KEYS.personnel, data.personnel);
    result.personnel = data.personnel.length;
  }

  if (data.dutyTypes && Array.isArray(data.dutyTypes)) {
    saveToStorage(KEYS.dutyTypes, data.dutyTypes);
    result.dutyTypes = data.dutyTypes.length;
  }

  if (data.dutySlots && Array.isArray(data.dutySlots)) {
    saveToStorage(KEYS.dutySlots, data.dutySlots);
    result.dutySlots = data.dutySlots.length;
  }

  if (data.nonAvailability && Array.isArray(data.nonAvailability)) {
    saveToStorage(KEYS.nonAvailability, data.nonAvailability);
    result.nonAvailability = data.nonAvailability.length;
  }

  return result;
}

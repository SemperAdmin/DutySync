/**
 * Auto-save utility for persisting localStorage changes to GitHub
 *
 * Usage:
 *   import { autoSave, initAutoSave } from '@/lib/auto-save';
 *
 *   // Initialize on app load
 *   initAutoSave('02301');
 *
 *   // Mark data as dirty after changes
 *   autoSave.markDirty('dutyTypes');
 */

import {
  exportDutyTypes,
  exportDutyRoster,
  exportNonAvailability,
  exportQualifications,
  exportUnitStructure,
  exportUnitMembers,
  exportDutyChangeRequests,
  setAutoSaveNotifier,
} from './client-stores';

import {
  pushUnitSeedFile,
  pushSeedFilesToGitHub,
  isGitHubConfigured,
} from './github-api';

// Types of data that can be auto-saved
export type SaveableDataType =
  | 'dutyTypes'
  | 'dutyRoster'
  | 'nonAvailability'
  | 'qualifications'
  | 'unitStructure'
  | 'unitMembers'
  | 'dutyChangeRequests';

// Auto-save status
export type AutoSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

// Status change callback
type StatusCallback = (status: AutoSaveStatus, message?: string) => void;

// Auto-save configuration
interface AutoSaveConfig {
  enabled: boolean;
  debounceMs: number;  // Wait this long after last change before saving
  ruc: string;         // Current RUC for file paths
}

// Track which data types have unsaved changes
const dirtyFlags: Record<SaveableDataType, boolean> = {
  dutyTypes: false,
  dutyRoster: false,
  nonAvailability: false,
  qualifications: false,
  unitStructure: false,
  unitMembers: false,
  dutyChangeRequests: false,
};

// Current configuration
let config: AutoSaveConfig = {
  enabled: false,
  debounceMs: 5000,  // 5 seconds default
  ruc: '',
};

// Debounce timer
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// Current status
let currentStatus: AutoSaveStatus = 'idle';

// Status listeners
const statusListeners: Set<StatusCallback> = new Set();

// LocalStorage key for auto-save settings
const AUTOSAVE_SETTINGS_KEY = 'dutysync_autosave_settings';

/**
 * Update status and notify listeners
 */
function setStatus(status: AutoSaveStatus, message?: string): void {
  currentStatus = status;
  statusListeners.forEach(cb => cb(status, message));
}

/**
 * Get current auto-save status
 */
export function getAutoSaveStatus(): AutoSaveStatus {
  return currentStatus;
}

/**
 * Subscribe to status changes
 */
export function onStatusChange(callback: StatusCallback): () => void {
  statusListeners.add(callback);
  return () => statusListeners.delete(callback);
}

/**
 * Check if there are any unsaved changes
 */
export function hasUnsavedChanges(): boolean {
  return Object.values(dirtyFlags).some(dirty => dirty);
}

/**
 * Get list of dirty data types
 */
export function getDirtyTypes(): SaveableDataType[] {
  return (Object.keys(dirtyFlags) as SaveableDataType[])
    .filter(type => dirtyFlags[type]);
}

/**
 * Mark a data type as having unsaved changes
 */
export function markDirty(dataType: SaveableDataType): void {
  dirtyFlags[dataType] = true;

  if (!config.enabled) {
    setStatus('pending', `Changes pending (auto-save disabled)`);
    return;
  }

  setStatus('pending', `Changes pending...`);
  scheduleSave();
}

/**
 * Mark a data type as saved
 */
function markClean(dataType: SaveableDataType): void {
  dirtyFlags[dataType] = false;
}

/**
 * Schedule a save operation (debounced)
 */
function scheduleSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(() => {
    performSave();
  }, config.debounceMs);
}

/**
 * Cancel any pending save
 */
export function cancelPendingSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

/**
 * Force an immediate save of all dirty data
 */
export async function saveNow(): Promise<{ success: boolean; message: string }> {
  cancelPendingSave();
  return performSave();
}

/**
 * Perform the actual save operation
 */
async function performSave(): Promise<{ success: boolean; message: string }> {
  if (!config.enabled) {
    return { success: false, message: 'Auto-save is disabled' };
  }

  if (!config.ruc) {
    return { success: false, message: 'No RUC configured' };
  }

  if (!isGitHubConfigured()) {
    setStatus('error', 'GitHub not configured');
    return { success: false, message: 'GitHub not configured' };
  }

  const dirty = getDirtyTypes();
  if (dirty.length === 0) {
    setStatus('idle');
    return { success: true, message: 'Nothing to save' };
  }

  setStatus('saving', `Saving ${dirty.length} file(s)...`);

  const errors: string[] = [];

  // Save each dirty data type
  for (const dataType of dirty) {
    try {
      const result = await saveDataType(dataType);
      if (result.success) {
        markClean(dataType);
      } else {
        errors.push(`${dataType}: ${result.message}`);
      }
    } catch (error) {
      errors.push(`${dataType}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  if (errors.length > 0) {
    setStatus('error', `Save failed: ${errors.join(', ')}`);
    return { success: false, message: errors.join(', ') };
  }

  setStatus('saved', 'All changes saved');

  // Reset to idle after a short delay
  setTimeout(() => {
    if (currentStatus === 'saved') {
      setStatus('idle');
    }
  }, 3000);

  return { success: true, message: 'All changes saved' };
}

/**
 * Save a specific data type to GitHub
 */
async function saveDataType(dataType: SaveableDataType): Promise<{ success: boolean; message: string }> {
  const ruc = config.ruc;

  switch (dataType) {
    case 'dutyTypes': {
      const data = exportDutyTypes();
      return pushUnitSeedFile(ruc, 'duty-types', data);
    }
    case 'dutyRoster': {
      const data = exportDutyRoster();
      return pushUnitSeedFile(ruc, 'duty-roster', data);
    }
    case 'nonAvailability': {
      const data = exportNonAvailability();
      return pushUnitSeedFile(ruc, 'non-availability', data);
    }
    case 'qualifications': {
      const data = exportQualifications();
      return pushUnitSeedFile(ruc, 'qualifications', data);
    }
    case 'unitStructure':
    case 'unitMembers': {
      // These are saved together
      const structure = exportUnitStructure();
      const members = exportUnitMembers();
      const result = await pushSeedFilesToGitHub(structure, members, ruc);
      return {
        success: result.success,
        message: result.success
          ? 'Unit data saved'
          : `${result.structureResult.message}, ${result.membersResult.message}`,
      };
    }
    case 'dutyChangeRequests': {
      const data = exportDutyChangeRequests();
      return pushUnitSeedFile(ruc, 'duty-change-requests', data);
    }
    default:
      return { success: false, message: `Unknown data type: ${dataType}` };
  }
}

/**
 * Initialize auto-save with configuration
 */
export function initAutoSave(ruc: string, options?: Partial<AutoSaveConfig>): void {
  // Load saved settings
  const savedSettings = loadAutoSaveSettings();

  config = {
    enabled: savedSettings?.enabled ?? true,
    debounceMs: savedSettings?.debounceMs ?? options?.debounceMs ?? 5000,
    ruc,
  };

  // Reset dirty flags
  Object.keys(dirtyFlags).forEach(key => {
    dirtyFlags[key as SaveableDataType] = false;
  });

  // Connect the auto-save notifier to client-stores
  setAutoSaveNotifier((dataType: string) => {
    if (isSaveableDataType(dataType)) {
      markDirty(dataType);
    }
  });

  setStatus('idle');
  console.log(`[AutoSave] Initialized for RUC ${ruc}, enabled: ${config.enabled}, debounce: ${config.debounceMs}ms`);
}

/**
 * Check if a string is a valid SaveableDataType
 */
function isSaveableDataType(value: string): value is SaveableDataType {
  return Object.keys(dirtyFlags).includes(value);
}

/**
 * Enable auto-save
 */
export function enableAutoSave(): void {
  config.enabled = true;
  saveAutoSaveSettings();

  // If there are pending changes, schedule a save
  if (hasUnsavedChanges()) {
    scheduleSave();
  }

  console.log('[AutoSave] Enabled');
}

/**
 * Disable auto-save
 */
export function disableAutoSave(): void {
  config.enabled = false;
  cancelPendingSave();
  saveAutoSaveSettings();

  if (hasUnsavedChanges()) {
    setStatus('pending', 'Changes pending (auto-save disabled)');
  } else {
    setStatus('idle');
  }

  console.log('[AutoSave] Disabled');
}

/**
 * Check if auto-save is enabled
 */
export function isAutoSaveEnabled(): boolean {
  return config.enabled;
}

/**
 * Set debounce delay
 */
export function setDebounceMs(ms: number): void {
  config.debounceMs = Math.max(1000, Math.min(60000, ms));  // Clamp between 1s and 60s
  saveAutoSaveSettings();
  console.log(`[AutoSave] Debounce set to ${config.debounceMs}ms`);
}

/**
 * Get current debounce delay
 */
export function getDebounceMs(): number {
  return config.debounceMs;
}

/**
 * Get current RUC
 */
export function getCurrentRuc(): string {
  return config.ruc;
}

/**
 * Set current RUC
 */
export function setCurrentRuc(ruc: string): void {
  config.ruc = ruc;
  console.log(`[AutoSave] RUC set to ${ruc}`);
}

/**
 * Load auto-save settings from localStorage
 */
function loadAutoSaveSettings(): { enabled: boolean; debounceMs: number } | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = localStorage.getItem(AUTOSAVE_SETTINGS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

/**
 * Save auto-save settings to localStorage
 */
function saveAutoSaveSettings(): void {
  if (typeof window === 'undefined') return;

  localStorage.setItem(AUTOSAVE_SETTINGS_KEY, JSON.stringify({
    enabled: config.enabled,
    debounceMs: config.debounceMs,
  }));
}

/**
 * Auto-save convenience object for importing
 */
export const autoSave = {
  markDirty,
  saveNow,
  hasUnsavedChanges,
  getDirtyTypes,
  getStatus: getAutoSaveStatus,
  onStatusChange,
  enable: enableAutoSave,
  disable: disableAutoSave,
  isEnabled: isAutoSaveEnabled,
  setDebounce: setDebounceMs,
  getDebounce: getDebounceMs,
  init: initAutoSave,
  setRuc: setCurrentRuc,
  getRuc: getCurrentRuc,
  cancel: cancelPendingSave,
};

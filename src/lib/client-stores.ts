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
} from "@/types";
import { getLevelOrder } from "@/lib/unit-constants";
import { DEFAULT_WEEKEND_MULTIPLIER, DEFAULT_HOLIDAY_MULTIPLIER } from "@/lib/constants";
import { isHoliday, isWeekend } from "@/lib/date-utils";

// Auto-save notification function (lazy import to avoid circular dependency)
let notifyAutoSave: ((dataType: string) => void) | null = null;

export function setAutoSaveNotifier(notifier: (dataType: string) => void): void {
  notifyAutoSave = notifier;
}

function triggerAutoSave(dataType: string): void {
  if (notifyAutoSave) {
    notifyAutoSave(dataType);
  }
}

// ============ Base Path Helper ============
// Get the base path for fetching data files in production (GitHub Pages)
function getBasePath(): string {
  return process.env.NODE_ENV === "production" ? "/DutySync" : "";
}

// ============ EDIPI Encryption ============
// Simple XOR-based encryption for EDIPIs in JSON files
// Key should be set via NEXT_PUBLIC_EDIPI_KEY environment variable

const EDIPI_KEY = process.env.NEXT_PUBLIC_EDIPI_KEY || "DutySync2024";

// Encrypt an EDIPI for storage in JSON
export function encryptEdipi(edipi: string): string {
  if (!edipi) return "";
  let result = "";
  for (let i = 0; i < edipi.length; i++) {
    const charCode = edipi.charCodeAt(i) ^ EDIPI_KEY.charCodeAt(i % EDIPI_KEY.length);
    result += String.fromCharCode(charCode);
  }
  // Base64 encode to make it JSON-safe
  return btoa(result);
}

// Decrypt an EDIPI from JSON storage
export function decryptEdipi(encrypted: string): string {
  if (!encrypted) return "";

  // Helper to try decryption with a specific key
  const tryDecrypt = (key: string): string | null => {
    try {
      const decoded = atob(encrypted);
      let result = "";
      for (let i = 0; i < decoded.length; i++) {
        const charCode = decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length);
        result += String.fromCharCode(charCode);
      }
      // Validate result is a 10-digit EDIPI
      if (/^\d{10}$/.test(result)) {
        return result;
      }
      return null;
    } catch {
      return null;
    }
  };

  // Try with the configured key first
  const result = tryDecrypt(EDIPI_KEY);
  if (result) return result;

  // If env key is set but different from default, try default as fallback
  const defaultKey = "DutySync2024";
  if (EDIPI_KEY !== defaultKey) {
    const fallbackResult = tryDecrypt(defaultKey);
    if (fallbackResult) return fallbackResult;
  }

  // If all decryption attempts fail, check if it's already a plain EDIPI
  if (/^\d{10}$/.test(encrypted)) {
    return encrypted;
  }

  // Return the encrypted value as-is (will show as encrypted in UI)
  console.warn("EDIPI decryption failed, key mismatch or invalid data:", encrypted.substring(0, 10) + "...");
  return encrypted;
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
  qualifications: "dutysync_qualifications",
  blockedDuties: "dutysync_blocked_duties",
  users: "dutysync_users",
  rucs: "dutysync_rucs",
  seedDataLoaded: "dutysync_seed_loaded",
  approvedRosters: "dutysync_approved_rosters",
};

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

// Load seed data from JSON files if localStorage is empty
// Uses atomic loading: either all data loads successfully or nothing is saved
export async function loadSeedDataIfNeeded(): Promise<{
  unitsLoaded: number;
  personnelLoaded: number;
  dutyTypesLoaded: number;
  dutySlotsLoaded: number;
  nonAvailabilityLoaded: number;
  qualificationsLoaded: number;
  dutyChangeRequestsLoaded: number;
  alreadyLoaded: boolean;
}> {
  if (typeof window === "undefined") {
    return { unitsLoaded: 0, personnelLoaded: 0, dutyTypesLoaded: 0, dutySlotsLoaded: 0, nonAvailabilityLoaded: 0, qualificationsLoaded: 0, dutyChangeRequestsLoaded: 0, alreadyLoaded: false };
  }

  // Check if seed data was already loaded
  const seedLoaded = localStorage.getItem(KEYS.seedDataLoaded);
  if (seedLoaded === "true") {
    return { unitsLoaded: 0, personnelLoaded: 0, dutyTypesLoaded: 0, dutySlotsLoaded: 0, nonAvailabilityLoaded: 0, qualificationsLoaded: 0, dutyChangeRequestsLoaded: 0, alreadyLoaded: true };
  }

  // Check if there's existing data
  const existingUnits = getFromStorage<UnitSection>(KEYS.units);
  const existingPersonnel = getFromStorage<Personnel>(KEYS.personnel);

  if (existingUnits.length > 0 || existingPersonnel.length > 0) {
    // Mark as loaded since data exists
    localStorage.setItem(KEYS.seedDataLoaded, "true");
    return { unitsLoaded: 0, personnelLoaded: 0, dutyTypesLoaded: 0, dutySlotsLoaded: 0, nonAvailabilityLoaded: 0, qualificationsLoaded: 0, dutyChangeRequestsLoaded: 0, alreadyLoaded: true };
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
      return { unitsLoaded: 0, personnelLoaded: 0, dutyTypesLoaded: 0, dutySlotsLoaded: 0, nonAvailabilityLoaded: 0, qualificationsLoaded: 0, dutyChangeRequestsLoaded: 0, alreadyLoaded: false };
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
    for (const { unitData, personnelData, dutyTypesData, dutyRosterData, nonAvailabilityData, qualificationsData, dutyChangeRequestsData } of results) {
      // Add units
      allUnits.push(...unitData.units);

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
    return { unitsLoaded: 0, personnelLoaded: 0, dutyTypesLoaded: 0, dutySlotsLoaded: 0, nonAvailabilityLoaded: 0, qualificationsLoaded: 0, dutyChangeRequestsLoaded: 0, alreadyLoaded: false };
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
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error(`Failed to parse ${key} from localStorage. Clearing item.`, error);
    localStorage.removeItem(key);
    return [];
  }
}

// Helper to save to localStorage
function saveToStorage<T>(key: string, data: T[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(data));
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

export function getDutyTypeById(id: string): DutyType | undefined {
  return getFromStorage<DutyType>(KEYS.dutyTypes).find((dt) => dt.id === id);
}

export function createDutyType(dutyType: DutyType): DutyType {
  const types = getFromStorage<DutyType>(KEYS.dutyTypes);
  types.push(dutyType);
  saveToStorage(KEYS.dutyTypes, types);
  triggerAutoSave('dutyTypes');
  return dutyType;
}

export function updateDutyType(id: string, updates: Partial<DutyType>): DutyType | null {
  const types = getFromStorage<DutyType>(KEYS.dutyTypes);
  const idx = types.findIndex((dt) => dt.id === id);
  if (idx === -1) return null;
  types[idx] = { ...types[idx], ...updates, updated_at: new Date() };
  saveToStorage(KEYS.dutyTypes, types);
  triggerAutoSave('dutyTypes');
  return types[idx];
}

export function deleteDutyType(id: string): boolean {
  const types = getFromStorage<DutyType>(KEYS.dutyTypes);
  const filtered = types.filter((dt) => dt.id !== id);
  if (filtered.length === types.length) return false;
  saveToStorage(KEYS.dutyTypes, filtered);
  triggerAutoSave('dutyTypes');
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
  return dutyValue;
}

export function updateDutyValue(id: string, updates: Partial<DutyValue>): DutyValue | null {
  const values = getFromStorage<DutyValue>(KEYS.dutyValues);
  const idx = values.findIndex((dv) => dv.id === id);
  if (idx === -1) return null;
  values[idx] = { ...values[idx], ...updates };
  saveToStorage(KEYS.dutyValues, values);
  triggerAutoSave('dutyTypes');
  return values[idx];
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
  return requirement;
}

export function clearDutyRequirements(dutyTypeId: string): void {
  const requirements = getFromStorage<DutyRequirement>(KEYS.dutyRequirements);
  const filtered = requirements.filter((dr) => dr.duty_type_id !== dutyTypeId);
  saveToStorage(KEYS.dutyRequirements, filtered);
  triggerAutoSave('dutyTypes');
}

// Duty Slots
export function getAllDutySlots(): DutySlot[] {
  return getFromStorage<DutySlot>(KEYS.dutySlots).sort(
    (a, b) => new Date(a.date_assigned).getTime() - new Date(b.date_assigned).getTime()
  );
}

export function getDutySlotById(id: string): DutySlot | undefined {
  return getFromStorage<DutySlot>(KEYS.dutySlots).find((s) => s.id === id);
}

export function getDutySlotsByDateRange(startDate: Date, endDate: Date): DutySlot[] {
  return getFromStorage<DutySlot>(KEYS.dutySlots).filter((slot) => {
    const slotDate = new Date(slot.date_assigned);
    return slotDate >= startDate && slotDate <= endDate;
  });
}

export function getDutySlotsByDate(date: Date): DutySlot[] {
  const dateStr = date.toISOString().split("T")[0];
  return getFromStorage<DutySlot>(KEYS.dutySlots).filter((slot) => {
    const slotDateStr = new Date(slot.date_assigned).toISOString().split("T")[0];
    return slotDateStr === dateStr;
  });
}

export function getDutySlotsByDateAndType(date: Date, dutyTypeId: string): DutySlot[] {
  const dateStr = date.toISOString().split("T")[0];
  return getFromStorage<DutySlot>(KEYS.dutySlots).filter((slot) => {
    const slotDateStr = new Date(slot.date_assigned).toISOString().split("T")[0];
    return slotDateStr === dateStr && slot.duty_type_id === dutyTypeId;
  });
}

export function createDutySlot(slot: DutySlot): DutySlot {
  const slots = getFromStorage<DutySlot>(KEYS.dutySlots);
  slots.push(slot);
  saveToStorage(KEYS.dutySlots, slots);
  triggerAutoSave('dutyRoster');
  return slot;
}

export function updateDutySlot(id: string, updates: Partial<DutySlot>): DutySlot | null {
  const slots = getFromStorage<DutySlot>(KEYS.dutySlots);
  const idx = slots.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  slots[idx] = { ...slots[idx], ...updates, updated_at: new Date() };
  saveToStorage(KEYS.dutySlots, slots);
  triggerAutoSave('dutyRoster');
  return slots[idx];
}

export function deleteDutySlot(id: string): boolean {
  const slots = getFromStorage<DutySlot>(KEYS.dutySlots);
  const filtered = slots.filter((s) => s.id !== id);
  if (filtered.length === slots.length) return false;
  saveToStorage(KEYS.dutySlots, filtered);
  triggerAutoSave('dutyRoster');
  return true;
}

export function clearDutySlotsInRange(startDate: Date, endDate: Date, unitId?: string): number {
  const slots = getFromStorage<DutySlot>(KEYS.dutySlots);
  let count = 0;
  const filtered = slots.filter((slot) => {
    const slotDate = new Date(slot.date_assigned);
    const inRange = slotDate >= startDate && slotDate <= endDate;
    if (!inRange) return true;
    if (unitId) {
      const dutyType = getDutyTypeById(slot.duty_type_id);
      if (dutyType?.unit_section_id !== unitId) return true;
    }
    count++;
    return false;
  });
  saveToStorage(KEYS.dutySlots, filtered);
  if (count > 0) triggerAutoSave('dutyRoster');
  return count;
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

// Approve a roster and apply duty scores to personnel
export function approveRoster(
  unitId: string,
  year: number,
  month: number,
  approvedBy: string
): { approval: ApprovedRoster; scoresApplied: number } {
  // Check if already approved
  const existing = isRosterApproved(unitId, year, month);
  if (existing) {
    throw new Error("This roster has already been approved.");
  }

  // Get the date range for the month
  const startDate = new Date(year, month, 1);
  const endDate = new Date(year, month + 1, 0); // Last day of month

  // Get all duty slots for this month and unit (including descendant units)
  const allSlots = getFromStorage<DutySlot>(KEYS.dutySlots);
  const dutyTypes = getAllDutyTypes();
  const allUnitIdsInScope = getAllDescendantUnitIds(unitId);
  const unitDutyTypeIds = new Set(
    dutyTypes.filter((dt) => allUnitIdsInScope.includes(dt.unit_section_id)).map((dt) => dt.id)
  );

  const monthSlots = allSlots.filter((slot) => {
    const slotDate = new Date(slot.date_assigned);
    return (
      slotDate >= startDate &&
      slotDate <= endDate &&
      unitDutyTypeIds.has(slot.duty_type_id)
    );
  });

  // Calculate and apply duty scores to personnel
  const personnelScores = new Map<string, number>();

  for (const slot of monthSlots) {
    if (!slot.personnel_id) continue;

    // Get duty value for this duty type
    const dutyValue = getDutyValueByDutyType(slot.duty_type_id);
    const baseWeight = dutyValue?.base_weight ?? 1;
    const weekendMultiplier = dutyValue?.weekend_multiplier ?? DEFAULT_WEEKEND_MULTIPLIER;
    const holidayMultiplier = dutyValue?.holiday_multiplier ?? DEFAULT_HOLIDAY_MULTIPLIER;

    // Check if this is a weekend or holiday
    const slotDate = new Date(slot.date_assigned);

    // Calculate points (holiday takes precedence over weekend)
    let points = baseWeight;
    if (isHoliday(slotDate)) {
      points = baseWeight * holidayMultiplier;
    } else if (isWeekend(slotDate)) {
      points = baseWeight * weekendMultiplier;
    }

    // Add to personnel's total
    const currentTotal = personnelScores.get(slot.personnel_id) || 0;
    personnelScores.set(slot.personnel_id, currentTotal + points);
  }

  // Apply scores to personnel records
  const personnel = getFromStorage<Personnel>(KEYS.personnel);
  let scoresApplied = 0;

  for (const [personnelId, points] of personnelScores) {
    const idx = personnel.findIndex((p) => p.id === personnelId);
    if (idx !== -1) {
      personnel[idx].current_duty_score = (personnel[idx].current_duty_score || 0) + points;
      personnel[idx].updated_at = new Date();
      scoresApplied++;
    }
  }

  saveToStorage(KEYS.personnel, personnel);
  if (scoresApplied > 0) triggerAutoSave('unitMembers');

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

  return { approval, scoresApplied };
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
  return true;
}

// Non-Availability
export function getAllNonAvailability(): NonAvailability[] {
  return getFromStorage<NonAvailability>(KEYS.nonAvailability).sort(
    (a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime()
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

export function getActiveNonAvailability(personnelId: string, date: Date): NonAvailability | undefined {
  const dateTime = date.getTime();
  return getFromStorage<NonAvailability>(KEYS.nonAvailability).find((na) => {
    if (na.personnel_id !== personnelId) return false;
    if (na.status !== "approved") return false;
    const start = new Date(na.start_date).getTime();
    const end = new Date(na.end_date).getTime();
    return dateTime >= start && dateTime <= end;
  });
}

export function createNonAvailability(na: NonAvailability): NonAvailability {
  const list = getFromStorage<NonAvailability>(KEYS.nonAvailability);
  list.push(na);
  saveToStorage(KEYS.nonAvailability, list);
  triggerAutoSave('nonAvailability');
  return na;
}

export function updateNonAvailability(id: string, updates: Partial<NonAvailability>): NonAvailability | null {
  const list = getFromStorage<NonAvailability>(KEYS.nonAvailability);
  const idx = list.findIndex((na) => na.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...updates };
  saveToStorage(KEYS.nonAvailability, list);
  triggerAutoSave('nonAvailability');
  return list[idx];
}

export function deleteNonAvailability(id: string): boolean {
  const list = getFromStorage<NonAvailability>(KEYS.nonAvailability);
  const filtered = list.filter((na) => na.id !== id);
  if (filtered.length === list.length) return false;
  saveToStorage(KEYS.nonAvailability, filtered);
  triggerAutoSave('nonAvailability');
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

export function getAllDutyChangeRequests(): DutyChangeRequest[] {
  return getFromStorage<DutyChangeRequest>(KEYS.dutyChangeRequests).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export function getDutyChangeRequestById(id: string): DutyChangeRequest | undefined {
  return getFromStorage<DutyChangeRequest>(KEYS.dutyChangeRequests).find((r) => r.id === id);
}

export function getDutyChangeRequestsByPersonnel(personnelId: string): DutyChangeRequest[] {
  return getFromStorage<DutyChangeRequest>(KEYS.dutyChangeRequests).filter(
    (r) => r.original_personnel_id === personnelId || r.target_personnel_id === personnelId
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
 * Helper function to create a SwapApproval object with default pending status
 */
function createSwapApproval(
  approverType: import("@/types").SwapApproval['approver_type'],
  forPersonnel: import("@/types").SwapApproval['for_personnel'],
  scopeUnitId: string | null = null
): import("@/types").SwapApproval {
  return {
    approver_type: approverType,
    for_personnel: forPersonnel,
    scope_unit_id: scopeUnitId,
    status: 'pending',
    approved_by: null,
    approved_at: null,
    rejection_reason: null,
  };
}

/**
 * Build the list of required approvals for a duty swap
 * Returns approvals needed: target person + both chains of command up to common level
 */
export function buildSwapApprovals(
  originalPersonnelId: string,
  targetPersonnelId: string
): import("@/types").SwapApproval[] {
  const approvals: import("@/types").SwapApproval[] = [];

  // 1. Target person must approve (unless they initiated the request)
  approvals.push(createSwapApproval('target_person', 'target'));

  // 2. Determine the approval chain based on unit relationships
  const originalPerson = getPersonnelById(originalPersonnelId);
  const targetPerson = getPersonnelById(targetPersonnelId);

  if (!originalPerson || !targetPerson) {
    // Default to company level if can't determine
    approvals.push(createSwapApproval('company_manager', 'both'));
    return approvals;
  }

  const originalUnit = getUnitSectionById(originalPerson.unit_section_id);
  const targetUnit = getUnitSectionById(targetPerson.unit_section_id);

  if (!originalUnit || !targetUnit) {
    approvals.push(createSwapApproval('company_manager', 'both'));
    return approvals;
  }

  // Same work section - only one work section manager needed
  if (originalPerson.unit_section_id === targetPerson.unit_section_id) {
    approvals.push(createSwapApproval('work_section_manager', 'both', originalPerson.unit_section_id));
    return approvals;
  }

  // Different work sections - both work section managers needed
  approvals.push(createSwapApproval('work_section_manager', 'original', originalPerson.unit_section_id));
  approvals.push(createSwapApproval('work_section_manager', 'target', targetPerson.unit_section_id));

  // Check if same section (same parent)
  const originalSection = originalUnit.parent_id ? getUnitSectionById(originalUnit.parent_id) : null;
  const targetSection = targetUnit.parent_id ? getUnitSectionById(targetUnit.parent_id) : null;

  if (originalSection && targetSection && originalSection.id === targetSection.id) {
    // Same section - section manager approval needed (shared)
    approvals.push(createSwapApproval('section_manager', 'both', originalSection.id));
    return approvals;
  }

  // Different sections - both section managers + company manager needed
  if (originalSection) {
    approvals.push(createSwapApproval('section_manager', 'original', originalSection.id));
  }
  if (targetSection) {
    approvals.push(createSwapApproval('section_manager', 'target', targetSection.id));
  }

  // Company manager for cross-section swaps
  approvals.push(createSwapApproval('company_manager', 'both'));

  return approvals;
}

export function createDutyChangeRequest(request: DutyChangeRequest): DutyChangeRequest {
  const list = getFromStorage<DutyChangeRequest>(KEYS.dutyChangeRequests);
  list.push(request);
  saveToStorage(KEYS.dutyChangeRequests, list);
  triggerAutoSave('dutyChangeRequests');
  return request;
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
  return list[idx];
}

/**
 * Execute the duty swap by swapping personnel assignments between two slots
 * Returns error message if slots don't exist, undefined on success
 */
function _executeDutySwap(request: DutyChangeRequest): string | undefined {
  const originalSlot = getDutySlotById(request.original_slot_id);
  const targetSlot = getDutySlotById(request.target_slot_id);

  if (!originalSlot || !targetSlot) {
    return 'One or both duty slots no longer exist';
  }

  // Swap the personnel assignments
  updateDutySlot(originalSlot.id, {
    personnel_id: request.target_personnel_id,
    updated_at: new Date()
  });
  updateDutySlot(targetSlot.id, {
    personnel_id: request.original_personnel_id,
    updated_at: new Date()
  });

  return undefined;
}

/**
 * Approve a specific step in a duty change request
 * For multi-level approvals, this approves the appropriate step based on the user's role/identity
 */
export function approveDutyChangeRequest(
  id: string,
  approverId: string,
  approvalIndex?: number // Optional: specify which approval step to approve
): { success: boolean; error?: string; allApproved?: boolean } {
  const request = getDutyChangeRequestById(id);
  if (!request) return { success: false, error: 'Request not found' };
  if (request.status !== 'pending') return { success: false, error: 'Request is not pending' };

  // Handle legacy requests without approvals array
  if (!request.approvals || request.approvals.length === 0) {
    // Legacy single-approval flow
    const swapError = _executeDutySwap(request);
    if (swapError) {
      return { success: false, error: swapError };
    }

    updateDutyChangeRequest(id, {
      status: 'approved',
      approved_by: approverId,
      approved_at: new Date()
    });

    return { success: true, allApproved: true };
  }

  // New multi-level approval flow
  const updatedApprovals = [...request.approvals];
  let approvedIdx = approvalIndex;

  // If no specific index provided, find the first pending approval the user can approve
  if (approvedIdx === undefined) {
    approvedIdx = updatedApprovals.findIndex(a => a.status === 'pending');
    if (approvedIdx === -1) {
      return { success: false, error: 'No pending approvals found' };
    }
  }

  if (approvedIdx < 0 || approvedIdx >= updatedApprovals.length) {
    return { success: false, error: 'Invalid approval index' };
  }

  if (updatedApprovals[approvedIdx].status !== 'pending') {
    return { success: false, error: 'This approval step is not pending' };
  }

  // Mark this approval as approved
  updatedApprovals[approvedIdx] = {
    ...updatedApprovals[approvedIdx],
    status: 'approved',
    approved_by: approverId,
    approved_at: new Date(),
  };

  // Check if all approvals are now complete
  const allApproved = updatedApprovals.every(a => a.status === 'approved');

  if (allApproved) {
    // All approvals complete - execute the swap
    const swapError = _executeDutySwap(request);
    if (swapError) {
      return { success: false, error: swapError };
    }

    updateDutyChangeRequest(id, {
      status: 'approved',
      approvals: updatedApprovals,
      approved_by: approverId,
      approved_at: new Date()
    });
  } else {
    // Update just the approvals array
    updateDutyChangeRequest(id, {
      approvals: updatedApprovals
    });
  }

  return { success: true, allApproved };
}

export function rejectDutyChangeRequest(
  id: string,
  approverId: string,
  reason: string
): DutyChangeRequest | null {
  return updateDutyChangeRequest(id, {
    status: 'rejected',
    approved_by: approverId,
    approved_at: new Date(),
    rejection_reason: reason
  });
}

export function deleteDutyChangeRequest(id: string): boolean {
  const list = getFromStorage<DutyChangeRequest>(KEYS.dutyChangeRequests);
  const filtered = list.filter((r) => r.id !== id);
  if (filtered.length === list.length) return false;
  saveToStorage(KEYS.dutyChangeRequests, filtered);
  triggerAutoSave('dutyChangeRequests');
  return true;
}

// Enriched duty change request with personnel and duty type info
export interface EnrichedDutyChangeRequest extends DutyChangeRequest {
  originalPersonnel?: Personnel;
  targetPersonnel?: Personnel;
  originalDutyType?: DutyType;
  targetDutyType?: DutyType;
  requester?: Personnel;
}

export function getEnrichedDutyChangeRequests(status?: string): EnrichedDutyChangeRequest[] {
  let requests = getAllDutyChangeRequests();
  if (status) {
    requests = requests.filter(r => r.status === status);
  }

  const personnel = getAllPersonnel();
  const dutyTypes = getAllDutyTypes();

  const personnelMap = new Map(personnel.map(p => [p.id, p]));
  const dutyTypeMap = new Map(dutyTypes.map(dt => [dt.id, dt]));

  return requests.map(r => ({
    ...r,
    originalPersonnel: personnelMap.get(r.original_personnel_id),
    targetPersonnel: personnelMap.get(r.target_personnel_id),
    originalDutyType: dutyTypeMap.get(r.original_duty_type_id),
    targetDutyType: dutyTypeMap.get(r.target_duty_type_id),
    requester: r.requester_personnel_id ? personnelMap.get(r.requester_personnel_id) : undefined,
  }));
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
  return getFromStorage<BlockedDuty>(KEYS.blockedDuties).sort(
    (a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime()
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
export function isDutyBlockedOnDate(dutyTypeId: string, date: Date): BlockedDuty | undefined {
  const dateTime = date.getTime();
  return getFromStorage<BlockedDuty>(KEYS.blockedDuties).find((bd) => {
    if (bd.duty_type_id !== dutyTypeId) return false;
    const start = new Date(bd.start_date).getTime();
    const end = new Date(bd.end_date).getTime();
    return dateTime >= start && dateTime <= end;
  });
}

// Get all active blocks for a duty type (blocks that overlap with today or future)
export function getActiveBlocksForDutyType(dutyTypeId: string): BlockedDuty[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTime = today.getTime();

  return getFromStorage<BlockedDuty>(KEYS.blockedDuties).filter((bd) => {
    if (bd.duty_type_id !== dutyTypeId) return false;
    const end = new Date(bd.end_date).getTime();
    return end >= todayTime; // Block end is today or in the future
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
  personnel: { id: string; first_name: string; last_name: string; rank: string } | null;
}

export function getEnrichedSlots(startDate?: Date, endDate?: Date, unitId?: string): EnrichedSlot[] {
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

  return slots.map((slot) => {
    const dutyType = getDutyTypeById(slot.duty_type_id);
    const personnel = slot.personnel_id ? getPersonnelById(slot.personnel_id) : undefined;

    return {
      ...slot,
      duty_type: dutyType ? { id: dutyType.id, duty_name: dutyType.duty_name, unit_section_id: dutyType.unit_section_id } : null,
      personnel: personnel ? { id: personnel.id, first_name: personnel.first_name, last_name: personnel.last_name, rank: personnel.rank } : null,
    };
  });
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
function parseManpowerDate(dateStr: string): Date | null {
  const cleaned = cleanTsvValue(dateStr);
  if (!cleaned || cleaned === "" || cleaned === '""') return null;
  const match = cleaned.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (match) {
    return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
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
            recommended_by: null,
            approved_by: null,
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
  exportedAt: string;
  version: string;
  description: string;
} {
  let dutySlots = getFromStorage<DutySlot>(KEYS.dutySlots);

  // Filter by unit if specified (via duty type's unit_section_id)
  if (unitId) {
    const unitDutyTypes = getFromStorage<DutyType>(KEYS.dutyTypes)
      .filter(dt => dt.unit_section_id === unitId);
    const unitDutyTypeIds = new Set(unitDutyTypes.map(dt => dt.id));
    dutySlots = dutySlots.filter(ds => unitDutyTypeIds.has(ds.duty_type_id));
  }

  return {
    dutySlots,
    exportedAt: new Date().toISOString(),
    version: "1.0",
    description: "Scheduled duty assignments for this unit",
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
    const unitPersonnel = getFromStorage<Personnel>(KEYS.personnel)
      .filter(p => p.unit_section_id === unitId);
    const unitPersonnelIds = new Set(unitPersonnel.map(p => p.id));
    requests = requests.filter(r =>
      unitPersonnelIds.has(r.original_personnel_id) ||
      unitPersonnelIds.has(r.target_personnel_id)
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

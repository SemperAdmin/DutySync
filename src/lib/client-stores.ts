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
} from "@/types";
import { getLevelOrder } from "@/lib/unit-constants";

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
  try {
    const decoded = atob(encrypted);
    let result = "";
    for (let i = 0; i < decoded.length; i++) {
      const charCode = decoded.charCodeAt(i) ^ EDIPI_KEY.charCodeAt(i % EDIPI_KEY.length);
      result += String.fromCharCode(charCode);
    }
    return result;
  } catch {
    // If decryption fails, assume it's already decrypted (legacy data)
    return encrypted;
  }
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
  qualifications: "dutysync_qualifications",
  users: "dutysync_users",
  rucs: "dutysync_rucs",
  seedDataLoaded: "dutysync_seed_loaded",
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
  alreadyLoaded: boolean;
}> {
  if (typeof window === "undefined") {
    return { unitsLoaded: 0, personnelLoaded: 0, alreadyLoaded: false };
  }

  // Check if seed data was already loaded
  const seedLoaded = localStorage.getItem(KEYS.seedDataLoaded);
  if (seedLoaded === "true") {
    return { unitsLoaded: 0, personnelLoaded: 0, alreadyLoaded: true };
  }

  // Check if there's existing data
  const existingUnits = getFromStorage<UnitSection>(KEYS.units);
  const existingPersonnel = getFromStorage<Personnel>(KEYS.personnel);

  if (existingUnits.length > 0 || existingPersonnel.length > 0) {
    // Mark as loaded since data exists
    localStorage.setItem(KEYS.seedDataLoaded, "true");
    return { unitsLoaded: 0, personnelLoaded: 0, alreadyLoaded: true };
  }

  // Collect all data before saving (atomic operation)
  const allUnits: UnitSection[] = [];
  const allPersonnel: Personnel[] = [];

  try {
    // Load units index to get available RUCs
    const availableRucs = await getAvailableRucs();

    if (availableRucs.length === 0) {
      console.warn("No RUCs found in units index");
      return { unitsLoaded: 0, personnelLoaded: 0, alreadyLoaded: false };
    }

    // Fetch all data in parallel for each RUC
    const fetchPromises = availableRucs.map(async (rucInfo) => {
      const ruc = rucInfo.ruc;
      const unitResponse = await fetch(`${getBasePath()}/data/unit/${ruc}/unit-structure.json`);
      const personnelResponse = await fetch(`${getBasePath()}/data/unit/${ruc}/unit-members.json`);

      // Both fetches must succeed for this RUC
      if (!unitResponse.ok) {
        throw new Error(`Failed to fetch unit structure for RUC ${ruc}: ${unitResponse.status}`);
      }
      if (!personnelResponse.ok) {
        throw new Error(`Failed to fetch personnel for RUC ${ruc}: ${personnelResponse.status}`);
      }

      const unitData = await unitResponse.json();
      const personnelData = await personnelResponse.json();

      // Validate data structure
      if (!unitData.units || !Array.isArray(unitData.units)) {
        throw new Error(`Invalid unit structure for RUC ${ruc}: missing units array`);
      }
      if (!personnelData.personnel || !Array.isArray(personnelData.personnel)) {
        throw new Error(`Invalid personnel data for RUC ${ruc}: missing personnel array`);
      }

      return { ruc, unitData, personnelData };
    });

    // Wait for all fetches to complete
    const results = await Promise.all(fetchPromises);

    // Process all results after successful fetch
    for (const { unitData, personnelData } of results) {
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
    }

    // All data fetched and validated - now save atomically
    saveToStorage(KEYS.units, allUnits);
    saveToStorage(KEYS.personnel, allPersonnel);

    // Only mark as loaded after all data is successfully saved
    localStorage.setItem(KEYS.seedDataLoaded, "true");

    console.log(`Seed data loaded: ${allUnits.length} units, ${allPersonnel.length} personnel`);
    return { unitsLoaded: allUnits.length, personnelLoaded: allPersonnel.length, alreadyLoaded: false };
  } catch (error) {
    // Clean up any partial data on failure
    localStorage.removeItem(KEYS.units);
    localStorage.removeItem(KEYS.personnel);
    // Do NOT set seedDataLoaded - allow retry on next page load
    console.error("Failed to load seed data (atomic rollback):", error);
    return { unitsLoaded: 0, personnelLoaded: 0, alreadyLoaded: false };
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
  return unit;
}

export function updateUnitSection(id: string, updates: Partial<UnitSection>): UnitSection | null {
  const units = getFromStorage<UnitSection>(KEYS.units);
  const idx = units.findIndex((u) => u.id === id);
  if (idx === -1) return null;
  units[idx] = { ...units[idx], ...updates, updated_at: new Date() };
  saveToStorage(KEYS.units, units);
  return units[idx];
}

export function getChildUnits(parentId: string): UnitSection[] {
  return getFromStorage<UnitSection>(KEYS.units).filter((u) => u.parent_id === parentId);
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
  return person;
}

export function updatePersonnel(id: string, updates: Partial<Personnel>): Personnel | null {
  const personnel = getFromStorage<Personnel>(KEYS.personnel);
  const idx = personnel.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  personnel[idx] = { ...personnel[idx], ...updates, updated_at: new Date() };
  saveToStorage(KEYS.personnel, personnel);
  return personnel[idx];
}

export function deletePersonnel(id: string): boolean {
  const personnel = getFromStorage<Personnel>(KEYS.personnel);
  const filtered = personnel.filter((p) => p.id !== id);
  if (filtered.length === personnel.length) return false;
  saveToStorage(KEYS.personnel, filtered);
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
  return dutyType;
}

export function updateDutyType(id: string, updates: Partial<DutyType>): DutyType | null {
  const types = getFromStorage<DutyType>(KEYS.dutyTypes);
  const idx = types.findIndex((dt) => dt.id === id);
  if (idx === -1) return null;
  types[idx] = { ...types[idx], ...updates, updated_at: new Date() };
  saveToStorage(KEYS.dutyTypes, types);
  return types[idx];
}

export function deleteDutyType(id: string): boolean {
  const types = getFromStorage<DutyType>(KEYS.dutyTypes);
  const filtered = types.filter((dt) => dt.id !== id);
  if (filtered.length === types.length) return false;
  saveToStorage(KEYS.dutyTypes, filtered);
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
  return dutyValue;
}

export function updateDutyValue(id: string, updates: Partial<DutyValue>): DutyValue | null {
  const values = getFromStorage<DutyValue>(KEYS.dutyValues);
  const idx = values.findIndex((dv) => dv.id === id);
  if (idx === -1) return null;
  values[idx] = { ...values[idx], ...updates };
  saveToStorage(KEYS.dutyValues, values);
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
  return requirement;
}

export function clearDutyRequirements(dutyTypeId: string): void {
  const requirements = getFromStorage<DutyRequirement>(KEYS.dutyRequirements);
  const filtered = requirements.filter((dr) => dr.duty_type_id !== dutyTypeId);
  saveToStorage(KEYS.dutyRequirements, filtered);
}

// Duty Slots
export function getAllDutySlots(): DutySlot[] {
  return getFromStorage<DutySlot>(KEYS.dutySlots).sort(
    (a, b) => new Date(a.date_assigned).getTime() - new Date(b.date_assigned).getTime()
  );
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

export function createDutySlot(slot: DutySlot): DutySlot {
  const slots = getFromStorage<DutySlot>(KEYS.dutySlots);
  slots.push(slot);
  saveToStorage(KEYS.dutySlots, slots);
  return slot;
}

export function updateDutySlot(id: string, updates: Partial<DutySlot>): DutySlot | null {
  const slots = getFromStorage<DutySlot>(KEYS.dutySlots);
  const idx = slots.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  slots[idx] = { ...slots[idx], ...updates, updated_at: new Date() };
  saveToStorage(KEYS.dutySlots, slots);
  return slots[idx];
}

export function deleteDutySlot(id: string): boolean {
  const slots = getFromStorage<DutySlot>(KEYS.dutySlots);
  const filtered = slots.filter((s) => s.id !== id);
  if (filtered.length === slots.length) return false;
  saveToStorage(KEYS.dutySlots, filtered);
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
  return count;
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
  return na;
}

export function updateNonAvailability(id: string, updates: Partial<NonAvailability>): NonAvailability | null {
  const list = getFromStorage<NonAvailability>(KEYS.nonAvailability);
  const idx = list.findIndex((na) => na.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...updates };
  saveToStorage(KEYS.nonAvailability, list);
  return list[idx];
}

export function deleteNonAvailability(id: string): boolean {
  const list = getFromStorage<NonAvailability>(KEYS.nonAvailability);
  const filtered = list.filter((na) => na.id !== id);
  if (filtered.length === list.length) return false;
  saveToStorage(KEYS.nonAvailability, filtered);
  return true;
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
  return qual;
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
  errors: string[]
} {
  const result = {
    personnel: { created: 0, updated: 0 },
    units: { created: 0 },
    nonAvailability: { created: 0 },
    errors: [] as string[],
  };

  // Get existing units (keep them) and clear personnel
  const units = getFromStorage<UnitSection>(KEYS.units);
  const newPersonnel: Personnel[] = [];
  const newNonAvailList: NonAvailability[] = [];

  // Track units by name for lookup and creation
  const unitMap = new Map<string, string>(); // name -> id
  units.forEach(u => unitMap.set(u.unit_name, u.id));

  // Track hierarchy: company -> section -> workSection
  const companySet = new Set<string>();
  const sectionSet = new Set<string>();
  const workSectionSet = new Set<string>();

  // First pass: collect all unique unit levels from records
  for (const record of records) {
    if (!record.unit) continue;
    const parsed = parseUnitCode(record.unit);

    if (parsed.company) {
      const companyName = `${parsed.company} Company`;
      companySet.add(companyName);

      if (parsed.section) {
        sectionSet.add(`${companyName}|${parsed.section}`);

        if (parsed.workSection) {
          workSectionSet.add(`${companyName}|${parsed.section}|${parsed.workSection}`);
        }
      }
    }
  }

  // Create Company units
  for (const companyName of companySet) {
    if (!unitMap.has(companyName)) {
      const newUnit: UnitSection = {
        id: crypto.randomUUID(),
        parent_id: null,
        unit_name: companyName,
        hierarchy_level: "company",
        created_at: new Date(),
        updated_at: new Date(),
      };
      units.push(newUnit);
      unitMap.set(companyName, newUnit.id);
      result.units.created++;
    }
  }

  // Create Section units under their Company
  for (const combo of sectionSet) {
    const [companyName, sectionCode] = combo.split("|");
    if (!unitMap.has(sectionCode)) {
      const parentId = unitMap.get(companyName);
      const newUnit: UnitSection = {
        id: crypto.randomUUID(),
        parent_id: parentId || null,
        unit_name: sectionCode,
        hierarchy_level: "section",
        created_at: new Date(),
        updated_at: new Date(),
      };
      units.push(newUnit);
      unitMap.set(sectionCode, newUnit.id);
      result.units.created++;
    }
  }

  // Create Work Section units under their Section
  for (const combo of workSectionSet) {
    const [, sectionCode, workSectionCode] = combo.split("|");
    if (!unitMap.has(workSectionCode)) {
      const parentId = unitMap.get(sectionCode);
      const newUnit: UnitSection = {
        id: crypto.randomUUID(),
        parent_id: parentId || null,
        unit_name: workSectionCode,
        hierarchy_level: "work_section",
        created_at: new Date(),
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
  return getAllSeedUsers();
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

  console.warn("Role assigned in memory cache. To persist, update seed data files and re-export.");
  return true;
}

// Update user's non-availability approval permission
export function updateUserApprovalPermission(
  userId: string,
  canApprove: boolean
): boolean {
  // Note: This only updates memory cache. To persist, use GitHub workflow.
  const user = seedUsersCache.find((u) => u.id === userId);
  if (!user) return false;

  user.can_approve_non_availability = canApprove;

  console.warn("Approval permission updated in memory cache. To persist, use the update workflow.");
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
// No localStorage is used for user storage - only seed data files

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
export async function loadSeedUsers(): Promise<{ usersLoaded: number }> {
  if (typeof window === "undefined") {
    return { usersLoaded: 0 };
  }

  // If already loaded, return cached count
  if (seedUsersCache.length > 0) {
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
        created_at: userData.created_at,
        password_hash: userData.password_hash,
      };
      loadedUsers.push(user);
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

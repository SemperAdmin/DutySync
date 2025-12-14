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
  seedDataLoaded: "dutysync_seed_loaded",
};

// ============ Seed Data Loading ============

// Load seed data from JSON files if localStorage is empty
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

  let unitsLoaded = 0;
  let personnelLoaded = 0;

  try {
    // Load unit structure
    const unitResponse = await fetch("/data/unit-structure.json");
    if (unitResponse.ok) {
      const unitData = await unitResponse.json();
      if (unitData.units && Array.isArray(unitData.units)) {
        saveToStorage(KEYS.units, unitData.units);
        unitsLoaded = unitData.units.length;
      }
    }

    // Load personnel
    const personnelResponse = await fetch("/data/unit-members.json");
    if (personnelResponse.ok) {
      const personnelData = await personnelResponse.json();
      if (personnelData.personnel && Array.isArray(personnelData.personnel)) {
        // Add timestamps to personnel records
        const personnelWithDates = personnelData.personnel.map((p: Personnel) => ({
          ...p,
          created_at: p.created_at || new Date(),
          updated_at: p.updated_at || new Date(),
        }));
        saveToStorage(KEYS.personnel, personnelWithDates);
        personnelLoaded = personnelWithDates.length;
      }
    }

    // Mark seed data as loaded
    localStorage.setItem(KEYS.seedDataLoaded, "true");

    console.log(`Seed data loaded: ${unitsLoaded} units, ${personnelLoaded} personnel`);
  } catch (error) {
    console.error("Failed to load seed data:", error);
  }

  return { unitsLoaded, personnelLoaded, alreadyLoaded: false };
}

// Force reload seed data (clears existing and reloads from JSON)
export async function reloadSeedData(): Promise<{
  unitsLoaded: number;
  personnelLoaded: number;
}> {
  if (typeof window === "undefined") {
    return { unitsLoaded: 0, personnelLoaded: 0 };
  }

  // Clear existing data
  localStorage.removeItem(KEYS.units);
  localStorage.removeItem(KEYS.personnel);
  localStorage.removeItem(KEYS.seedDataLoaded);

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
    const levelOrder: Record<string, number> = { battalion: 0, company: 1, platoon: 2, section: 3 };
    return (levelOrder[a.hierarchy_level] || 0) - (levelOrder[b.hierarchy_level] || 0);
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
  return getFromStorage<Personnel>(KEYS.personnel).sort((a, b) =>
    a.last_name.localeCompare(b.last_name)
  );
}

export function getPersonnelByUnit(unitId: string): Personnel[] {
  return getFromStorage<Personnel>(KEYS.personnel).filter((p) => p.unit_section_id === unitId);
}

export function getPersonnelById(id: string): Personnel | undefined {
  return getFromStorage<Personnel>(KEYS.personnel).find((p) => p.id === id);
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
  personnel: { id: string; first_name: string; last_name: string; rank: string } | null;
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
      personnel: personnel ? { id: personnel.id, first_name: personnel.first_name, last_name: personnel.last_name, rank: personnel.rank } : null,
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

// Parse unit code like "02301-H-S1DV-CUST" into RUC and section
function parseUnitCode(unitCode: string): { ruc: string; section: string | null } {
  // Pattern: BASE-X-XXXX-SECTION or BASE-X-XXXX
  const parts = unitCode.split("-");
  if (parts.length >= 4) {
    // Has section: 02301-H-S1DV-CUST -> ruc: 02301-H-S1DV, section: CUST
    const section = parts.slice(3).join("-");
    const ruc = parts.slice(0, 3).join("-");
    return { ruc, section };
  } else if (parts.length === 3) {
    // No section, just RUC: 02301-H-S1DV
    return { ruc: unitCode, section: null };
  }
  return { ruc: unitCode, section: null };
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

// Parse the manpower TSV format
export function parseManpowerTsv(content: string): ManpowerRecord[] {
  const lines = content.split("\n");
  const records: ManpowerRecord[] = [];

  // Find the header row (contains "Rank" and "EDIPI")
  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const line = lines[i].toLowerCase();
    if (line.includes("rank") && line.includes("edipi") && line.includes("name")) {
      headerIdx = i;
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

    // Split by tab
    const values = line.split("\t").map(v => cleanTsvValue(v));

    // Need at least rank, name, edipi, sex, edd, unit, category, status, location, start, end
    if (values.length < 6) continue;

    // Validate EDIPI is 10 digits
    const edipi = values[2]?.replace(/\D/g, "");
    if (!edipi || edipi.length !== 10) continue;

    records.push({
      rank: values[0] || "",
      name: values[1] || "",
      edipi: edipi,
      sex: values[3] || "",
      edd: values[4] || "",
      unit: values[5] || "",
      category: values[6] || "",
      dutyStatus: values[7] || "",
      location: values[8] || "",
      startDate: values[9] || "",
      endDate: values[10] || "",
    });
  }

  return records;
}

// Import manpower data, auto-creating units as needed
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

  const personnel = getFromStorage<Personnel>(KEYS.personnel);
  const units = getFromStorage<UnitSection>(KEYS.units);
  const nonAvailList = getFromStorage<NonAvailability>(KEYS.nonAvailability);

  // Track created units to avoid duplicates
  const unitMap = new Map<string, string>(); // code -> id
  units.forEach(u => unitMap.set(u.unit_name, u.id));

  // First pass: create units from unit codes
  const rucSet = new Set<string>();
  const sectionSet = new Set<string>();

  for (const record of records) {
    if (!record.unit) continue;
    const { ruc, section } = parseUnitCode(record.unit);
    rucSet.add(ruc);
    if (section) sectionSet.add(`${ruc}|${section}`);
  }

  // Create RUC units (battalion level)
  for (const ruc of rucSet) {
    if (!unitMap.has(ruc)) {
      const newUnit: UnitSection = {
        id: crypto.randomUUID(),
        parent_id: null,
        unit_name: ruc,
        hierarchy_level: "battalion",
        created_at: new Date(),
        updated_at: new Date(),
      };
      units.push(newUnit);
      unitMap.set(ruc, newUnit.id);
      result.units.created++;
    }
  }

  // Create section units under their RUC parent
  for (const combo of sectionSet) {
    const [ruc, section] = combo.split("|");
    const fullName = `${ruc}-${section}`;
    if (!unitMap.has(fullName)) {
      const parentId = unitMap.get(ruc);
      const newUnit: UnitSection = {
        id: crypto.randomUUID(),
        parent_id: parentId || null,
        unit_name: fullName,
        hierarchy_level: "section",
        created_at: new Date(),
        updated_at: new Date(),
      };
      units.push(newUnit);
      unitMap.set(fullName, newUnit.id);
      result.units.created++;
    }
  }

  // Second pass: create/update personnel
  for (const record of records) {
    try {
      const { first_name, last_name } = parseName(record.name);
      const { ruc, section } = parseUnitCode(record.unit);
      const unitName = section ? `${ruc}-${section}` : ruc;
      const unitId = unitMap.get(unitName);

      if (!unitId) {
        result.errors.push(`No unit for ${record.edipi}: ${record.unit}`);
        continue;
      }

      // Check if personnel exists by EDIPI
      const existingIdx = personnel.findIndex(p => p.service_id === record.edipi);

      if (existingIdx !== -1) {
        // Update existing
        personnel[existingIdx] = {
          ...personnel[existingIdx],
          first_name,
          last_name,
          rank: record.rank,
          unit_section_id: unitId,
          updated_at: new Date(),
        };
        result.personnel.updated++;
      } else {
        // Create new
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
        personnel.push(newPerson);
        result.personnel.created++;
      }

      // Create non-availability if on Leave or TAD
      if (record.category === "Leave" || record.category === "TAD") {
        const startDate = parseManpowerDate(record.startDate);
        const endDate = parseManpowerDate(record.endDate);

        if (startDate && endDate) {
          const personId = personnel.find(p => p.service_id === record.edipi)?.id;
          if (personId) {
            // Check if this non-availability already exists
            const exists = nonAvailList.some(na =>
              na.personnel_id === personId &&
              new Date(na.start_date).getTime() === startDate.getTime() &&
              new Date(na.end_date).getTime() === endDate.getTime()
            );

            if (!exists) {
              const newNa: NonAvailability = {
                id: crypto.randomUUID(),
                personnel_id: personId,
                start_date: startDate,
                end_date: endDate,
                reason: `${record.category}: ${record.dutyStatus} - ${record.location}`,
                status: "approved",
                approved_by: null,
                created_at: new Date(),
              };
              nonAvailList.push(newNa);
              result.nonAvailability.created++;
            }
          }
        }
      }
    } catch (err) {
      result.errors.push(`Error processing ${record.edipi}: ${err}`);
    }
  }

  // Save all data
  saveToStorage(KEYS.units, units);
  saveToStorage(KEYS.personnel, personnel);
  saveToStorage(KEYS.nonAvailability, nonAvailList);

  return result;
}

// Get personnel by EDIPI (service_id)
export function getPersonnelByEdipi(edipi: string): Personnel | undefined {
  return getFromStorage<Personnel>(KEYS.personnel).find(p => p.service_id === edipi);
}

// ============ User Management (from localStorage) ============

interface StoredUser {
  id: string;
  edipi: string;
  email: string;
  password?: string;
  personnel_id?: string | null;
  roles: Array<{
    id?: string;
    role_name: string;
    scope_unit_id: string | null;
  }>;
  created_at?: string;
}

export function getAllUsers(): StoredUser[] {
  if (typeof window === "undefined") return [];
  try {
    const users = JSON.parse(localStorage.getItem("dutysync_users") || "[]");
    // Add the demo admin if not in list
    const hasAdmin = users.some((u: StoredUser) => u.edipi === "1234567890");
    if (!hasAdmin) {
      return [
        {
          id: "admin-001",
          edipi: "1234567890",
          email: "admin@dutysync.mil",
          personnel_id: null,
          roles: [{ id: "role-001", role_name: "App Admin", scope_unit_id: null }],
        },
        ...users,
      ];
    }
    return users;
  } catch {
    return [];
  }
}

export function getUserById(id: string): StoredUser | undefined {
  return getAllUsers().find((u) => u.id === id);
}

export function assignUserRole(
  userId: string,
  roleName: string,
  scopeUnitId?: string | null
): boolean {
  if (typeof window === "undefined") return false;
  try {
    const users = JSON.parse(localStorage.getItem("dutysync_users") || "[]");
    const idx = users.findIndex((u: StoredUser) => u.id === userId);
    if (idx === -1) return false;

    // Initialize roles array if needed
    users[idx].roles = users[idx].roles || [];

    // Check if this exact role already exists (same role name AND same scope unit)
    const roleExists = users[idx].roles.some(
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
    users[idx].roles.push(newRole);

    localStorage.setItem("dutysync_users", JSON.stringify(users));
    return true;
  } catch (error) {
    console.error("Failed to assign user role:", error);
    return false;
  }
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

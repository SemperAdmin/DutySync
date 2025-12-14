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
};

// Helper to safely get from localStorage
function getFromStorage<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  } catch {
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

export function deleteUnitSection(id: string): boolean {
  const units = getFromStorage<UnitSection>(KEYS.units);
  const filtered = units.filter((u) => u.id !== id);
  if (filtered.length === units.length) return false;
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

// ============ User Management (from localStorage) ============

interface StoredUser {
  id: string;
  username: string;
  email: string;
  password?: string;
  serviceId?: string | null;
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
    const hasAdmin = users.some((u: StoredUser) => u.username === "admin");
    if (!hasAdmin) {
      return [
        {
          id: "admin-001",
          username: "admin",
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

    const newRole = {
      id: `role-${Date.now()}`,
      role_name: roleName,
      scope_unit_id: scopeUnitId || null,
    };

    // Check if role already exists
    const existingRoleIdx = users[idx].roles?.findIndex(
      (r: { role_name: string }) => r.role_name === roleName
    );

    if (existingRoleIdx !== undefined && existingRoleIdx >= 0) {
      users[idx].roles[existingRoleIdx] = newRole;
    } else {
      users[idx].roles = users[idx].roles || [];
      users[idx].roles.push(newRole);
    }

    localStorage.setItem("dutysync_users", JSON.stringify(users));
    return true;
  } catch {
    return false;
  }
}

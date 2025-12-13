// In-memory stores for MVP development
// In production, these will be replaced with Hasura/Neon PostgreSQL

import type { UnitSection, Personnel, DutyType, UserRole, DutyValue, DutyRequirement, DutySlot, NonAvailability, Qualification } from "@/types";

// Unit Sections Store
export const unitSectionStore: Map<string, UnitSection> = new Map();

// Personnel Store
export const personnelStore: Map<string, Personnel> = new Map();

// Duty Types Store
export const dutyTypeStore: Map<string, DutyType> = new Map();

// Duty Values Store
export const dutyValueStore: Map<string, DutyValue> = new Map();

// Duty Requirements Store (composite key: duty_type_id + qual_name)
export const dutyRequirementStore: Map<string, DutyRequirement> = new Map();

// Duty Slots Store (the scheduled duties)
export const dutySlotStore: Map<string, DutySlot> = new Map();

// Non-Availability Store
export const nonAvailabilityStore: Map<string, NonAvailability> = new Map();

// Qualifications Store (composite key: personnel_id + qual_name)
export const qualificationStore: Map<string, Qualification> = new Map();

// Helper functions for Unit Sections
export function getUnitSections(): UnitSection[] {
  return Array.from(unitSectionStore.values()).sort((a, b) => {
    const levelOrder = { battalion: 0, company: 1, platoon: 2, section: 3 };
    return levelOrder[a.hierarchy_level] - levelOrder[b.hierarchy_level];
  });
}

export function getUnitSectionById(id: string): UnitSection | undefined {
  return unitSectionStore.get(id);
}

export function getChildUnits(parentId: string): UnitSection[] {
  return Array.from(unitSectionStore.values()).filter(
    (unit) => unit.parent_id === parentId
  );
}

export function createUnitSection(unit: UnitSection): UnitSection {
  unitSectionStore.set(unit.id, unit);
  return unit;
}

export function updateUnitSection(id: string, updates: Partial<UnitSection>): UnitSection | null {
  const existing = unitSectionStore.get(id);
  if (!existing) return null;

  const updated = { ...existing, ...updates, updated_at: new Date() };
  unitSectionStore.set(id, updated);
  return updated;
}

export function deleteUnitSection(id: string): boolean {
  // Check for child units first
  const children = getChildUnits(id);
  if (children.length > 0) {
    return false; // Cannot delete unit with children
  }
  return unitSectionStore.delete(id);
}

// Helper functions for Personnel
export function getAllPersonnel(): Personnel[] {
  return Array.from(personnelStore.values()).sort((a, b) =>
    a.last_name.localeCompare(b.last_name)
  );
}

export function getPersonnelByUnit(unitId: string): Personnel[] {
  return Array.from(personnelStore.values()).filter(
    (p) => p.unit_section_id === unitId
  );
}

export function getPersonnelById(id: string): Personnel | undefined {
  return personnelStore.get(id);
}

export function getPersonnelByServiceId(serviceId: string): Personnel | undefined {
  return Array.from(personnelStore.values()).find(
    (p) => p.service_id === serviceId
  );
}

export function createPersonnel(person: Personnel): Personnel {
  personnelStore.set(person.id, person);
  return person;
}

export function updatePersonnel(id: string, updates: Partial<Personnel>): Personnel | null {
  const existing = personnelStore.get(id);
  if (!existing) return null;

  const updated = { ...existing, ...updates, updated_at: new Date() };
  personnelStore.set(id, updated);
  return updated;
}

export function deletePersonnel(id: string): boolean {
  return personnelStore.delete(id);
}

export function bulkCreatePersonnel(personnel: Personnel[]): { created: number; updated: number; errors: string[] } {
  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  for (const person of personnel) {
    try {
      const existing = getPersonnelByServiceId(person.service_id);
      if (existing) {
        // Update existing record
        updatePersonnel(existing.id, {
          first_name: person.first_name,
          last_name: person.last_name,
          rank: person.rank,
          unit_section_id: person.unit_section_id,
        });
        updated++;
      } else {
        // Create new record
        personnelStore.set(person.id, person);
        created++;
      }
    } catch (err) {
      errors.push(`Failed to process ${person.service_id}: ${err}`);
    }
  }

  return { created, updated, errors };
}

// Export user role store reference from auth
export { userStore } from "./auth";

// Helper to assign Unit Admin role
export function assignUnitAdminRole(
  userId: string,
  unitId: string,
  currentRoles: UserRole[]
): UserRole[] {
  const newRole: UserRole = {
    id: crypto.randomUUID(),
    user_id: userId,
    role_name: "Unit Admin",
    scope_unit_id: unitId,
    created_at: new Date(),
  };

  // Remove existing Unit Admin role for this unit if any
  const filteredRoles = currentRoles.filter(
    (r) => !(r.role_name === "Unit Admin" && r.scope_unit_id === unitId)
  );

  return [...filteredRoles, newRole];
}

// Helper functions for Duty Types
export function getAllDutyTypes(): DutyType[] {
  return Array.from(dutyTypeStore.values()).sort((a, b) =>
    a.duty_name.localeCompare(b.duty_name)
  );
}

export function getDutyTypesByUnit(unitId: string): DutyType[] {
  return Array.from(dutyTypeStore.values()).filter(
    (dt) => dt.unit_section_id === unitId
  );
}

export function getDutyTypeById(id: string): DutyType | undefined {
  return dutyTypeStore.get(id);
}

export function createDutyType(dutyType: DutyType): DutyType {
  dutyTypeStore.set(dutyType.id, dutyType);
  return dutyType;
}

export function updateDutyType(id: string, updates: Partial<DutyType>): DutyType | null {
  const existing = dutyTypeStore.get(id);
  if (!existing) return null;

  const updated = { ...existing, ...updates, updated_at: new Date() };
  dutyTypeStore.set(id, updated);
  return updated;
}

export function deleteDutyType(id: string): boolean {
  // Also delete associated requirements and values
  const requirements = getDutyRequirements(id);
  requirements.forEach((req) => {
    deleteDutyRequirement(id, req.required_qual_name);
  });

  const dutyValue = getDutyValueByDutyType(id);
  if (dutyValue) {
    dutyValueStore.delete(dutyValue.id);
  }

  return dutyTypeStore.delete(id);
}

// Helper functions for Duty Values
export function getAllDutyValues(): DutyValue[] {
  return Array.from(dutyValueStore.values());
}

export function getDutyValueById(id: string): DutyValue | undefined {
  return dutyValueStore.get(id);
}

export function getDutyValueByDutyType(dutyTypeId: string): DutyValue | undefined {
  return Array.from(dutyValueStore.values()).find(
    (dv) => dv.duty_type_id === dutyTypeId
  );
}

export function createDutyValue(dutyValue: DutyValue): DutyValue {
  dutyValueStore.set(dutyValue.id, dutyValue);
  return dutyValue;
}

export function updateDutyValue(id: string, updates: Partial<DutyValue>): DutyValue | null {
  const existing = dutyValueStore.get(id);
  if (!existing) return null;

  const updated = { ...existing, ...updates };
  dutyValueStore.set(id, updated);
  return updated;
}

export function deleteDutyValue(id: string): boolean {
  return dutyValueStore.delete(id);
}

// Helper functions for Duty Requirements
export function getDutyRequirements(dutyTypeId: string): DutyRequirement[] {
  return Array.from(dutyRequirementStore.values()).filter(
    (dr) => dr.duty_type_id === dutyTypeId
  );
}

export function addDutyRequirement(dutyTypeId: string, qualName: string): DutyRequirement {
  const key = `${dutyTypeId}:${qualName}`;
  const requirement: DutyRequirement = {
    duty_type_id: dutyTypeId,
    required_qual_name: qualName,
  };
  dutyRequirementStore.set(key, requirement);
  return requirement;
}

export function deleteDutyRequirement(dutyTypeId: string, qualName: string): boolean {
  const key = `${dutyTypeId}:${qualName}`;
  return dutyRequirementStore.delete(key);
}

export function clearDutyRequirements(dutyTypeId: string): void {
  const requirements = getDutyRequirements(dutyTypeId);
  requirements.forEach((req) => {
    deleteDutyRequirement(dutyTypeId, req.required_qual_name);
  });
}

// Helper functions for Duty Slots
export function getAllDutySlots(): DutySlot[] {
  return Array.from(dutySlotStore.values()).sort(
    (a, b) => new Date(a.date_assigned).getTime() - new Date(b.date_assigned).getTime()
  );
}

export function getDutySlotById(id: string): DutySlot | undefined {
  return dutySlotStore.get(id);
}

export function getDutySlotsByDateRange(startDate: Date, endDate: Date): DutySlot[] {
  return Array.from(dutySlotStore.values()).filter((slot) => {
    const slotDate = new Date(slot.date_assigned);
    return slotDate >= startDate && slotDate <= endDate;
  });
}

export function getDutySlotsByUnit(unitId: string): DutySlot[] {
  const unitDutyTypes = getDutyTypesByUnit(unitId);
  const dutyTypeIds = new Set(unitDutyTypes.map((dt) => dt.id));
  return Array.from(dutySlotStore.values()).filter((slot) =>
    dutyTypeIds.has(slot.duty_type_id)
  );
}

export function getDutySlotsByPersonnel(personnelId: string): DutySlot[] {
  return Array.from(dutySlotStore.values()).filter(
    (slot) => slot.personnel_id === personnelId
  );
}

export function getDutySlotsByDate(date: Date): DutySlot[] {
  const dateStr = date.toISOString().split("T")[0];
  return Array.from(dutySlotStore.values()).filter((slot) => {
    const slotDateStr = new Date(slot.date_assigned).toISOString().split("T")[0];
    return slotDateStr === dateStr;
  });
}

export function createDutySlot(slot: DutySlot): DutySlot {
  dutySlotStore.set(slot.id, slot);
  return slot;
}

export function updateDutySlot(id: string, updates: Partial<DutySlot>): DutySlot | null {
  const existing = dutySlotStore.get(id);
  if (!existing) return null;

  const updated = { ...existing, ...updates, updated_at: new Date() };
  dutySlotStore.set(id, updated);
  return updated;
}

export function deleteDutySlot(id: string): boolean {
  return dutySlotStore.delete(id);
}

export function clearDutySlotsInRange(startDate: Date, endDate: Date, unitId?: string): number {
  let count = 0;
  const slots = getDutySlotsByDateRange(startDate, endDate);

  for (const slot of slots) {
    if (unitId) {
      const dutyType = getDutyTypeById(slot.duty_type_id);
      if (dutyType?.unit_section_id !== unitId) continue;
    }
    if (dutySlotStore.delete(slot.id)) {
      count++;
    }
  }
  return count;
}

// Helper functions for Non-Availability
export function getAllNonAvailability(): NonAvailability[] {
  return Array.from(nonAvailabilityStore.values()).sort(
    (a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime()
  );
}

export function getNonAvailabilityById(id: string): NonAvailability | undefined {
  return nonAvailabilityStore.get(id);
}

export function getNonAvailabilityByPersonnel(personnelId: string): NonAvailability[] {
  return Array.from(nonAvailabilityStore.values()).filter(
    (na) => na.personnel_id === personnelId
  );
}

export function getActiveNonAvailability(personnelId: string, date: Date): NonAvailability | undefined {
  const dateTime = date.getTime();
  return Array.from(nonAvailabilityStore.values()).find((na) => {
    if (na.personnel_id !== personnelId) return false;
    if (na.status !== "approved") return false;
    const start = new Date(na.start_date).getTime();
    const end = new Date(na.end_date).getTime();
    return dateTime >= start && dateTime <= end;
  });
}

export function createNonAvailability(na: NonAvailability): NonAvailability {
  nonAvailabilityStore.set(na.id, na);
  return na;
}

export function updateNonAvailability(id: string, updates: Partial<NonAvailability>): NonAvailability | null {
  const existing = nonAvailabilityStore.get(id);
  if (!existing) return null;

  const updated = { ...existing, ...updates };
  nonAvailabilityStore.set(id, updated);
  return updated;
}

export function deleteNonAvailability(id: string): boolean {
  return nonAvailabilityStore.delete(id);
}

// Helper functions for Qualifications
export function getQualificationsByPersonnel(personnelId: string): Qualification[] {
  return Array.from(qualificationStore.values()).filter(
    (q) => q.personnel_id === personnelId
  );
}

export function hasQualification(personnelId: string, qualName: string): boolean {
  const key = `${personnelId}:${qualName}`;
  return qualificationStore.has(key);
}

export function addQualification(personnelId: string, qualName: string): Qualification {
  const key = `${personnelId}:${qualName}`;
  const qualification: Qualification = {
    personnel_id: personnelId,
    qual_name: qualName,
    granted_at: new Date(),
  };
  qualificationStore.set(key, qualification);
  return qualification;
}

export function removeQualification(personnelId: string, qualName: string): boolean {
  const key = `${personnelId}:${qualName}`;
  return qualificationStore.delete(key);
}

export function clearPersonnelQualifications(personnelId: string): void {
  const quals = getQualificationsByPersonnel(personnelId);
  quals.forEach((q) => {
    removeQualification(personnelId, q.qual_name);
  });
}

// In-memory stores for MVP development
// In production, these will be replaced with Hasura/Neon PostgreSQL

import type { UnitSection, Personnel, DutyType, UserRole, DutyValue } from "@/types";

// Unit Sections Store
export const unitSectionStore: Map<string, UnitSection> = new Map();

// Personnel Store
export const personnelStore: Map<string, Personnel> = new Map();

// Duty Types Store
export const dutyTypeStore: Map<string, DutyType> = new Map();

// Duty Values Store
export const dutyValueStore: Map<string, DutyValue> = new Map();

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

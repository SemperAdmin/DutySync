"use client";

/**
 * Data Layer - Unified data access for DutySync
 *
 * This module provides async functions that fetch data from Supabase
 * and convert them to the local type format used by components.
 */

import * as supabase from "./supabase-data";
import type {
  UnitSection,
  Personnel,
  DutyType,
  DutySlot,
  NonAvailability,
  DutyChangeRequest,
  Qualification,
  DutyValue,
  DutyRequirement,
  BlockedDuty,
  RoleName,
} from "@/types";
import type {
  Unit as SupabaseUnit,
  Personnel as SupabasePersonnel,
  DutyType as SupabaseDbDutyType,
  DutySlot as SupabaseDutySlot,
  NonAvailability as SupabaseNonAvailability,
  Organization,
} from "@/types/supabase";

// ============================================================================
// TYPE CONVERTERS - Convert Supabase types to local types
// ============================================================================

function convertUnit(unit: SupabaseUnit, ruc?: string): UnitSection & { organization_id?: string } {
  return {
    id: unit.id,
    parent_id: unit.parent_id,
    unit_name: unit.unit_name,
    unit_code: unit.unit_code || undefined,
    hierarchy_level: unit.hierarchy_level,
    description: unit.description || undefined,
    ruc: ruc,
    organization_id: unit.organization_id,
    created_at: new Date(unit.created_at),
    updated_at: new Date(unit.updated_at),
  };
}

function convertPersonnel(p: SupabasePersonnel): Personnel {
  return {
    id: p.id,
    service_id: p.service_id,
    unit_section_id: p.unit_id,
    first_name: p.first_name,
    last_name: p.last_name,
    rank: p.rank,
    current_duty_score: p.current_duty_score,
    created_at: new Date(p.created_at),
    updated_at: new Date(p.updated_at),
  };
}

function convertDutyType(dt: SupabaseDbDutyType): DutyType {
  return {
    id: dt.id,
    unit_section_id: dt.unit_id,
    duty_name: dt.name,
    description: dt.description,
    notes: null,
    slots_needed: dt.personnel_required,
    required_rank_min: null,
    required_rank_max: null,
    is_active: true,
    rank_filter_mode: dt.rank_filter_mode === "none" ? null : dt.rank_filter_mode,
    rank_filter_values: dt.rank_filter_values,
    section_filter_mode: dt.section_filter_mode === "none" ? null : dt.section_filter_mode,
    section_filter_values: dt.section_filter_values,
    created_at: new Date(dt.created_at),
    updated_at: new Date(dt.updated_at),
  };
}

function convertDutySlot(slot: SupabaseDutySlot): DutySlot {
  // Map Supabase status to local status type
  let status: "scheduled" | "completed" | "cancelled";
  switch (slot.status) {
    case "scheduled":
      status = "scheduled";
      break;
    case "completed":
    case "swapped":
      status = "completed";
      break;
    case "missed":
    default:
      status = "cancelled";
      break;
  }

  return {
    id: slot.id,
    duty_type_id: slot.duty_type_id,
    personnel_id: slot.personnel_id,
    date_assigned: new Date(slot.date_assigned),
    assigned_by: slot.assigned_by || "",
    duty_points_earned: 0, // Calculate based on duty values if needed
    status,
    created_at: new Date(slot.created_at),
    updated_at: new Date(slot.updated_at),
  };
}

function convertNonAvailability(na: SupabaseNonAvailability): NonAvailability {
  return {
    id: na.id,
    personnel_id: na.personnel_id,
    start_date: new Date(na.start_date),
    end_date: new Date(na.end_date),
    reason: na.reason || "",
    status: na.status,
    recommended_by: null,
    approved_by: na.approved_by,
    created_at: new Date(na.created_at),
  };
}

// ============================================================================
// ORGANIZATIONS / RUCs
// ============================================================================

export interface RucEntry {
  id: string;
  ruc: string;
  name: string | null;
}

let organizationsCache: Organization[] = [];
let rucEntriesCache: RucEntry[] = [];

export async function loadRucs(): Promise<RucEntry[]> {
  const orgs = await supabase.getOrganizations();
  organizationsCache = orgs;
  rucEntriesCache = orgs.map(org => ({
    id: org.id,
    ruc: org.ruc_code,
    name: org.name,
  }));
  return rucEntriesCache;
}

export function getAllRucs(): RucEntry[] {
  return rucEntriesCache;
}

export function getRucByCode(rucCode: string): RucEntry | undefined {
  return rucEntriesCache.find(r => r.ruc === rucCode);
}

export function getRucDisplayName(rucCode: string): string {
  const ruc = getRucByCode(rucCode);
  if (ruc && ruc.name) {
    return `${ruc.ruc} - ${ruc.name}`;
  }
  return rucCode;
}

export function searchRucs(query: string): RucEntry[] {
  const q = query.toLowerCase();
  return getAllRucs().filter(r =>
    r.ruc.includes(q) ||
    (r.name && r.name.toLowerCase().includes(q))
  );
}

export async function getOrganizationByRuc(rucCode: string): Promise<Organization | null> {
  return supabase.getOrganizationByRuc(rucCode);
}

// ============================================================================
// UNITS
// ============================================================================

let unitsCache: UnitSection[] = [];
let unitsByIdCache = new Map<string, UnitSection>();

export async function loadUnits(organizationId?: string): Promise<UnitSection[]> {
  const units = await supabase.getUnits(organizationId);

  // Get organization for RUC code
  let rucCode: string | undefined;
  if (organizationId) {
    const org = organizationsCache.find(o => o.id === organizationId);
    rucCode = org?.ruc_code;
  }

  unitsCache = units.map(u => convertUnit(u, rucCode));
  unitsByIdCache.clear();
  for (const unit of unitsCache) {
    unitsByIdCache.set(unit.id, unit);
  }
  return unitsCache;
}

export async function loadUnitsByRuc(rucCode: string): Promise<UnitSection[]> {
  const org = await supabase.getOrganizationByRuc(rucCode);
  if (!org) return [];
  return loadUnits(org.id);
}

export function getUnitSections(): UnitSection[] {
  return unitsCache;
}

export function getUnitById(id: string): UnitSection | undefined {
  return unitsByIdCache.get(id);
}

export async function getChildUnits(parentId: string): Promise<UnitSection[]> {
  const children = await supabase.getChildUnits(parentId);
  return children.map(u => convertUnit(u));
}

export async function getAllDescendantUnitIds(parentId: string): Promise<string[]> {
  return supabase.getDescendantUnitIds(parentId);
}

export async function createUnitSection(
  organizationIdOrUnit: string | Partial<UnitSection>,
  unitName?: string,
  hierarchyLevel?: string,
  parentId?: string,
  unitCode?: string,
  description?: string
): Promise<UnitSection | null> {
  // Handle legacy call with unit object
  if (typeof organizationIdOrUnit === "object") {
    const unitObj = organizationIdOrUnit;
    // Try to determine organization from parent unit
    let orgId: string | undefined;
    if (unitObj.parent_id) {
      const parent = unitsByIdCache.get(unitObj.parent_id);
      if (parent && parent.ruc) {
        const org = organizationsCache.find(o => o.ruc_code === parent.ruc);
        orgId = org?.id;
      }
    }
    if (!orgId && organizationsCache.length > 0) {
      // Default to first organization
      orgId = organizationsCache[0].id;
    }
    if (!orgId) {
      console.error("No organization found for creating unit");
      return null;
    }
    return createUnitSection(
      orgId,
      unitObj.unit_name || "New Unit",
      unitObj.hierarchy_level || "section",
      unitObj.parent_id || undefined,
      unitObj.unit_code,
      unitObj.description
    );
  }

  const unit = await supabase.createUnit(
    organizationIdOrUnit,
    unitName!,
    hierarchyLevel as "unit" | "company" | "section" | "work_section",
    parentId,
    unitCode,
    description
  );
  if (!unit) return null;
  const converted = convertUnit(unit);
  unitsCache.push(converted);
  unitsByIdCache.set(converted.id, converted);
  return converted;
}

export async function updateUnitSection(
  id: string,
  updates: Partial<UnitSection>
): Promise<UnitSection | null> {
  const supabaseUpdates: Partial<SupabaseUnit> = {};
  if (updates.unit_name !== undefined) supabaseUpdates.unit_name = updates.unit_name;
  if (updates.unit_code !== undefined) supabaseUpdates.unit_code = updates.unit_code;
  if (updates.description !== undefined) supabaseUpdates.description = updates.description;
  if (updates.parent_id !== undefined) supabaseUpdates.parent_id = updates.parent_id;
  if (updates.hierarchy_level !== undefined) {
    supabaseUpdates.hierarchy_level = updates.hierarchy_level as "unit" | "company" | "section" | "work_section";
  }

  const updated = await supabase.updateUnit(id, supabaseUpdates);
  if (!updated) return null;
  const converted = convertUnit(updated);
  const idx = unitsCache.findIndex(u => u.id === id);
  if (idx >= 0) unitsCache[idx] = converted;
  unitsByIdCache.set(id, converted);
  return converted;
}

export async function deleteUnitSection(id: string): Promise<boolean> {
  const success = await supabase.deleteUnit(id);
  if (success) {
    unitsCache = unitsCache.filter(u => u.id !== id);
    unitsByIdCache.delete(id);
  }
  return success;
}

export async function getTopLevelUnitForOrganization(organizationId: string): Promise<UnitSection | null> {
  const unit = await supabase.getTopLevelUnitForOrganization(organizationId);
  if (!unit) return null;
  return convertUnit(unit);
}

// ============================================================================
// PERSONNEL
// ============================================================================

let personnelCache: Personnel[] = [];
let personnelByIdCache = new Map<string, Personnel>();

export async function loadPersonnel(organizationId?: string): Promise<Personnel[]> {
  const personnel = await supabase.getPersonnel(organizationId);
  personnelCache = personnel.map(convertPersonnel);
  personnelByIdCache.clear();
  for (const p of personnelCache) {
    personnelByIdCache.set(p.id, p);
  }
  return personnelCache;
}

export function getAllPersonnel(): Personnel[] {
  return personnelCache;
}

export function getPersonnelById(id: string): Personnel | undefined {
  return personnelByIdCache.get(id);
}

export function getPersonnelByEdipi(edipi: string): Personnel | null {
  // In the old system, service_id was the EDIPI
  return personnelCache.find(p => p.service_id === edipi) || null;
}

export function getPersonnelByUnitId(unitId: string): Personnel[] {
  return personnelCache.filter(p => p.unit_section_id === unitId);
}

export async function getPersonnelByUnitWithDescendants(unitId: string): Promise<Personnel[]> {
  const unitIds = await supabase.getDescendantUnitIds(unitId);
  return personnelCache.filter(p => unitIds.includes(p.unit_section_id));
}

export async function createPersonnel(
  organizationId: string,
  unitId: string,
  serviceId: string,
  firstName: string,
  lastName: string,
  rank: string
): Promise<Personnel | null> {
  const p = await supabase.createPersonnel(organizationId, unitId, serviceId, firstName, lastName, rank);
  if (!p) return null;
  const converted = convertPersonnel(p);
  personnelCache.push(converted);
  personnelByIdCache.set(converted.id, converted);
  return converted;
}

export async function updatePersonnel(
  id: string,
  updates: Partial<Personnel>
): Promise<Personnel | null> {
  const supabaseUpdates: Record<string, unknown> = {};
  if (updates.first_name !== undefined) supabaseUpdates.first_name = updates.first_name;
  if (updates.last_name !== undefined) supabaseUpdates.last_name = updates.last_name;
  if (updates.rank !== undefined) supabaseUpdates.rank = updates.rank;
  if (updates.unit_section_id !== undefined) supabaseUpdates.unit_id = updates.unit_section_id;
  if (updates.current_duty_score !== undefined) supabaseUpdates.current_duty_score = updates.current_duty_score;

  const updated = await supabase.updatePersonnel(id, supabaseUpdates);
  if (!updated) return null;
  const converted = convertPersonnel(updated);
  const idx = personnelCache.findIndex(p => p.id === id);
  if (idx >= 0) personnelCache[idx] = converted;
  personnelByIdCache.set(id, converted);
  return converted;
}

export async function deletePersonnelRecord(id: string): Promise<boolean> {
  const success = await supabase.deletePersonnel(id);
  if (success) {
    personnelCache = personnelCache.filter(p => p.id !== id);
    personnelByIdCache.delete(id);
  }
  return success;
}

// ============================================================================
// DUTY TYPES
// ============================================================================

let dutyTypesCache: DutyType[] = [];
let dutyTypesByIdCache = new Map<string, DutyType>();

export async function loadDutyTypes(organizationId?: string): Promise<DutyType[]> {
  const dutyTypes = await supabase.getDutyTypes(organizationId);
  dutyTypesCache = dutyTypes.map(convertDutyType);
  dutyTypesByIdCache.clear();
  for (const dt of dutyTypesCache) {
    dutyTypesByIdCache.set(dt.id, dt);
  }
  return dutyTypesCache;
}

export function getAllDutyTypes(): DutyType[] {
  return dutyTypesCache;
}

export function getDutyTypeById(id: string): DutyType | undefined {
  return dutyTypesByIdCache.get(id);
}

export function getDutyTypesByUnitId(unitId: string): DutyType[] {
  return dutyTypesCache.filter(dt => dt.unit_section_id === unitId);
}

// ============================================================================
// DUTY SLOTS
// ============================================================================

let dutySlotsCache: DutySlot[] = [];

export async function loadDutySlots(organizationId?: string, startDate?: string, endDate?: string): Promise<DutySlot[]> {
  const slots = await supabase.getDutySlots(organizationId, startDate, endDate);
  dutySlotsCache = slots.map(convertDutySlot);
  return dutySlotsCache;
}

export function getAllDutySlots(): DutySlot[] {
  return dutySlotsCache;
}

export function getDutySlotsByDateRange(startDate: Date, endDate: Date): DutySlot[] {
  return dutySlotsCache.filter(slot => {
    const slotDate = new Date(slot.date_assigned);
    return slotDate >= startDate && slotDate <= endDate;
  });
}

export function getDutySlotsByPersonnel(personnelId: string): DutySlot[] {
  return dutySlotsCache.filter(slot => slot.personnel_id === personnelId);
}

export async function createDutySlotRecord(
  organizationId: string,
  dutyTypeId: string,
  personnelId: string,
  dateAssigned: string,
  assignedBy?: string
): Promise<DutySlot | null> {
  const slot = await supabase.createDutySlot(organizationId, dutyTypeId, personnelId, dateAssigned, assignedBy);
  if (!slot) return null;
  const converted = convertDutySlot(slot);
  dutySlotsCache.push(converted);
  return converted;
}

// ============================================================================
// NON-AVAILABILITY
// ============================================================================

let nonAvailabilityCache: NonAvailability[] = [];

export async function loadNonAvailability(organizationId?: string): Promise<NonAvailability[]> {
  const na = await supabase.getNonAvailability(organizationId);
  nonAvailabilityCache = na.map(convertNonAvailability);
  return nonAvailabilityCache;
}

export function getAllNonAvailability(): NonAvailability[] {
  return nonAvailabilityCache;
}

export function getNonAvailabilityByPersonnel(personnelId: string): NonAvailability[] {
  return nonAvailabilityCache.filter(na => na.personnel_id === personnelId);
}

// ============================================================================
// DUTY CHANGE REQUESTS
// ============================================================================

let dutyChangeRequestsCache: DutyChangeRequest[] = [];

export function getAllDutyChangeRequests(): DutyChangeRequest[] {
  return dutyChangeRequestsCache;
}

export function getDutyChangeRequestsByPersonnel(personnelId: string): DutyChangeRequest[] {
  return dutyChangeRequestsCache.filter(
    dcr => dcr.original_personnel_id === personnelId || dcr.target_personnel_id === personnelId
  );
}

export function getPendingDutyChangeRequests(): DutyChangeRequest[] {
  return dutyChangeRequestsCache.filter(dcr => dcr.status === "pending");
}

// ============================================================================
// USERS
// ============================================================================

export interface SeedUser {
  id: string;
  edipi: string;
  email: string;
  personnel_id: string | null;
  roles: Array<{
    id?: string;
    role_name: RoleName;
    scope_unit_id: string | null;
  }>;
}

let usersCache: SeedUser[] = [];

export async function loadUsers(): Promise<SeedUser[]> {
  const users = await supabase.getUsers();
  const userRolesPromises = users.map(async user => {
    const roles = await supabase.getUserRoles(user.id);
    return {
      id: user.id,
      edipi: user.edipi,
      email: user.email,
      personnel_id: user.personnel_id,
      roles: roles.map(r => ({
        id: r.id,
        role_name: r.role.name,
        scope_unit_id: r.scope_unit_id,
      })),
    };
  });
  usersCache = await Promise.all(userRolesPromises);
  return usersCache;
}

export function getAllUsers(): SeedUser[] {
  return usersCache;
}

export function getSeedUserByEdipi(edipi: string): SeedUser | undefined {
  return usersCache.find(u => u.edipi === edipi);
}

export async function assignUserRole(
  userId: string,
  roleName: RoleName,
  scopeUnitId?: string | null
): Promise<boolean> {
  const role = await supabase.getRoleByName(roleName);
  if (!role) return false;
  const result = await supabase.addUserRole(userId, role.id, scopeUnitId || undefined);
  if (result) {
    // Update cache
    await loadUsers();
  }
  return !!result;
}

export async function removeUserRole(
  userIdOrRoleId: string,
  roleName?: RoleName,
  scopeUnitId?: string | null
): Promise<boolean> {
  // If only one argument, it's the userRoleId
  if (!roleName) {
    const success = await supabase.removeUserRole(userIdOrRoleId);
    if (success) {
      await loadUsers();
    }
    return success;
  }

  // Otherwise, find the user role by user ID, role name, and scope
  const user = usersCache.find(u => u.id === userIdOrRoleId);
  if (!user) return false;

  const role = user.roles.find(r =>
    r.role_name === roleName && r.scope_unit_id === scopeUnitId
  );

  if (!role?.id) return false;

  const success = await supabase.removeUserRole(role.id);
  if (success) {
    await loadUsers();
  }
  return success;
}

export async function deleteUser(userId: string): Promise<boolean> {
  const success = await supabase.deleteUser(userId);
  if (success) {
    usersCache = usersCache.filter(u => u.id !== userId);
  }
  return success;
}

// ============================================================================
// QUALIFICATIONS
// ============================================================================

let qualificationsCache: Qualification[] = [];

export async function loadQualifications(organizationId?: string): Promise<Qualification[]> {
  // Fetch from Supabase qualifications table
  const quals = await supabase.getQualifications(organizationId);
  // Convert to local type - these are qualification definitions, not personnel qualifications
  qualificationsCache = [];
  return qualificationsCache;
}

export function getAllQualifications(): Qualification[] {
  return qualificationsCache;
}

// ============================================================================
// DUTY VALUES
// ============================================================================

let dutyValuesCache: DutyValue[] = [];

export async function loadDutyValues(): Promise<DutyValue[]> {
  // Duty values are now stored per duty type in Supabase
  return dutyValuesCache;
}

export function getAllDutyValues(): DutyValue[] {
  return dutyValuesCache;
}

export function getDutyValueByTypeId(dutyTypeId: string): DutyValue | undefined {
  return dutyValuesCache.find(dv => dv.duty_type_id === dutyTypeId);
}

// ============================================================================
// BLOCKED DUTIES
// ============================================================================

let blockedDutiesCache: BlockedDuty[] = [];

export function getAllBlockedDuties(): BlockedDuty[] {
  return blockedDutiesCache;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export async function updateRucName(rucCode: string, name: string | null): Promise<boolean> {
  // Update in Supabase
  const result = await supabase.updateOrganization(rucCode, { name: name || undefined });
  if (!result) return false;

  // Update local cache
  const idx = rucEntriesCache.findIndex(r => r.ruc === rucCode);
  if (idx >= 0) {
    rucEntriesCache[idx].name = name;
  }
  return true;
}

export function invalidateCache(key?: string): void {
  if (!key) {
    // Invalidate all
    unitsCache = [];
    unitsByIdCache.clear();
    personnelCache = [];
    personnelByIdCache.clear();
    dutyTypesCache = [];
    dutyTypesByIdCache.clear();
    dutySlotsCache = [];
    nonAvailabilityCache = [];
    dutyChangeRequestsCache = [];
    usersCache = [];
    qualificationsCache = [];
    dutyValuesCache = [];
    blockedDutiesCache = [];
  }
}

export function invalidateAllCaches(): void {
  invalidateCache();
}

// ============================================================================
// DATA LOADING - Load all data for an organization
// ============================================================================

export async function loadAllData(rucCode?: string): Promise<void> {
  // Load organizations/RUCs first
  await loadRucs();

  let organizationId: string | undefined;
  if (rucCode) {
    const org = await getOrganizationByRuc(rucCode);
    organizationId = org?.id;
  }

  // Load all other data
  await Promise.all([
    loadUnits(organizationId),
    loadPersonnel(organizationId),
    loadDutyTypes(organizationId),
    loadDutySlots(organizationId),
    loadNonAvailability(organizationId),
    loadUsers(),
  ]);
}

"use client";

/**
 * Data Layer - Unified data access for DutySync
 *
 * This module provides async functions that fetch data from Supabase
 * and convert them to the local type format used by components.
 */

import * as supabase from "./supabase-data";
import type { DateString } from "@/types";
import {
  setDefaultOrganizationId,
  syncUnitsToLocalStorage,
  syncDutyTypesToLocalStorage,
  syncPersonnelToLocalStorage,
  syncDutySlotsToLocalStorage,
  clearDataIntegrityIssues,
  autoCompletePastDuties,
  getDutySlotRetentionCutoff,
} from "./client-stores";
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
  SessionUser,
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
// ORGANIZATION CONTEXT TRACKING
// ============================================================================

// Track the organization ID used for current data load
let currentOrganizationId: string | null = null;
let dataLoadTimestamp: Date | null = null;

// Get the current organization context
export function getCurrentOrganizationContext(): { organizationId: string | null; loadedAt: Date | null } {
  return {
    organizationId: currentOrganizationId,
    loadedAt: dataLoadTimestamp,
  };
}

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
    phone_number: p.phone_number,
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
    // Supernumerary fields from Supabase (with fallback defaults)
    requires_supernumerary: dt.requires_supernumerary ?? false,
    supernumerary_count: dt.supernumerary_count ?? 2,
    supernumerary_period_days: dt.supernumerary_period_days ?? 15,
    supernumerary_value: dt.supernumerary_value ?? 0.5,
    created_at: new Date(dt.created_at),
    updated_at: new Date(dt.updated_at),
  };
}

function convertDutySlot(slot: SupabaseDutySlot): DutySlot {
  // Validate status to ensure type safety even with unexpected database values
  const validStatuses: DutySlot['status'][] = ['scheduled', 'approved', 'completed', 'missed', 'swapped'];
  const status = validStatuses.includes(slot.status as DutySlot['status'])
    ? slot.status as DutySlot['status']
    : 'scheduled'; // Default to a safe value

  if (status !== slot.status) {
    console.warn(`Invalid status "${slot.status}" for duty slot ${slot.id}. Defaulting to "${status}".`);
  }

  // Handle optional swap fields that may come from Supabase
  const extendedSlot = slot as typeof slot & {
    swapped_at?: string | null;
    swapped_from_personnel_id?: string | null;
    swap_pair_id?: string | null;
  };

  // Keep date_assigned as a string (DateString format: YYYY-MM-DD)
  // This avoids timezone issues where dates shift when parsed as UTC
  const dateAssigned: DateString = typeof slot.date_assigned === 'string'
    ? slot.date_assigned.split('T')[0] // Handle ISO timestamp format from DB
    : slot.date_assigned;

  return {
    id: slot.id,
    duty_type_id: slot.duty_type_id,
    personnel_id: slot.personnel_id,
    date_assigned: dateAssigned,
    assigned_by: slot.assigned_by || "",
    points: slot.points ?? 0,
    status,
    swapped_at: extendedSlot.swapped_at ? new Date(extendedSlot.swapped_at) : null,
    swapped_from_personnel_id: extendedSlot.swapped_from_personnel_id || null,
    swap_pair_id: extendedSlot.swap_pair_id || null,
    created_at: new Date(slot.created_at),
    updated_at: new Date(slot.updated_at),
  };
}

function convertNonAvailability(na: SupabaseNonAvailability): NonAvailability {
  // Keep start_date and end_date as strings (DateString format: YYYY-MM-DD)
  // This avoids timezone issues where dates shift when parsed as UTC
  const startDate: DateString = typeof na.start_date === 'string'
    ? na.start_date.split('T')[0]
    : na.start_date;
  const endDate: DateString = typeof na.end_date === 'string'
    ? na.end_date.split('T')[0]
    : na.end_date;

  return {
    id: na.id,
    personnel_id: na.personnel_id,
    start_date: startDate,
    end_date: endDate,
    reason: na.reason || "",
    status: na.status,
    submitted_by: na.submitted_by,
    recommended_by: na.recommended_by,
    recommended_at: na.recommended_at ? new Date(na.recommended_at) : null,
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

export async function getOrganizationById(id: string): Promise<Organization | null> {
  return supabase.getOrganizationById(id);
}

// Helper to get organization by ID (UUID), unit ID, or RUC code
// The scope_unit_id can be stored as:
// 1. An organization UUID
// 2. A unit_sections UUID (need to look up the unit's organization)
// 3. A RUC code string
export async function getOrganizationByIdOrRuc(idOrRuc: string): Promise<Organization | null> {
  // Check if it looks like a UUID (contains hyphens in UUID format)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrRuc);

  if (isUuid) {
    // First try as organization ID
    const org = await supabase.getOrganizationById(idOrRuc);
    if (org) return org;

    // If not found, try to find a unit with this ID and get its organization
    const unit = await supabase.getUnitById(idOrRuc);
    if (unit && unit.organization_id) {
      return supabase.getOrganizationById(unit.organization_id);
    }

    return null;
  } else {
    return supabase.getOrganizationByRuc(idOrRuc);
  }
}

// Helper to resolve the scope unit for a Unit Admin
// Returns { organization, scopeUnit } where scopeUnit is the TOP-LEVEL unit for the organization
// Unit Admin should see the entire organization, regardless of which unit their role is scoped to
// The scope_unit_id is used to identify which organization the admin belongs to
export async function resolveUnitAdminScope(scopeId: string): Promise<{
  organization: Organization | null;
  scopeUnit: UnitSection | null;
  rucDisplay: string;
}> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scopeId);

  if (isUuid) {
    // First check if it's a unit ID
    const unit = await supabase.getUnitById(scopeId);
    if (unit && unit.organization_id) {
      // Found a unit - get its organization and the TOP-LEVEL unit for that org
      const org = await supabase.getOrganizationById(unit.organization_id);
      if (org) {
        const topUnit = await supabase.getTopLevelUnitForOrganization(org.id);
        const rucDisplay = org.name ? `${org.ruc_code} - ${org.name}` : org.ruc_code;
        return {
          organization: org,
          scopeUnit: topUnit ? convertUnit(topUnit, org.ruc_code) : null,
          rucDisplay,
        };
      }
    }

    // Try as organization ID
    const org = await supabase.getOrganizationById(scopeId);
    if (org) {
      const topUnit = await supabase.getTopLevelUnitForOrganization(org.id);
      const rucDisplay = org.name ? `${org.ruc_code} - ${org.name}` : org.ruc_code;
      return {
        organization: org,
        scopeUnit: topUnit ? convertUnit(topUnit, org.ruc_code) : null,
        rucDisplay,
      };
    }

    return { organization: null, scopeUnit: null, rucDisplay: "N/A" };
  } else {
    // Try as RUC code
    const org = await supabase.getOrganizationByRuc(scopeId);
    if (org) {
      const topUnit = await supabase.getTopLevelUnitForOrganization(org.id);
      const rucDisplay = org.name ? `${org.ruc_code} - ${org.name}` : org.ruc_code;
      return {
        organization: org,
        scopeUnit: topUnit ? convertUnit(topUnit, org.ruc_code) : null,
        rucDisplay,
      };
    }

    return { organization: null, scopeUnit: null, rucDisplay: getRucDisplayName(scopeId) };
  }
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

  // Sync to localStorage so client-stores uses valid Supabase IDs
  syncUnitsToLocalStorage(unitsCache);

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

  // Sync to localStorage so client-stores uses valid Supabase IDs
  syncPersonnelToLocalStorage(personnelCache);

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

  // Sync to localStorage so client-stores uses valid Supabase IDs
  syncDutyTypesToLocalStorage(dutyTypesCache);

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
  // Apply 12-month retention policy by default if no startDate specified
  const effectiveStartDate = startDate ?? getDutySlotRetentionCutoff();

  const slots = await supabase.getDutySlots(organizationId, effectiveStartDate, endDate);
  dutySlotsCache = slots.map(convertDutySlot);

  // Sync to localStorage so client-stores uses valid Supabase data
  // (syncDutySlotsToLocalStorage also applies retention policy)
  syncDutySlotsToLocalStorage(dutySlotsCache);

  // Auto-complete any past duties that are still scheduled/approved
  const completedCount = autoCompletePastDuties();
  if (completedCount > 0) {
    // Refresh cache from localStorage to include the completed status
    dutySlotsCache = dutySlotsCache.map(slot => {
      const today = new Date().toISOString().split('T')[0];
      if (
        slot.date_assigned < today &&
        (slot.status === 'scheduled' || slot.status === 'approved') &&
        slot.personnel_id
      ) {
        return { ...slot, status: 'completed' };
      }
      return slot;
    });
  }

  return dutySlotsCache;
}

export function getAllDutySlots(): DutySlot[] {
  return dutySlotsCache;
}

export function getDutySlotsByDateRange(startDate: DateString, endDate: DateString): DutySlot[] {
  // Since date_assigned is now a DateString, we can use simple string comparison
  // This is timezone-safe because YYYY-MM-DD format sorts correctly
  return dutySlotsCache.filter(slot => {
    return slot.date_assigned >= startDate && slot.date_assigned <= endDate;
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
    dcr => dcr.personnel_id === personnelId || dcr.swap_partner_id === personnelId
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

// ============================================================================
// USER AUTHORIZATION HELPERS
// ============================================================================

/**
 * Get the organization ID for a user based on their scoped role.
 * Returns null if user has no scoped role (e.g., App Admin or Standard User).
 */
export async function getUserOrganizationId(user: SessionUser | null): Promise<string | null> {
  if (!user?.roles) return null;

  // Find the user's scoped role (Unit Admin or Manager roles)
  const scopedRole = user.roles.find(r =>
    r.scope_unit_id && (
      r.role_name === "Unit Admin" ||
      r.role_name === "Unit Manager" ||
      r.role_name === "Company Manager" ||
      r.role_name === "Section Manager" ||
      r.role_name === "Work Section Manager"
    )
  );

  if (!scopedRole?.scope_unit_id) return null;

  // Get the unit to find its organization
  const unit = await supabase.getUnitById(scopedRole.scope_unit_id);
  return unit?.organization_id || null;
}

/**
 * Get the organization ID for a target user based on their personnel record.
 */
export async function getTargetUserOrganizationId(targetUserId: string): Promise<string | null> {
  // Find the target user in cache
  const targetUser = usersCache.find(u => u.id === targetUserId);
  if (!targetUser) return null;

  // Get the target user's personnel record by EDIPI
  const personnel = await supabase.getPersonnelByServiceId(targetUser.edipi);
  if (!personnel) return null;

  // Get the unit to find organization
  const unit = await supabase.getUnitById(personnel.unit_id);
  return unit?.organization_id || null;
}

/**
 * Check if the current user is an App Admin.
 */
export function isAppAdmin(user: SessionUser | null): boolean {
  if (!user?.roles) return false;
  return user.roles.some(r => r.role_name === "App Admin");
}

/**
 * Check if the current user is a Unit Admin.
 */
export function isUnitAdmin(user: SessionUser | null): boolean {
  if (!user?.roles) return false;
  return user.roles.some(r => r.role_name === "Unit Admin");
}

/**
 * Check if the current user can manage another user's roles.
 *
 * Rules:
 * - App Admin can manage any user
 * - Unit Admin can only manage users in their organization
 * - Other users cannot manage roles
 */
export async function canManageUser(
  currentUser: SessionUser | null,
  targetUserId: string
): Promise<{ allowed: boolean; reason?: string }> {
  if (!currentUser) {
    return { allowed: false, reason: "No current user session" };
  }

  // App Admin can manage anyone
  if (isAppAdmin(currentUser)) {
    return { allowed: true };
  }

  // Must be a Unit Admin to manage users
  if (!isUnitAdmin(currentUser)) {
    return { allowed: false, reason: "Only App Admins and Unit Admins can manage user roles" };
  }

  // Get the current user's organization
  const currentUserOrgId = await getUserOrganizationId(currentUser);
  if (!currentUserOrgId) {
    return { allowed: false, reason: "Could not determine your organization scope" };
  }

  // Get the target user's organization
  const targetUserOrgId = await getTargetUserOrganizationId(targetUserId);
  if (!targetUserOrgId) {
    // Target user has no personnel record - allow if they're being assigned to current user's org
    return { allowed: true };
  }

  // Check if organizations match
  if (currentUserOrgId !== targetUserOrgId) {
    return {
      allowed: false,
      reason: "You can only manage users in your organization"
    };
  }

  return { allowed: true };
}

/**
 * Validate that a scope unit belongs to the current user's organization.
 * Used when assigning roles with a scope.
 */
export async function validateScopeUnit(
  currentUser: SessionUser | null,
  scopeUnitId: string
): Promise<{ valid: boolean; reason?: string }> {
  if (!currentUser) {
    return { valid: false, reason: "No current user session" };
  }

  // App Admin can assign any scope
  if (isAppAdmin(currentUser)) {
    return { valid: true };
  }

  // Get current user's organization
  const currentUserOrgId = await getUserOrganizationId(currentUser);
  if (!currentUserOrgId) {
    return { valid: false, reason: "Could not determine your organization scope" };
  }

  // Get the scope unit's organization
  const scopeUnit = await supabase.getUnitById(scopeUnitId);
  if (!scopeUnit) {
    return { valid: false, reason: "Invalid scope unit" };
  }

  // Check if scope unit belongs to current user's organization
  if (scopeUnit.organization_id !== currentUserOrgId) {
    return {
      valid: false,
      reason: "You can only assign roles scoped to units in your organization"
    };
  }

  return { valid: true };
}

// ============================================================================
// USER ROLE MANAGEMENT (with authorization)
// ============================================================================

export async function assignUserRole(
  currentUser: SessionUser | null,
  userId: string,
  roleName: RoleName,
  scopeUnitId?: string | null
): Promise<{ success: boolean; error?: string }> {
  // Authorization check
  const authCheck = await canManageUser(currentUser, userId);
  if (!authCheck.allowed) {
    console.error("[Data Layer] assignUserRole unauthorized:", authCheck.reason);
    return { success: false, error: authCheck.reason };
  }

  // If assigning a scoped role, validate the scope unit
  if (scopeUnitId) {
    const scopeCheck = await validateScopeUnit(currentUser, scopeUnitId);
    if (!scopeCheck.valid) {
      console.error("[Data Layer] assignUserRole invalid scope:", scopeCheck.reason);
      return { success: false, error: scopeCheck.reason };
    }
  }

  // Prevent non-App Admins from assigning App Admin role
  if (roleName === "App Admin" && !isAppAdmin(currentUser)) {
    return { success: false, error: "Only App Admins can assign the App Admin role" };
  }

  const role = await supabase.getRoleByName(roleName);
  if (!role) {
    return { success: false, error: "Role not found" };
  }

  const result = await supabase.addUserRole(userId, role.id, scopeUnitId || undefined);
  if (result) {
    // Update cache
    await loadUsers();
    return { success: true };
  }

  return { success: false, error: "Failed to assign role" };
}

export async function removeUserRole(
  currentUser: SessionUser | null,
  userIdOrRoleId: string,
  roleName?: RoleName,
  scopeUnitId?: string | null
): Promise<{ success: boolean; error?: string }> {
  // Determine the target user ID
  let targetUserId: string;
  let userRoleId: string;

  if (!roleName) {
    // userIdOrRoleId is the userRoleId - need to find the user
    // Look through cache to find which user has this role ID
    const userWithRole = usersCache.find(u =>
      u.roles.some(r => r.id === userIdOrRoleId)
    );
    if (!userWithRole) {
      return { success: false, error: "Role not found" };
    }
    targetUserId = userWithRole.id;
    userRoleId = userIdOrRoleId;
  } else {
    targetUserId = userIdOrRoleId;
    // Find the user role by user ID, role name, and scope
    const user = usersCache.find(u => u.id === userIdOrRoleId);
    if (!user) {
      return { success: false, error: "User not found" };
    }
    const role = user.roles.find(r =>
      r.role_name === roleName && r.scope_unit_id === scopeUnitId
    );
    if (!role?.id) {
      return { success: false, error: "Role not found for user" };
    }
    userRoleId = role.id;
  }

  // Authorization check
  const authCheck = await canManageUser(currentUser, targetUserId);
  if (!authCheck.allowed) {
    console.error("[Data Layer] removeUserRole unauthorized:", authCheck.reason);
    return { success: false, error: authCheck.reason };
  }

  const success = await supabase.removeUserRole(userRoleId);
  if (success) {
    await loadUsers();
    return { success: true };
  }

  return { success: false, error: "Failed to remove role" };
}

export async function deleteUser(
  currentUser: SessionUser | null,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  // Authorization check
  const authCheck = await canManageUser(currentUser, userId);
  if (!authCheck.allowed) {
    console.error("[Data Layer] deleteUser unauthorized:", authCheck.reason);
    return { success: false, error: authCheck.reason };
  }

  // Prevent deleting yourself
  if (currentUser?.id === userId) {
    return { success: false, error: "You cannot delete your own account" };
  }

  // Prevent non-App Admins from deleting App Admins
  const targetUser = usersCache.find(u => u.id === userId);
  if (targetUser?.roles.some(r => r.role_name === "App Admin") && !isAppAdmin(currentUser)) {
    return { success: false, error: "Only App Admins can delete App Admin accounts" };
  }

  const success = await supabase.deleteUser(userId);
  if (success) {
    usersCache = usersCache.filter(u => u.id !== userId);
    return { success: true };
  }

  return { success: false, error: "Failed to delete user" };
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

// Validate that the organization context is consistent
export function validateOrganizationContext(expectedOrgId: string): boolean {
  if (!currentOrganizationId) {
    console.warn("[Data Layer] No organization context set. Data may not be loaded.");
    return false;
  }
  if (currentOrganizationId !== expectedOrgId) {
    console.warn(
      `[Data Layer] Organization mismatch: expected ${expectedOrgId}, but current context is ${currentOrganizationId}. ` +
      `Data may be inconsistent. Consider reloading data.`
    );
    return false;
  }
  return true;
}

// Clear all cached data (call when organization changes or user logs out)
export function clearAllDataCaches(): void {
  console.log("[Data Layer] Clearing all data caches due to context change");
  currentOrganizationId = null;
  dataLoadTimestamp = null;

  // Clear all caches
  organizationsCache = [];
  unitsCache = [];
  unitsByIdCache.clear();
  personnelCache = [];
  personnelByIdCache.clear();
  dutyTypesCache = [];
  dutyTypesByIdCache.clear();
  dutyValuesCache = [];
  dutySlotsCache = [];
  nonAvailabilityCache = [];
  dutyChangeRequestsCache = [];
  usersCache = [];
  qualificationsCache = [];
  blockedDutiesCache = [];
  rucEntriesCache = [];

  // Clear integrity issues from client-stores
  clearDataIntegrityIssues();
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
  } else if (organizationsCache.length > 0) {
    // If no RUC specified, use the first organization as default
    organizationId = organizationsCache[0].id;
  }

  // Check if organization context is changing (including change to no org)
  if (currentOrganizationId && currentOrganizationId !== organizationId) {
    console.log(`[Data Layer] Organization context changing from ${currentOrganizationId} to ${organizationId || 'none'}. Clearing old data.`);
    clearAllDataCaches();
    // Reload orgs since we just cleared
    await loadRucs();
  }

  // Set the organization context
  if (organizationId) {
    currentOrganizationId = organizationId;
    dataLoadTimestamp = new Date();
    setDefaultOrganizationId(organizationId);
    console.log(`[Data Layer] Loading data for organization: ${organizationId}${rucCode ? ` (RUC: ${rucCode})` : ''}`);
  } else {
    console.warn("[Data Layer] No organization ID found. Data loading may be incomplete.");
  }

  // Clear data integrity issues before fresh load
  clearDataIntegrityIssues();

  // Load all other data with the same organization context
  await Promise.all([
    loadUnits(organizationId),
    loadPersonnel(organizationId),
    loadDutyTypes(organizationId),
    loadDutySlots(organizationId),
    loadNonAvailability(organizationId),
    loadUsers(),
  ]);

  // Log summary after loading
  console.log(
    `[Data Layer] Data loaded successfully: ` +
    `${personnelCache.length} personnel, ` +
    `${dutySlotsCache.length} duty slots, ` +
    `${dutyTypesCache.length} duty types`
  );
}

// ============================================================================
// IMPORT FUNCTIONS - Import data from CSV/TSV files
// ============================================================================

export interface ManpowerRecord {
  edipi: string;
  name: string;
  rank: string;
  unit: string;
  category?: string;
  dutyStatus?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
}

interface ParsedUnitCode {
  base: string | null;
  company: string | null;
  section: string | null;
  workSection: string | null;
}

function parseUnitCode(unitCode: string): ParsedUnitCode {
  const result: ParsedUnitCode = {
    base: null,
    company: null,
    section: null,
    workSection: null,
  };

  if (!unitCode) return result;

  // Split by common delimiters
  const parts = unitCode.split(/[\/\-\s]+/).filter(Boolean);
  if (parts.length === 0) return result;

  // First part is typically the RUC/base unit code (e.g., "02301")
  result.base = parts[0];

  // Look for company letter (single letter like A, B, C, HQ, etc.)
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].toUpperCase();
    if (/^[A-Z]$/.test(part) || part === "HQ" || part === "H&S") {
      result.company = part;
    } else if (part.length <= 4 && /^[A-Z0-9]+$/.test(part)) {
      // Short alphanumeric codes are likely sections or work sections
      if (!result.section) {
        result.section = part;
      } else if (!result.workSection) {
        result.workSection = part;
      }
    }
  }

  return result;
}

function parseName(name: string): { first_name: string; last_name: string } {
  if (!name) return { first_name: "", last_name: "" };

  // Handle "LAST, FIRST MI" format
  if (name.includes(",")) {
    const [last, rest] = name.split(",").map(s => s.trim());
    const first = rest?.split(" ")[0] || "";
    return { first_name: first, last_name: last };
  }

  // Handle "FIRST LAST" format
  const parts = name.split(" ").filter(Boolean);
  if (parts.length >= 2) {
    return { first_name: parts[0], last_name: parts[parts.length - 1] };
  }

  return { first_name: "", last_name: name };
}

export async function importManpowerToSupabase(
  organizationId: string,
  records: ManpowerRecord[]
): Promise<{
  units: { created: number; updated: number; errors: string[] };
  personnel: { created: number; updated: number; errors: string[] };
}> {
  const result = {
    units: { created: 0, updated: 0, errors: [] as string[] },
    personnel: { created: 0, updated: 0, errors: [] as string[] },
  };

  if (records.length === 0) {
    result.units.errors.push("No records to import");
    return result;
  }

  // Extract unique units from records
  const unitsToCreate: Array<{
    unit_name: string;
    hierarchy_level: "unit" | "company" | "section" | "work_section";
    parent_name?: string;
  }> = [];

  const seenUnits = new Set<string>();

  // First pass: collect all units from records
  for (const record of records) {
    if (!record.unit) continue;

    const parsed = parseUnitCode(record.unit);

    // Add base unit (top-level)
    if (parsed.base && !seenUnits.has(parsed.base)) {
      unitsToCreate.push({
        unit_name: parsed.base,
        hierarchy_level: "unit",
      });
      seenUnits.add(parsed.base);
    }

    // Add company under base
    if (parsed.base && parsed.company) {
      const companyName = `${parsed.company} Company`;
      if (!seenUnits.has(companyName)) {
        unitsToCreate.push({
          unit_name: companyName,
          hierarchy_level: "company",
          parent_name: parsed.base,
        });
        seenUnits.add(companyName);
      }

      // Add section under company
      if (parsed.section) {
        if (!seenUnits.has(parsed.section)) {
          unitsToCreate.push({
            unit_name: parsed.section,
            hierarchy_level: "section",
            parent_name: companyName,
          });
          seenUnits.add(parsed.section);
        }

        // Add work section under section
        if (parsed.workSection && !seenUnits.has(parsed.workSection)) {
          unitsToCreate.push({
            unit_name: parsed.workSection,
            hierarchy_level: "work_section",
            parent_name: parsed.section,
          });
          seenUnits.add(parsed.workSection);
        }
      }
    }
  }

  // Import units first
  const unitsResult = await supabase.importUnits(organizationId, unitsToCreate);
  result.units = {
    created: unitsResult.created,
    updated: unitsResult.updated,
    errors: unitsResult.errors,
  };

  // Convert records to personnel import format
  const personnelToImport = records.map(record => {
    const { first_name, last_name } = parseName(record.name);
    const parsed = parseUnitCode(record.unit);

    // Determine which unit to assign to (lowest level available)
    let unitName = parsed.base || "";
    if (parsed.workSection) {
      unitName = parsed.workSection;
    } else if (parsed.section) {
      unitName = parsed.section;
    } else if (parsed.company) {
      unitName = `${parsed.company} Company`;
    }

    return {
      service_id: record.edipi,
      first_name,
      last_name,
      rank: record.rank,
      unit_name: unitName,
    };
  }).filter(p => p.service_id && p.unit_name);

  // Import personnel
  const personnelResult = await supabase.importPersonnel(
    organizationId,
    personnelToImport,
    unitsResult.unitMap
  );
  result.personnel = personnelResult;

  // Refresh caches
  await loadUnits(organizationId);
  await loadPersonnel(organizationId);

  return result;
}

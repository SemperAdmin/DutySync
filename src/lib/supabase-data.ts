"use client";

import { getSupabase, isSupabaseConfigured } from "./supabase";
import type {
  Organization,
  Unit,
  Personnel,
  User,
  Role,
  UserRole,
  Qualification,
  PersonnelQualification,
  DutyType,
  DutyValue,
  DutyRequirement,
  DutySlot,
  NonAvailability,
  HierarchyLevel,
  RoleName,
  DutyScoreEvent,
  DutyScoreEventInsert,
  DutyChangeRequest,
} from "@/types/supabase";

// Type assertion helper for Supabase operations
// This is needed due to complex Supabase generic type inference
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asInsert = <T>(data: T): any => data;

// ============================================================================
// ORGANIZATIONS
// ============================================================================

export async function getOrganizations(): Promise<Organization[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .order("name");

  if (error) {
    console.error("Error fetching organizations:", error);
    return [];
  }
  return data || [];
}

export async function getOrganizationByRuc(rucCode: string): Promise<Organization | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("ruc_code", rucCode)
    .single();

  if (error) {
    console.error("Error fetching organization:", error);
    return null;
  }
  return data;
}

export async function createOrganization(rucCode: string, name: string, description?: string): Promise<Organization | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("organizations")
    .insert({ ruc_code: rucCode, name, description } as never)
    .select()
    .single();

  if (error) {
    console.error("Error creating organization:", error);
    return null;
  }
  return data as Organization;
}

export async function updateOrganization(rucCode: string, updates: { name?: string; description?: string }): Promise<Organization | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("organizations")
    .update(updates as never)
    .eq("ruc_code", rucCode)
    .select()
    .single();

  if (error) {
    console.error("Error updating organization:", error);
    return null;
  }
  return data as Organization;
}

// ============================================================================
// UNITS
// ============================================================================

export async function getUnits(organizationId?: string): Promise<Unit[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabase();

  let query = supabase.from("units").select("*").order("unit_name");

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching units:", error);
    return [];
  }
  return data || [];
}

export async function getUnitsByRuc(rucCode: string): Promise<Unit[]> {
  if (!isSupabaseConfigured()) return [];

  const org = await getOrganizationByRuc(rucCode);
  if (!org) return [];

  return getUnits(org.id);
}

export async function getUnitById(id: string): Promise<Unit | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("units")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error("Error fetching unit:", error);
    return null;
  }
  return data;
}

export async function getChildUnits(parentId: string): Promise<Unit[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("units")
    .select("*")
    .eq("parent_id", parentId)
    .order("unit_name");

  if (error) {
    console.error("Error fetching child units:", error);
    return [];
  }
  return data || [];
}

export async function getTopLevelUnitForOrganization(organizationId: string): Promise<Unit | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  // First try to find a unit with no parent (true top-level)
  const { data: topLevel, error: topError } = await supabase
    .from("units")
    .select("*")
    .eq("organization_id", organizationId)
    .is("parent_id", null)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (topError) {
    console.error("Error fetching top-level unit:", topError);
    return null;
  }

  if (topLevel) {
    return topLevel;
  }

  // If no unit with null parent, find any unit for this org (fallback)
  const { data: anyUnit, error: anyError } = await supabase
    .from("units")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (anyError) {
    console.error("Error fetching any unit for org:", anyError);
    return null;
  }

  if (anyUnit) {
    return anyUnit;
  }

  // No units exist for this organization - auto-create a top-level unit
  // First get the organization to use its name
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("name, ruc_code")
    .eq("id", organizationId)
    .maybeSingle();

  if (orgError) {
    console.error("Error fetching organization for unit creation:", orgError);
    return null;
  }

  if (!org) {
    console.error(`Organization with id ${organizationId} not found. Cannot create unit.`);
    return null;
  }

  const orgData = org as { name: string | null; ruc_code: string | null };
  const unitName = orgData.name || orgData.ruc_code || "Organization Unit";

  const { data: newUnit, error: createError } = await supabase
    .from("units")
    .insert({
      organization_id: organizationId,
      unit_name: unitName,
      hierarchy_level: "unit",
      parent_id: null,
    } as never)
    .select()
    .single();

  if (createError) {
    console.error("Error creating top-level unit:", createError);
    return null;
  }

  return newUnit as Unit;
}

export async function getDescendantUnitIds(parentId: string): Promise<string[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabase();

  // Use the database function if available, otherwise do recursive fetch
  const { data, error } = await supabase.rpc("get_descendant_unit_ids", {
    parent_unit_id: parentId,
  } as never);

  if (error) {
    console.error("Error fetching descendant units:", error);
    // Fallback to recursive fetch
    return getDescendantUnitIdsRecursive(parentId);
  }

  return data || [];
}

async function getDescendantUnitIdsRecursive(parentId: string): Promise<string[]> {
  const children = await getChildUnits(parentId);
  const ids: string[] = [parentId];

  for (const child of children) {
    const childDescendants = await getDescendantUnitIdsRecursive(child.id);
    ids.push(...childDescendants);
  }

  return ids;
}

export async function createUnit(
  organizationId: string,
  unitName: string,
  hierarchyLevel: HierarchyLevel,
  parentId?: string,
  unitCode?: string,
  description?: string
): Promise<Unit | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("units")
    .insert({
      organization_id: organizationId,
      unit_name: unitName,
      hierarchy_level: hierarchyLevel,
      parent_id: parentId || null,
      unit_code: unitCode || null,
      description: description || null,
    } as never)
    .select()
    .single();

  if (error) {
    console.error("Error creating unit:", error);
    return null;
  }
  return data as Unit;
}

export async function updateUnit(id: string, updates: Partial<Unit>): Promise<Unit | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("units")
    .update(updates as never)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating unit:", error);
    return null;
  }
  return data as Unit;
}

export async function deleteUnit(id: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const supabase = getSupabase();

  const { error } = await supabase
    .from("units")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error deleting unit:", error);
    return false;
  }
  return true;
}

// ============================================================================
// PERSONNEL
// ============================================================================

export async function getPersonnel(organizationId?: string): Promise<Personnel[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabase();

  let query = supabase.from("personnel").select("*").order("last_name");

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching personnel:", error);
    return [];
  }
  return data || [];
}

export async function getPersonnelByUnit(unitId: string): Promise<Personnel[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("personnel")
    .select("*")
    .eq("unit_id", unitId)
    .order("last_name");

  if (error) {
    console.error("Error fetching personnel by unit:", error);
    return [];
  }
  return data || [];
}

export async function getPersonnelByUnits(unitIds: string[]): Promise<Personnel[]> {
  if (!isSupabaseConfigured() || unitIds.length === 0) return [];
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("personnel")
    .select("*")
    .in("unit_id", unitIds)
    .order("last_name");

  if (error) {
    console.error("Error fetching personnel by units:", error);
    return [];
  }
  return data || [];
}

export async function getPersonnelById(id: string): Promise<Personnel | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("personnel")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error("Error fetching personnel:", error);
    return null;
  }
  return data;
}

export async function getPersonnelByServiceId(serviceId: string): Promise<Personnel | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("personnel")
    .select("*")
    .eq("service_id", serviceId)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error("Error fetching personnel by service ID:", error);
  }
  return data || null;
}

export async function createPersonnel(
  organizationId: string,
  unitId: string,
  serviceId: string,
  firstName: string,
  lastName: string,
  rank: string
): Promise<Personnel | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("personnel")
    .insert({
      organization_id: organizationId,
      unit_id: unitId,
      service_id: serviceId,
      first_name: firstName,
      last_name: lastName,
      rank,
      current_duty_score: 0,
    } as never)
    .select()
    .single();

  if (error) {
    console.error("Error creating personnel:", error);
    return null;
  }
  return data as Personnel;
}

export async function updatePersonnel(id: string, updates: Partial<Personnel>): Promise<Personnel | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("personnel")
    .update(updates as never)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating personnel:", error);
    return null;
  }
  return data as Personnel;
}

export async function deletePersonnel(id: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const supabase = getSupabase();

  const { error } = await supabase
    .from("personnel")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error deleting personnel:", error);
    return false;
  }
  return true;
}

// ============================================================================
// BATCH IMPORT FUNCTIONS
// ============================================================================

export interface ImportUnit {
  unit_name: string;
  hierarchy_level: HierarchyLevel;
  parent_name?: string;
  unit_code?: string;
  description?: string;
}

export interface ImportPersonnel {
  service_id: string;
  first_name: string;
  last_name: string;
  rank: string;
  unit_name: string; // Will be looked up to get unit_id
}

export interface ImportResult {
  units: { created: number; updated: number; errors: string[] };
  personnel: { created: number; updated: number; errors: string[] };
}

/**
 * Import units to Supabase - creates or updates based on unit_name
 */
export async function importUnits(
  organizationId: string,
  units: ImportUnit[]
): Promise<{ created: number; updated: number; errors: string[]; unitMap: Map<string, string> }> {
  if (!isSupabaseConfigured()) {
    return { created: 0, updated: 0, errors: ["Supabase not configured"], unitMap: new Map() };
  }
  const supabase = getSupabase();

  const result = { created: 0, updated: 0, errors: [] as string[], unitMap: new Map<string, string>() };

  // Get existing units for this organization
  const { data: existingUnits } = await supabase
    .from("units")
    .select("*")
    .eq("organization_id", organizationId);

  const existingByName = new Map<string, Unit>();
  const unitsList = (existingUnits || []) as Unit[];
  unitsList.forEach(u => existingByName.set(u.unit_name, u));

  // Process units in order: top-level first, then children
  // Sort by hierarchy level to ensure parents are created first
  const levelOrder: Record<string, number> = { unit: 0, company: 1, section: 2, work_section: 3 };
  const sortedUnits = [...units].sort((a, b) =>
    (levelOrder[a.hierarchy_level] || 0) - (levelOrder[b.hierarchy_level] || 0)
  );

  for (const unit of sortedUnits) {
    try {
      const existing = existingByName.get(unit.unit_name);

      // Get parent ID if parent_name is specified
      let parentId: string | null = null;
      if (unit.parent_name) {
        const parentUnit = existingByName.get(unit.parent_name) ||
          (await getUnitByName(organizationId, unit.parent_name));
        if (parentUnit) {
          parentId = parentUnit.id;
        }
      }

      if (existing) {
        // Update existing unit
        const { error } = await supabase
          .from("units")
          .update({
            hierarchy_level: unit.hierarchy_level,
            parent_id: parentId,
            unit_code: unit.unit_code || existing.unit_code,
            description: unit.description || existing.description,
          } as never)
          .eq("id", existing.id);

        if (error) {
          result.errors.push(`Failed to update unit ${unit.unit_name}: ${error.message}`);
        } else {
          result.updated++;
          result.unitMap.set(unit.unit_name, existing.id);
          existingByName.set(unit.unit_name, { ...existing, parent_id: parentId });
        }
      } else {
        // Create new unit
        const { data: newUnit, error } = await supabase
          .from("units")
          .insert({
            organization_id: organizationId,
            unit_name: unit.unit_name,
            hierarchy_level: unit.hierarchy_level,
            parent_id: parentId,
            unit_code: unit.unit_code || unit.unit_name,
            description: unit.description,
          } as never)
          .select()
          .single();

        if (error) {
          result.errors.push(`Failed to create unit ${unit.unit_name}: ${error.message}`);
        } else if (newUnit) {
          const createdUnit = newUnit as Unit;
          result.created++;
          result.unitMap.set(unit.unit_name, createdUnit.id);
          existingByName.set(unit.unit_name, createdUnit);
        }
      }
    } catch (err) {
      result.errors.push(`Error processing unit ${unit.unit_name}: ${err}`);
    }
  }

  return result;
}

/**
 * Get unit by name within an organization
 */
async function getUnitByName(organizationId: string, unitName: string): Promise<Unit | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data } = await supabase
    .from("units")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("unit_name", unitName)
    .maybeSingle();

  return data as Unit | null;
}

/**
 * Import personnel to Supabase - uses upsert based on (organization_id, service_id)
 */
export async function importPersonnel(
  organizationId: string,
  personnel: ImportPersonnel[],
  unitMap: Map<string, string>
): Promise<{ created: number; updated: number; errors: string[] }> {
  if (!isSupabaseConfigured()) {
    return { created: 0, updated: 0, errors: ["Supabase not configured"] };
  }
  const supabase = getSupabase();

  const result = { created: 0, updated: 0, errors: [] as string[] };

  // Get all existing personnel for this organization to determine create vs update
  const { data: existingPersonnel } = await supabase
    .from("personnel")
    .select("*")
    .eq("organization_id", organizationId);

  const existingByServiceId = new Map<string, Personnel>();
  const personnelList = (existingPersonnel || []) as Personnel[];
  personnelList.forEach(p => existingByServiceId.set(p.service_id, p));

  for (const person of personnel) {
    try {
      // Look up unit ID from unit name
      let unitId = unitMap.get(person.unit_name);

      // If not in map, try to find it in the database
      if (!unitId) {
        const unit = await getUnitByName(organizationId, person.unit_name);
        if (unit) {
          unitId = unit.id;
        }
      }

      if (!unitId) {
        result.errors.push(`No unit found for ${person.service_id}: ${person.unit_name}`);
        continue;
      }

      const existing = existingByServiceId.get(person.service_id);

      if (existing) {
        // Update existing personnel
        const { error } = await supabase
          .from("personnel")
          .update({
            unit_id: unitId,
            first_name: person.first_name,
            last_name: person.last_name,
            rank: person.rank,
          } as never)
          .eq("id", existing.id);

        if (error) {
          result.errors.push(`Failed to update ${person.service_id}: ${error.message}`);
        } else {
          result.updated++;
        }
      } else {
        // Create new personnel
        const { error } = await supabase
          .from("personnel")
          .insert({
            organization_id: organizationId,
            unit_id: unitId,
            service_id: person.service_id,
            first_name: person.first_name,
            last_name: person.last_name,
            rank: person.rank,
            current_duty_score: 0,
          } as never);

        if (error) {
          result.errors.push(`Failed to create ${person.service_id}: ${error.message}`);
        } else {
          result.created++;
        }
      }
    } catch (err) {
      result.errors.push(`Error processing ${person.service_id}: ${err}`);
    }
  }

  return result;
}

export async function getUserByEdipi(edipi: string): Promise<User | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("edipi", edipi)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error("Error fetching user by EDIPI:", error);
  }
  return data || null;
}

export async function getUserById(id: string): Promise<User | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error("Error fetching user:", error);
    return null;
  }
  return data;
}

export async function getUsers(): Promise<User[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .order("email");

  if (error) {
    console.error("Error fetching users:", error);
    return [];
  }
  return data || [];
}

export async function authenticateUser(edipi: string, password: string): Promise<User | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  // Get user by EDIPI
  const { data: user, error } = await supabase
    .from("users")
    .select("*")
    .eq("edipi", edipi)
    .single();

  if (error || !user) {
    return null;
  }

  // Check password (base64 encoded for now - should use bcrypt in production)
  const passwordHash = btoa(password);
  const typedUser = user as User;
  if (typedUser.password_hash !== passwordHash) {
    return null;
  }

  return typedUser;
}

export async function createUser(
  edipi: string,
  email: string,
  password: string,
  personnelId?: string
): Promise<User | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  // Hash password (base64 for now - should use bcrypt in production)
  const passwordHash = btoa(password);

  const { data, error } = await supabase
    .from("users")
    .insert({
      id: crypto.randomUUID(),
      edipi,
      email,
      password_hash: passwordHash,
      personnel_id: personnelId || null,
      can_approve_non_availability: false,
    } as never)
    .select()
    .single();

  if (error) {
    console.error("Error creating user:", error);
    return null;
  }
  return data as User;
}

export async function updateUser(id: string, updates: Partial<User>): Promise<User | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("users")
    .update(updates as never)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating user:", error);
    return null;
  }
  return data as User;
}

export async function deleteUser(id: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const supabase = getSupabase();

  // Delete user roles first
  await supabase.from("user_roles").delete().eq("user_id", id);

  // Delete user
  const { error } = await supabase
    .from("users")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error deleting user:", error);
    return false;
  }
  return true;
}

// ============================================================================
// ROLES
// ============================================================================

export async function getRoles(): Promise<Role[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("roles")
    .select("*")
    .order("name");

  if (error) {
    console.error("Error fetching roles:", error);
    return [];
  }
  return data || [];
}

export async function getRoleByName(name: RoleName): Promise<Role | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("roles")
    .select("*")
    .eq("name", name)
    .single();

  if (error) {
    console.error("Error fetching role:", error);
    return null;
  }
  return data;
}

export async function getUserRoles(userId: string): Promise<(UserRole & { role: Role })[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("user_roles")
    .select("*, role:roles(*)")
    .eq("user_id", userId);

  if (error) {
    console.error("Error fetching user roles:", error);
    return [];
  }
  return data || [];
}

export async function addUserRole(
  userId: string,
  roleId: string,
  scopeUnitId?: string
): Promise<UserRole | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  // First check if this exact role already exists to avoid 409 conflict
  const { data: existingRoles, error: fetchError } = await supabase
    .from("user_roles")
    .select("*")
    .eq("user_id", userId)
    .eq("role_id", roleId);

  if (fetchError) {
    console.error("Error checking existing roles:", fetchError);
    return null;
  }

  // Check if we already have this role (with same or any scope)
  const roles = existingRoles as UserRole[] | null;
  if (roles && roles.length > 0) {
    // Find exact match (same scope)
    const exactMatch = roles.find(r => r.scope_unit_id === (scopeUnitId || null));
    if (exactMatch) {
      console.log("Role already exists with exact scope, returning existing");
      return exactMatch;
    }

    // If there's a unique constraint on (user_id, role_id), we can't add another
    // This handles cases where the constraint doesn't include scope_unit_id
    console.log("Role exists with different scope, attempting to update scope");
    // Update the existing role's scope instead of inserting
    const existingRole = roles[0];
    const { data: updated, error: updateError } = await supabase
      .from("user_roles")
      .update({ scope_unit_id: scopeUnitId || null } as never)
      .eq("id", existingRole.id)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating role scope:", updateError);
      return null;
    }
    return updated as UserRole;
  }

  // Insert new role
  const { data, error } = await supabase
    .from("user_roles")
    .insert({
      user_id: userId,
      role_id: roleId,
      scope_unit_id: scopeUnitId || null,
    } as never)
    .select()
    .single();

  if (error) {
    // If we get a unique constraint violation (23505), try to fetch and return the existing role
    if (error.code === "23505") {
      console.log("Insert conflict (unique constraint), fetching existing role");
      const { data: existing } = await supabase
        .from("user_roles")
        .select("*")
        .eq("user_id", userId)
        .eq("role_id", roleId)
        .maybeSingle();
      if (existing) {
        return existing as UserRole;
      }
    }
    console.error("Error adding user role:", error);
    return null;
  }
  return data as UserRole;
}

export async function removeUserRole(userRoleId: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const supabase = getSupabase();

  const { error } = await supabase
    .from("user_roles")
    .delete()
    .eq("id", userRoleId);

  if (error) {
    console.error("Error removing user role:", error);
    return false;
  }
  return true;
}

// ============================================================================
// QUALIFICATIONS
// ============================================================================

export async function getQualifications(organizationId?: string): Promise<Qualification[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabase();

  let query = supabase.from("qualifications").select("*").order("name");

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching qualifications:", error);
    return [];
  }
  return data || [];
}

export async function getPersonnelQualifications(personnelId: string): Promise<PersonnelQualification[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("personnel_qualifications")
    .select("*, qualification:qualifications(*)")
    .eq("personnel_id", personnelId);

  if (error) {
    console.error("Error fetching personnel qualifications:", error);
    return [];
  }
  return data || [];
}

// ============================================================================
// DUTY TYPES
// ============================================================================

export async function getDutyTypes(organizationId?: string): Promise<DutyType[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabase();

  let query = supabase.from("duty_types").select("*").order("name");

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching duty types:", error);
    return [];
  }
  return data || [];
}

export async function getDutyTypesByUnit(unitId: string): Promise<DutyType[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("duty_types")
    .select("*")
    .eq("unit_id", unitId)
    .order("name");

  if (error) {
    console.error("Error fetching duty types by unit:", error);
    return [];
  }
  return data || [];
}

export async function getDutyTypeById(id: string): Promise<DutyType | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("duty_types")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error("Error fetching duty type:", error);
    return null;
  }
  return data;
}

export async function getDutyValues(dutyTypeId: string): Promise<DutyValue[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("duty_values")
    .select("*")
    .eq("duty_type_id", dutyTypeId)
    .order("day_of_week");

  if (error) {
    console.error("Error fetching duty values:", error);
    return [];
  }
  return data || [];
}

export async function getDutyRequirements(dutyTypeId: string): Promise<DutyRequirement[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("duty_requirements")
    .select("*, qualification:qualifications(*)")
    .eq("duty_type_id", dutyTypeId);

  if (error) {
    console.error("Error fetching duty requirements:", error);
    return [];
  }
  return data || [];
}

// ============================================================================
// DUTY VALUES (write operations)
// ============================================================================

// Create or update a duty value (upsert)
export async function createDutyValue(
  dutyTypeId: string,
  options: {
    id?: string;
    baseWeight?: number;
    weekendMultiplier?: number;
    holidayMultiplier?: number;
  }
): Promise<DutyValue | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  // TODO: The database schema uses day_of_week/value but the app uses base_weight/multipliers.
  // weekendMultiplier and holidayMultiplier are not currently stored in the database schema.
  // A schema migration is needed to support these fields.
  if (options.weekendMultiplier !== undefined || options.holidayMultiplier !== undefined) {
    console.warn(
      "[Supabase Sync] weekendMultiplier and holidayMultiplier are not stored in the database. " +
      "These values will only persist in localStorage/GitHub sync. Schema migration needed."
    );
  }

  // Use upsert to handle both create and update cases
  const { data, error } = await supabase
    .from("duty_values")
    .upsert({
      id: options.id,
      duty_type_id: dutyTypeId,
      day_of_week: 0, // Base value - schema stores per-day values, app uses base weight
      value: options.baseWeight ?? 1,
    } as never, { onConflict: 'id' })
    .select()
    .single();

  if (error) {
    console.error("Error upserting duty value:", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      dutyTypeId,
      id: options.id,
    });
    return null;
  }
  return data as DutyValue;
}

export async function updateDutyValue(
  id: string,
  updates: {
    baseWeight?: number;
    weekendMultiplier?: number;
    holidayMultiplier?: number;
  }
): Promise<DutyValue | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  // TODO: weekendMultiplier and holidayMultiplier are not stored in the database schema.
  // A schema migration is needed to support these fields.
  if (updates.weekendMultiplier !== undefined || updates.holidayMultiplier !== undefined) {
    console.warn(
      "[Supabase Sync] weekendMultiplier and holidayMultiplier are not stored in the database. " +
      "These values will only persist in localStorage/GitHub sync. Schema migration needed."
    );
  }

  const supabaseUpdates: Record<string, unknown> = {};
  if (updates.baseWeight !== undefined) supabaseUpdates.value = updates.baseWeight;

  if (Object.keys(supabaseUpdates).length === 0) return null;

  const { data, error } = await supabase
    .from("duty_values")
    .update(supabaseUpdates as never)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating duty value:", error);
    return null;
  }
  return data as DutyValue;
}

export async function deleteDutyValue(id: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const supabase = getSupabase();

  const { error } = await supabase
    .from("duty_values")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error deleting duty value:", error);
    return false;
  }
  return true;
}

export async function deleteDutyValuesByDutyType(dutyTypeId: string): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("duty_values")
    .delete()
    .eq("duty_type_id", dutyTypeId)
    .select();

  if (error) {
    console.error("Error deleting duty values:", error);
    return 0;
  }
  return data?.length || 0;
}

// ============================================================================
// DUTY REQUIREMENTS (write operations)
// ============================================================================

export async function createDutyRequirement(
  dutyTypeId: string,
  qualificationId: string,
  isRequired: boolean = true
): Promise<DutyRequirement | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("duty_requirements")
    .insert({
      duty_type_id: dutyTypeId,
      qualification_id: qualificationId,
      is_required: isRequired,
    } as never)
    .select()
    .single();

  if (error) {
    console.error("Error creating duty requirement:", error);
    return null;
  }
  return data as DutyRequirement;
}

export async function deleteDutyRequirement(id: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const supabase = getSupabase();

  const { error } = await supabase
    .from("duty_requirements")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error deleting duty requirement:", error);
    return false;
  }
  return true;
}

export async function deleteDutyRequirementsByDutyType(dutyTypeId: string): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("duty_requirements")
    .delete()
    .eq("duty_type_id", dutyTypeId)
    .select();

  if (error) {
    console.error("Error deleting duty requirements:", error);
    return 0;
  }
  return data?.length || 0;
}

// ============================================================================
// DUTY CHANGE REQUESTS (write operations)
// ============================================================================

export async function createDutyChangeRequest(
  organizationId: string,
  request: {
    id?: string;
    originalSlotId: string;
    originalPersonnelId: string;
    targetPersonnelId: string;
    requestedBy?: string;
    reason?: string;
  }
): Promise<DutyChangeRequest | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("duty_change_requests")
    .insert({
      id: request.id,
      organization_id: organizationId,
      original_slot_id: request.originalSlotId,
      original_personnel_id: request.originalPersonnelId,
      target_personnel_id: request.targetPersonnelId,
      status: "pending",
      requested_by: request.requestedBy || null,
      reason: request.reason || null,
    } as never)
    .select()
    .single();

  if (error) {
    console.error("Error creating duty change request:", error);
    return null;
  }
  return data as DutyChangeRequest;
}

export async function updateDutyChangeRequest(
  id: string,
  updates: {
    status?: "pending" | "approved" | "rejected";
    approvedBy?: string;
    reason?: string;
  }
): Promise<DutyChangeRequest | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const supabaseUpdates: Record<string, unknown> = {};
  if (updates.status !== undefined) supabaseUpdates.status = updates.status;
  if (updates.approvedBy !== undefined) supabaseUpdates.approved_by = updates.approvedBy;
  if (updates.reason !== undefined) supabaseUpdates.reason = updates.reason;

  if (Object.keys(supabaseUpdates).length === 0) return null;

  const { data, error } = await supabase
    .from("duty_change_requests")
    .update(supabaseUpdates as never)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating duty change request:", error);
    return null;
  }
  return data as DutyChangeRequest;
}

export async function deleteDutyChangeRequest(id: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const supabase = getSupabase();

  const { error } = await supabase
    .from("duty_change_requests")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error deleting duty change request:", error);
    return false;
  }
  return true;
}

// Create or update a duty type (upsert)
export async function createDutyType(
  organizationId: string,
  unitId: string,
  name: string,
  options?: {
    id?: string;
    description?: string | null;
    personnelRequired?: number;
    rankFilterMode?: "none" | "include" | "exclude";
    rankFilterValues?: string[] | null;
    sectionFilterMode?: "none" | "include" | "exclude";
    sectionFilterValues?: string[] | null;
  }
): Promise<DutyType | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  // Verify the unit exists in Supabase before attempting upsert
  const { data: unitExists, error: unitError } = await supabase
    .from("units")
    .select("id")
    .eq("id", unitId)
    .single();

  if (unitError || !unitExists) {
    console.error("Error: Unit does not exist in Supabase:", {
      unitId,
      error: unitError?.message,
      hint: "The unit must exist in Supabase before creating duty types. Make sure you're using a unit that was loaded from Supabase."
    });
    return null;
  }

  // Verify the organization exists
  const { data: orgExists, error: orgError } = await supabase
    .from("organizations")
    .select("id")
    .eq("id", organizationId)
    .single();

  if (orgError || !orgExists) {
    console.error("Error: Organization does not exist in Supabase:", {
      organizationId,
      error: orgError?.message,
    });
    return null;
  }

  // Use upsert to handle both create and update cases
  const { data, error } = await supabase
    .from("duty_types")
    .upsert({
      id: options?.id,
      organization_id: organizationId,
      unit_id: unitId,
      name: name,
      description: options?.description || null,
      personnel_required: options?.personnelRequired ?? 1,
      rank_filter_mode: options?.rankFilterMode ?? "none",
      rank_filter_values: options?.rankFilterValues || null,
      section_filter_mode: options?.sectionFilterMode ?? "none",
      section_filter_values: options?.sectionFilterValues || null,
    } as never, { onConflict: 'id' })
    .select()
    .single();

  if (error) {
    console.error("Error upserting duty type:", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      organizationId,
      unitId,
      name,
    });
    return null;
  }
  return data as DutyType;
}

// Update an existing duty type
export async function updateDutyType(
  id: string,
  updates: {
    name?: string;
    description?: string | null;
    personnelRequired?: number;
    rankFilterMode?: "none" | "include" | "exclude";
    rankFilterValues?: string[] | null;
    sectionFilterMode?: "none" | "include" | "exclude";
    sectionFilterValues?: string[] | null;
  }
): Promise<DutyType | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const supabaseUpdates: Record<string, unknown> = {};
  if (updates.name !== undefined) supabaseUpdates.name = updates.name;
  if (updates.description !== undefined) supabaseUpdates.description = updates.description;
  if (updates.personnelRequired !== undefined) supabaseUpdates.personnel_required = updates.personnelRequired;
  if (updates.rankFilterMode !== undefined) supabaseUpdates.rank_filter_mode = updates.rankFilterMode;
  if (updates.rankFilterValues !== undefined) supabaseUpdates.rank_filter_values = updates.rankFilterValues;
  if (updates.sectionFilterMode !== undefined) supabaseUpdates.section_filter_mode = updates.sectionFilterMode;
  if (updates.sectionFilterValues !== undefined) supabaseUpdates.section_filter_values = updates.sectionFilterValues;

  if (Object.keys(supabaseUpdates).length === 0) return null;

  const { data, error } = await supabase
    .from("duty_types")
    .update(supabaseUpdates as never)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating duty type:", error);
    return null;
  }
  return data as DutyType;
}

// Delete a duty type
export async function deleteDutyType(id: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const supabase = getSupabase();

  const { error } = await supabase
    .from("duty_types")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error deleting duty type:", error);
    return false;
  }
  return true;
}

// ============================================================================
// DUTY SLOTS (ROSTER)
// ============================================================================

export async function getDutySlots(
  organizationId?: string,
  startDate?: string,
  endDate?: string
): Promise<DutySlot[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabase();

  let query = supabase.from("duty_slots").select("*").order("date_assigned");

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }
  if (startDate) {
    query = query.gte("date_assigned", startDate);
  }
  if (endDate) {
    query = query.lte("date_assigned", endDate);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching duty slots:", error);
    return [];
  }
  return data || [];
}

export async function getDutySlotsByPersonnel(personnelId: string): Promise<DutySlot[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("duty_slots")
    .select("*")
    .eq("personnel_id", personnelId)
    .order("date_assigned");

  if (error) {
    console.error("Error fetching duty slots by personnel:", error);
    return [];
  }
  return data || [];
}

export async function createDutySlot(
  organizationId: string,
  dutyTypeId: string,
  personnelId: string,
  dateAssigned: string,
  assignedBy?: string
): Promise<DutySlot | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("duty_slots")
    .insert({
      organization_id: organizationId,
      duty_type_id: dutyTypeId,
      personnel_id: personnelId,
      date_assigned: dateAssigned,
      status: "scheduled",
      assigned_by: assignedBy || null,
    } as never)
    .select()
    .single();

  if (error) {
    console.error("Error creating duty slot:", error);
    return null;
  }
  return data as DutySlot;
}

export async function updateDutySlot(id: string, updates: Partial<DutySlot>): Promise<DutySlot | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("duty_slots")
    .update(updates as never)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating duty slot:", error);
    return null;
  }
  return data as DutySlot;
}

export async function deleteDutySlot(id: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const supabase = getSupabase();

  const { error } = await supabase
    .from("duty_slots")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error deleting duty slot:", error);
    return false;
  }
  return true;
}

// Batch create duty slots (for scheduler)
export async function createDutySlots(
  slots: Array<{
    id?: string;
    organizationId: string;
    dutyTypeId: string;
    personnelId: string;
    dateAssigned: string;
    assignedBy?: string;
  }>
): Promise<{ created: number; errors: string[] }> {
  if (!isSupabaseConfigured()) return { created: 0, errors: ["Supabase not configured"] };
  if (slots.length === 0) return { created: 0, errors: [] };

  const supabase = getSupabase();
  const result = { created: 0, errors: [] as string[] };

  // Convert to Supabase format
  const insertData = slots.map((slot) => ({
    id: slot.id,
    organization_id: slot.organizationId,
    duty_type_id: slot.dutyTypeId,
    personnel_id: slot.personnelId,
    date_assigned: slot.dateAssigned,
    status: "scheduled" as const,
    assigned_by: slot.assignedBy || null,
  }));

  // Insert in batches of 100 to avoid hitting limits
  const batchSize = 100;
  for (let i = 0; i < insertData.length; i += batchSize) {
    const batch = insertData.slice(i, i + batchSize);

    const { data, error } = await supabase
      .from("duty_slots")
      .insert(batch as never)
      .select();

    if (error) {
      result.errors.push(`Batch ${Math.floor(i / batchSize) + 1} failed: ${error.message}`);
    } else {
      result.created += data?.length || 0;
    }
  }

  return result;
}

// Delete duty slots in a date range (for clearing before re-scheduling)
export async function deleteDutySlotsInRange(
  organizationId: string,
  startDate: string,
  endDate: string,
  unitId?: string
): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const supabase = getSupabase();

  let query = supabase
    .from("duty_slots")
    .delete()
    .eq("organization_id", organizationId)
    .gte("date_assigned", startDate)
    .lte("date_assigned", endDate);

  // If unitId specified, filter by duty types belonging to that unit
  if (unitId) {
    // First get duty type IDs for this unit
    const { data: dutyTypes } = await supabase
      .from("duty_types")
      .select("id")
      .eq("unit_id", unitId) as { data: { id: string }[] | null };

    const dutyTypeIds = dutyTypes?.map((dt) => dt.id) ?? [];
    // Always apply the filter when unitId is specified.
    // An empty array in the 'in' clause will correctly result in no rows being deleted,
    // preventing accidental deletion of slots from other units.
    query = query.in("duty_type_id", dutyTypeIds);
  }

  const { data, error } = await query.select();

  if (error) {
    console.error("Error deleting duty slots in range:", error);
    return 0;
  }
  return data?.length || 0;
}

// ============================================================================
// NON-AVAILABILITY
// ============================================================================

export async function getNonAvailability(
  organizationId?: string,
  personnelId?: string
): Promise<NonAvailability[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabase();

  let query = supabase.from("non_availability").select("*").order("start_date");

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }
  if (personnelId) {
    query = query.eq("personnel_id", personnelId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching non-availability:", error);
    return [];
  }
  return data || [];
}

export async function createNonAvailability(
  organizationId: string,
  personnelId: string,
  startDate: string,
  endDate: string,
  options?: {
    id?: string;
    reason?: string;
    status?: string;
    submittedBy?: string;
    approvedBy?: string;
  }
): Promise<NonAvailability | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const insertData: Record<string, unknown> = {
    organization_id: organizationId,
    personnel_id: personnelId,
    start_date: startDate,
    end_date: endDate,
    reason: options?.reason || null,
    status: options?.status || "pending",
    submitted_by: options?.submittedBy || null,
    approved_by: options?.approvedBy || null,
  };
  if (options?.id) {
    insertData.id = options.id;
  }

  const { data, error } = await supabase
    .from("non_availability")
    .insert(insertData as never)
    .select()
    .single();

  if (error) {
    console.error("Error creating non-availability:", error);
    return null;
  }
  return data as NonAvailability;
}

export async function updateNonAvailability(
  id: string,
  updates: Partial<NonAvailability>
): Promise<NonAvailability | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("non_availability")
    .update(updates as never)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating non-availability:", error);
    return null;
  }
  return data as NonAvailability;
}

export async function deleteNonAvailability(id: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const supabase = getSupabase();

  const { error } = await supabase
    .from("non_availability")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error deleting non-availability:", error);
    return false;
  }
  return true;
}

// ============================================================================
// DUTY SCORE EVENTS
// ============================================================================

// Get all duty score events for an organization
export async function getDutyScoreEvents(
  organizationId?: string,
  personnelId?: string
): Promise<DutyScoreEvent[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabase();

  let query = supabase
    .from("duty_score_events")
    .select("*")
    .order("date_earned", { ascending: false });

  if (organizationId) {
    // Get units for this organization to filter by unit_section_id
    const { data: units } = await supabase
      .from("units")
      .select("id")
      .eq("organization_id", organizationId) as { data: { id: string }[] | null };

    if (units && units.length > 0) {
      const unitIds = units.map(u => u.id);
      query = query.in("unit_section_id", unitIds);
    }
  }

  if (personnelId) {
    query = query.eq("personnel_id", personnelId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching duty score events:", error);
    return [];
  }
  return (data || []) as DutyScoreEvent[];
}

// Get score events for a specific personnel within a date range
export async function getPersonnelScoreEvents(
  personnelId: string,
  startDate?: string,
  endDate?: string
): Promise<DutyScoreEvent[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabase();

  let query = supabase
    .from("duty_score_events")
    .select("*")
    .eq("personnel_id", personnelId)
    .order("date_earned", { ascending: false });

  if (startDate) {
    query = query.gte("date_earned", startDate);
  }
  if (endDate) {
    query = query.lte("date_earned", endDate);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching personnel score events:", error);
    return [];
  }
  return (data || []) as DutyScoreEvent[];
}

// Get score events for a roster month
export async function getScoreEventsByRosterMonth(
  rosterMonth: string,
  organizationId?: string
): Promise<DutyScoreEvent[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabase();

  let query = supabase
    .from("duty_score_events")
    .select("*")
    .eq("roster_month", rosterMonth)
    .order("date_earned");

  if (organizationId) {
    const { data: units } = await supabase
      .from("units")
      .select("id")
      .eq("organization_id", organizationId) as { data: { id: string }[] | null };

    if (units && units.length > 0) {
      const unitIds = units.map(u => u.id);
      query = query.in("unit_section_id", unitIds);
    }
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching score events by roster month:", error);
    return [];
  }
  return (data || []) as DutyScoreEvent[];
}

// Create a duty score event
export async function createDutyScoreEvent(
  event: DutyScoreEventInsert
): Promise<DutyScoreEvent | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("duty_score_events")
    .insert(asInsert(event))
    .select()
    .single();

  if (error) {
    console.error("Error creating duty score event:", error);
    return null;
  }
  return data;
}

// Create multiple duty score events (batch insert)
export async function createDutyScoreEvents(
  events: DutyScoreEventInsert[]
): Promise<{ created: number; errors: string[] }> {
  if (!isSupabaseConfigured()) return { created: 0, errors: ["Supabase not configured"] };
  if (events.length === 0) return { created: 0, errors: [] };

  const supabase = getSupabase();
  const result = { created: 0, errors: [] as string[] };

  // Insert in batches of 100 to avoid hitting limits
  const batchSize = 100;
  for (let i = 0; i < events.length; i += batchSize) {
    const batch = events.slice(i, i + batchSize);

    const { data, error } = await supabase
      .from("duty_score_events")
      .insert(batch as never)
      .select();

    if (error) {
      result.errors.push(`Batch ${Math.floor(i / batchSize) + 1} failed: ${error.message}`);
    } else {
      result.created += data?.length || 0;
    }
  }

  return result;
}

// Delete score events for a roster month (useful when un-approving)
export async function deleteScoreEventsByRosterMonth(
  rosterMonth: string,
  unitSectionId?: string
): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const supabase = getSupabase();

  let query = supabase
    .from("duty_score_events")
    .delete()
    .eq("roster_month", rosterMonth);

  if (unitSectionId) {
    query = query.eq("unit_section_id", unitSectionId);
  }

  const { data, error } = await query.select();

  if (error) {
    console.error("Error deleting score events:", error);
    return 0;
  }
  return data?.length || 0;
}

// Calculate personnel score from events (last N months)
export async function calculatePersonnelScoreFromEvents(
  personnelId: string,
  monthsBack: number = 12
): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const supabase = getSupabase();

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - monthsBack);
  const startDateStr = startDate.toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("duty_score_events")
    .select("points")
    .eq("personnel_id", personnelId)
    .gte("date_earned", startDateStr) as { data: { points: number }[] | null; error: Error | null };

  if (error) {
    console.error("Error calculating personnel score:", error);
    return 0;
  }

  return (data || []).reduce((sum, event) => sum + (event.points || 0), 0);
}

// ============================================================================
// REAL-TIME SUBSCRIPTIONS
// ============================================================================

export type SubscriptionCallback<T> = (payload: {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T | null;
  old: T | null;
}) => void;

export function subscribeToTable<T>(
  table: string,
  callback: SubscriptionCallback<T>,
  filter?: { column: string; value: string }
) {
  if (!isSupabaseConfigured()) return () => {};
  const supabase = getSupabase();

  const channelName = filter
    ? `${table}_${filter.column}_${filter.value}`
    : `${table}_all`;

  const filterString = filter ? `${filter.column}=eq.${filter.value}` : undefined;

  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table,
        filter: filterString,
      },
      (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => {
        callback({
          eventType: payload.eventType as "INSERT" | "UPDATE" | "DELETE",
          new: payload.new as T | null,
          old: payload.old as T | null,
        });
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// Convenience subscription functions
export function subscribeToPersonnel(
  callback: SubscriptionCallback<Personnel>,
  organizationId?: string
) {
  return subscribeToTable(
    "personnel",
    callback,
    organizationId ? { column: "organization_id", value: organizationId } : undefined
  );
}

export function subscribeToDutySlots(
  callback: SubscriptionCallback<DutySlot>,
  organizationId?: string
) {
  return subscribeToTable(
    "duty_slots",
    callback,
    organizationId ? { column: "organization_id", value: organizationId } : undefined
  );
}

export function subscribeToNonAvailability(
  callback: SubscriptionCallback<NonAvailability>,
  organizationId?: string
) {
  return subscribeToTable(
    "non_availability",
    callback,
    organizationId ? { column: "organization_id", value: organizationId } : undefined
  );
}

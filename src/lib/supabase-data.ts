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
// USERS & AUTHENTICATION
// ============================================================================

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
  reason?: string,
  submittedBy?: string
): Promise<NonAvailability | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("non_availability")
    .insert({
      organization_id: organizationId,
      personnel_id: personnelId,
      start_date: startDate,
      end_date: endDate,
      reason: reason || null,
      status: "pending",
      submitted_by: submittedBy || null,
    } as never)
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

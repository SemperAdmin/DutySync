"use client";

import { useState, useEffect, useCallback } from "react";
import { isSupabaseConfigured } from "@/lib/supabase";
import * as supabaseData from "@/lib/supabase-data";
import type {
  Organization,
  Unit,
  Personnel,
  User,
  DutyType,
  DutySlot,
  NonAvailability,
} from "@/types/supabase";

// Generic hook for loading data with real-time updates
export function useSupabaseQuery<T>(
  queryFn: () => Promise<T>,
  deps: unknown[] = []
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await queryFn();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}

// ============================================================================
// ORGANIZATION HOOKS
// ============================================================================

export function useOrganizations() {
  return useSupabaseQuery<Organization[]>(supabaseData.getOrganizations);
}

export function useOrganization(rucCode: string | null) {
  return useSupabaseQuery<Organization | null>(
    () => rucCode ? supabaseData.getOrganizationByRuc(rucCode) : Promise.resolve(null),
    [rucCode]
  );
}

// ============================================================================
// UNIT HOOKS
// ============================================================================

export function useUnits(organizationId?: string) {
  return useSupabaseQuery<Unit[]>(
    () => supabaseData.getUnits(organizationId),
    [organizationId]
  );
}

export function useUnitsByRuc(rucCode: string | null) {
  return useSupabaseQuery<Unit[]>(
    () => rucCode ? supabaseData.getUnitsByRuc(rucCode) : Promise.resolve([]),
    [rucCode]
  );
}

export function useUnit(id: string | null) {
  return useSupabaseQuery<Unit | null>(
    () => id ? supabaseData.getUnitById(id) : Promise.resolve(null),
    [id]
  );
}

export function useChildUnits(parentId: string | null) {
  return useSupabaseQuery<Unit[]>(
    () => parentId ? supabaseData.getChildUnits(parentId) : Promise.resolve([]),
    [parentId]
  );
}

// ============================================================================
// PERSONNEL HOOKS
// ============================================================================

export function usePersonnel(organizationId?: string) {
  const { data, loading, error, refetch } = useSupabaseQuery<Personnel[]>(
    () => supabaseData.getPersonnel(organizationId),
    [organizationId]
  );

  // Subscribe to real-time updates
  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const unsubscribe = supabaseData.subscribeToPersonnel(
      () => refetch(),
      organizationId
    );

    return unsubscribe;
  }, [organizationId, refetch]);

  return { data: data || [], loading, error, refetch };
}

export function usePersonnelByUnit(unitId: string | null) {
  return useSupabaseQuery<Personnel[]>(
    () => unitId ? supabaseData.getPersonnelByUnit(unitId) : Promise.resolve([]),
    [unitId]
  );
}

export function usePersonnelByUnits(unitIds: string[]) {
  return useSupabaseQuery<Personnel[]>(
    () => supabaseData.getPersonnelByUnits(unitIds),
    [unitIds.join(",")]
  );
}

// ============================================================================
// USER HOOKS
// ============================================================================

export function useUsers() {
  return useSupabaseQuery<User[]>(supabaseData.getUsers);
}

export function useUser(id: string | null) {
  return useSupabaseQuery<User | null>(
    () => id ? supabaseData.getUserById(id) : Promise.resolve(null),
    [id]
  );
}

export function useUserRoles(userId: string | null) {
  return useSupabaseQuery(
    () => userId ? supabaseData.getUserRoles(userId) : Promise.resolve([]),
    [userId]
  );
}

// ============================================================================
// DUTY TYPE HOOKS
// ============================================================================

export function useDutyTypes(organizationId?: string) {
  return useSupabaseQuery<DutyType[]>(
    () => supabaseData.getDutyTypes(organizationId),
    [organizationId]
  );
}

export function useDutyTypesByUnit(unitId: string | null) {
  return useSupabaseQuery<DutyType[]>(
    () => unitId ? supabaseData.getDutyTypesByUnit(unitId) : Promise.resolve([]),
    [unitId]
  );
}

export function useDutyType(id: string | null) {
  return useSupabaseQuery<DutyType | null>(
    () => id ? supabaseData.getDutyTypeById(id) : Promise.resolve(null),
    [id]
  );
}

// ============================================================================
// DUTY SLOT HOOKS
// ============================================================================

export function useDutySlots(
  organizationId?: string,
  startDate?: string,
  endDate?: string
) {
  const { data, loading, error, refetch } = useSupabaseQuery<DutySlot[]>(
    () => supabaseData.getDutySlots(organizationId, startDate, endDate),
    [organizationId, startDate, endDate]
  );

  // Subscribe to real-time updates
  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const unsubscribe = supabaseData.subscribeToDutySlots(
      () => refetch(),
      organizationId
    );

    return unsubscribe;
  }, [organizationId, refetch]);

  return { data: data || [], loading, error, refetch };
}

export function useDutySlotsByPersonnel(personnelId: string | null) {
  return useSupabaseQuery<DutySlot[]>(
    () => personnelId ? supabaseData.getDutySlotsByPersonnel(personnelId) : Promise.resolve([]),
    [personnelId]
  );
}

// ============================================================================
// NON-AVAILABILITY HOOKS
// ============================================================================

export function useNonAvailability(organizationId?: string, personnelId?: string) {
  const { data, loading, error, refetch } = useSupabaseQuery<NonAvailability[]>(
    () => supabaseData.getNonAvailability(organizationId, personnelId),
    [organizationId, personnelId]
  );

  // Subscribe to real-time updates
  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const unsubscribe = supabaseData.subscribeToNonAvailability(
      () => refetch(),
      organizationId
    );

    return unsubscribe;
  }, [organizationId, refetch]);

  return { data: data || [], loading, error, refetch };
}

// ============================================================================
// SUPABASE STATUS
// ============================================================================

export function useSupabaseStatus() {
  const [isConfigured] = useState(() => isSupabaseConfigured());
  return { isConfigured };
}

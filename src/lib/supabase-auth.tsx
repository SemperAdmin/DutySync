"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { isSupabaseConfigured, getSupabase } from "./supabase";
import * as supabaseData from "./supabase-data";
import * as dataLayer from "./data-layer";
import type { SessionUser, UserRole, RoleName } from "@/types";
import type { User, Personnel, Unit } from "@/types/supabase";

interface SignupResult {
  success: boolean;
  error?: string;
  autoAssignedUnitAdmin?: boolean;
  organizationName?: string;
}

// RUC option for the selector dropdown
export interface RucOption {
  ruc: string;
  name: string | null;
  organizationId: string;
}

interface AuthContextType {
  user: SessionUser | null;
  isLoading: boolean;
  login: (edipi: string, password: string) => Promise<boolean>;
  logout: () => void;
  signup: (edipi: string, email: string, password: string) => Promise<SignupResult>;
  refreshSession: () => Promise<void>;
  // Multi-RUC support
  selectedRuc: string | null;
  availableRucs: RucOption[];
  setSelectedRuc: (ruc: string | null) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Role name constants
const ROLE_NAMES = {
  APP_ADMIN: "App Admin" as RoleName,
  UNIT_ADMIN: "Unit Admin" as RoleName,
  STANDARD_USER: "Standard User" as RoleName,
};

// App Admin EDIPI from environment variable
const APP_ADMIN_EDIPI = process.env.NEXT_PUBLIC_APP_ADMIN || "";

// Check if a user's EDIPI matches the App Admin
function isAppAdminByEdipi(edipi: string | null | undefined): boolean {
  if (!edipi || !APP_ADMIN_EDIPI) return false;
  return edipi === APP_ADMIN_EDIPI;
}

/**
 * Determine the user's organization RUC from their roles.
 * Returns the RUC code if user has a scoped role, null otherwise.
 * App Admins don't have a specific organization scope.
 */
async function getUserOrganizationRuc(sessionUser: SessionUser): Promise<string | null> {
  // App Admin doesn't have organization scope
  if (sessionUser.roles.some(r => r.role_name === ROLE_NAMES.APP_ADMIN)) {
    return null;
  }

  // Find the user's scoped role (Unit Admin or Manager roles)
  const scopedRole = sessionUser.roles.find(r =>
    r.scope_unit_id && (
      r.role_name === "Unit Admin" ||
      r.role_name === "Unit Manager" ||
      r.role_name === "Company Manager" ||
      r.role_name === "Section Manager" ||
      r.role_name === "Work Section Manager"
    )
  );

  if (!scopedRole?.scope_unit_id) {
    // Try to determine from personnel record if available
    if (sessionUser.unitId) {
      const unit = await supabaseData.getUnitById(sessionUser.unitId);
      if (unit?.organization_id) {
        const org = await supabaseData.getOrganizationById(unit.organization_id);
        if (org) {
          return org.ruc_code;
        }
      }
    }
    return null;
  }

  // Get the unit to find its organization
  const unit = await supabaseData.getUnitById(scopedRole.scope_unit_id);
  if (!unit?.organization_id) {
    console.warn("[Auth] Could not determine organization from scope unit");
    return null;
  }

  // Get the organization to get the RUC code
  const org = await supabaseData.getOrganizationById(unit.organization_id);
  if (!org) {
    console.warn("[Auth] Organization not found for unit");
    return null;
  }

  return org.ruc_code;
}

/**
 * Get all available RUCs for a user (from their Unit Admin roles).
 * Returns the list of RUCs the user has Unit Admin access to.
 * For users with BOTH App Admin and Unit Admin roles, still returns their
 * Unit Admin RUCs so they can switch between them in Unit Admin view.
 * Returns empty array for users with no Unit Admin roles.
 */
async function getUserAvailableRucs(sessionUser: SessionUser): Promise<RucOption[]> {
  // Find all Unit Admin roles (user could have multiple)
  const unitAdminRoles = sessionUser.roles.filter(r =>
    r.role_name === "Unit Admin" && r.scope_unit_id
  );

  if (unitAdminRoles.length === 0) {
    return [];
  }

  const rucs: RucOption[] = [];
  const seenOrgIds = new Set<string>();

  for (const role of unitAdminRoles) {
    if (!role.scope_unit_id) continue;

    // Get the unit to find its organization
    const unit = await supabaseData.getUnitById(role.scope_unit_id);
    if (!unit?.organization_id || seenOrgIds.has(unit.organization_id)) continue;

    seenOrgIds.add(unit.organization_id);

    // Get the organization to get the RUC code
    const org = await supabaseData.getOrganizationById(unit.organization_id);
    if (org) {
      rucs.push({
        ruc: org.ruc_code,
        name: org.name,
        organizationId: org.id,
      });
    }
  }

  return rucs;
}

/**
 * Fetch personnel and unit info for a user, linking by EDIPI if needed.
 * This handles the case where personnel were imported after user was created.
 */
async function fetchPersonnelAndUnit(
  dbUser: User
): Promise<{ personnel: Personnel | null; unit: Unit | null }> {
  let personnel: Personnel | null = null;
  let unit: Unit | null = null;

  if (dbUser.personnel_id) {
    personnel = await supabaseData.getPersonnelById(dbUser.personnel_id);
    if (personnel) {
      unit = await supabaseData.getUnitById(personnel.unit_id);
    }
  } else {
    // Try to find personnel by service_id (EDIPI)
    personnel = await supabaseData.getPersonnelByServiceId(dbUser.edipi);
    if (personnel) {
      unit = await supabaseData.getUnitById(personnel.unit_id);
      // Link personnel to user for future sessions
      await supabaseData.updateUser(dbUser.id, { personnel_id: personnel.id });
    }
  }

  return { personnel, unit };
}

// Build SessionUser from Supabase data
async function buildSessionUser(
  dbUser: User,
  personnel: Personnel | null,
  unit: Unit | null
): Promise<SessionUser> {
  // Get user roles from database
  const userRoles = await supabaseData.getUserRoles(dbUser.id);

  const roles: UserRole[] = [];
  const isAppAdmin = isAppAdminByEdipi(dbUser.edipi);

  // Add App Admin role if EDIPI matches
  if (isAppAdmin) {
    roles.push({
      id: `role-${dbUser.id}-app-admin`,
      user_id: dbUser.id,
      role_name: ROLE_NAMES.APP_ADMIN,
      scope_unit_id: null,
      created_at: new Date(),
    });
  }

  // Add roles from database
  for (const userRole of userRoles) {
    const roleName = userRole.role.name as RoleName;

    // Skip duplicate App Admin role
    if (roleName === ROLE_NAMES.APP_ADMIN && isAppAdmin) {
      continue;
    }

    roles.push({
      id: userRole.id,
      user_id: userRole.user_id,
      role_name: roleName,
      scope_unit_id: userRole.scope_unit_id,
      created_at: new Date(userRole.created_at),
    });
  }

  // Default to Standard User if no roles
  if (roles.length === 0) {
    roles.push({
      id: `role-${dbUser.id}-standard-user`,
      user_id: dbUser.id,
      role_name: ROLE_NAMES.STANDARD_USER,
      scope_unit_id: null,
      created_at: new Date(),
    });
  }

  return {
    id: dbUser.id,
    edipi: dbUser.edipi,
    email: dbUser.email,
    personnel_id: personnel?.id || dbUser.personnel_id || null,
    roles,
    can_approve_non_availability: dbUser.can_approve_non_availability,
    displayName: personnel ? `${personnel.rank} ${personnel.last_name}` : undefined,
    rank: personnel?.rank,
    firstName: personnel?.first_name,
    lastName: personnel?.last_name,
    unitId: personnel?.unit_id,
    unitName: unit?.unit_name,
  };
}

// localStorage key for selected RUC
const SELECTED_RUC_KEY = "dutysync_selected_ruc";

export function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRuc, setSelectedRucState] = useState<string | null>(null);
  const [availableRucs, setAvailableRucs] = useState<RucOption[]>([]);

  // Initialize auth state
  useEffect(() => {
    const initializeAuth = async () => {
      if (!isSupabaseConfigured()) {
        console.warn("Supabase not configured - auth disabled");
        setIsLoading(false);
        return;
      }

      // Check for existing session in localStorage
      const stored = localStorage.getItem("dutysync_user");
      if (stored) {
        try {
          const sessionUser: SessionUser = JSON.parse(stored);

          // Refresh user data from Supabase
          const dbUser = await supabaseData.getUserByEdipi(sessionUser.edipi);
          if (dbUser) {
            // Get personnel and unit info using shared helper
            const { personnel, unit } = await fetchPersonnelAndUnit(dbUser);

            // Rebuild session with fresh data
            const refreshedUser = await buildSessionUser(dbUser, personnel, unit);
            setUser(refreshedUser);
            localStorage.setItem("dutysync_user", JSON.stringify(refreshedUser));

            // Get available RUCs for this user
            const rucs = await getUserAvailableRucs(refreshedUser);
            setAvailableRucs(rucs);

            // Restore selected RUC from localStorage, or use first available
            const storedRuc = localStorage.getItem(SELECTED_RUC_KEY);
            let rucToUse: string | null = null;

            if (rucs.length > 0) {
              // Check if stored RUC is still valid for this user
              if (storedRuc && rucs.some(r => r.ruc === storedRuc)) {
                rucToUse = storedRuc;
              } else {
                rucToUse = rucs[0].ruc;
              }
              setSelectedRucState(rucToUse);
              localStorage.setItem(SELECTED_RUC_KEY, rucToUse);
            } else {
              // App Admin or no Unit Admin roles - use stored or null
              const userRuc = await getUserOrganizationRuc(refreshedUser);
              rucToUse = userRuc;
              setSelectedRucState(rucToUse);
            }

            // Load all data from Supabase into the data layer cache
            await dataLayer.loadAllData(rucToUse || undefined);
          } else {
            // User no longer exists in database
            localStorage.removeItem("dutysync_user");
            localStorage.removeItem(SELECTED_RUC_KEY);
          }
        } catch (error) {
          console.error("Failed to restore session:", error);
          localStorage.removeItem("dutysync_user");
          localStorage.removeItem(SELECTED_RUC_KEY);
        }
      }

      setIsLoading(false);
    };

    initializeAuth();
  }, []);

  const login = async (edipi: string, password: string): Promise<boolean> => {
    if (!isSupabaseConfigured()) {
      console.error("Supabase not configured");
      return false;
    }

    try {
      // Authenticate against Supabase users table
      const dbUser = await supabaseData.authenticateUser(edipi, password);
      if (!dbUser) {
        return false;
      }

      // Get personnel and unit info using shared helper
      const { personnel, unit } = await fetchPersonnelAndUnit(dbUser);

      // Build session user
      const sessionUser = await buildSessionUser(dbUser, personnel, unit);
      setUser(sessionUser);
      localStorage.setItem("dutysync_user", JSON.stringify(sessionUser));

      // Get available RUCs for this user
      const rucs = await getUserAvailableRucs(sessionUser);
      setAvailableRucs(rucs);

      // Determine which RUC to use
      let rucToUse: string | null = null;

      if (rucs.length > 0) {
        // Check for previously stored selection
        const storedRuc = localStorage.getItem(SELECTED_RUC_KEY);
        if (storedRuc && rucs.some(r => r.ruc === storedRuc)) {
          rucToUse = storedRuc;
        } else {
          rucToUse = rucs[0].ruc;
        }
        setSelectedRucState(rucToUse);
        localStorage.setItem(SELECTED_RUC_KEY, rucToUse);
      } else {
        // App Admin or no Unit Admin roles
        const userRuc = await getUserOrganizationRuc(sessionUser);
        rucToUse = userRuc;
        setSelectedRucState(rucToUse);
      }

      // Load all data from Supabase into the data layer cache
      await dataLayer.loadAllData(rucToUse || undefined);

      return true;
    } catch (error) {
      console.error("Login failed:", error);
      return false;
    }
  };

  const signup = async (
    edipi: string,
    email: string,
    password: string
  ): Promise<SignupResult> => {
    if (!isSupabaseConfigured()) {
      return { success: false, error: "Database not configured" };
    }

    try {
      // Validate EDIPI format
      if (!/^[0-9]{10}$/.test(edipi)) {
        return { success: false, error: "EDIPI must be exactly 10 digits" };
      }

      // Check if EDIPI already registered
      const existing = await supabaseData.getUserByEdipi(edipi);
      if (existing) {
        return { success: false, error: "EDIPI already registered" };
      }

      // Look up personnel record by EDIPI
      const personnel = await supabaseData.getPersonnelByServiceId(edipi);

      // Create user in Supabase
      const newUser = await supabaseData.createUser(
        edipi,
        email,
        password,
        personnel?.id
      );

      if (!newUser) {
        return { success: false, error: "Failed to create account" };
      }

      // Check if this user's organization needs a Unit Admin
      let autoAssignedUnitAdmin = false;
      let organizationName: string | undefined;

      if (personnel?.unit_id) {
        // Get the unit to find the organization
        const unit = await supabaseData.getUnitById(personnel.unit_id);
        if (unit?.organization_id) {
          // Check if organization already has a Unit Admin
          const hasAdmin = await supabaseData.organizationHasUnitAdmin(unit.organization_id);

          if (!hasAdmin) {
            // Get the Unit Admin role and top-level unit in parallel
            const [unitAdminRole, topLevelUnit] = await Promise.all([
              supabaseData.getRoleByName(ROLE_NAMES.UNIT_ADMIN),
              supabaseData.getTopLevelUnitForOrganization(unit.organization_id),
            ]);

            if (unitAdminRole && topLevelUnit) {
              // Auto-assign user as Unit Admin and get organization name in parallel
              const [addUserRoleResult, org] = await Promise.all([
                supabaseData.addUserRole(newUser.id, unitAdminRole.id, topLevelUnit.id),
                supabaseData.getOrganizationById(unit.organization_id),
              ]);

              if (addUserRoleResult) {
                autoAssignedUnitAdmin = true;
                organizationName = org?.name || org?.ruc_code || undefined;
              }
            }
          }
        }
      }

      // Add default Standard User role (in addition to Unit Admin if assigned)
      const standardRole = await supabaseData.getRoleByName(ROLE_NAMES.STANDARD_USER);
      if (standardRole) {
        await supabaseData.addUserRole(newUser.id, standardRole.id);
      }

      return {
        success: true,
        autoAssignedUnitAdmin,
        organizationName
      };
    } catch (error) {
      console.error("Signup failed:", error);
      return { success: false, error: "An unexpected error occurred" };
    }
  };

  const logout = () => {
    setUser(null);
    setSelectedRucState(null);
    setAvailableRucs([]);
    localStorage.removeItem("dutysync_user");
    localStorage.removeItem(SELECTED_RUC_KEY);

    // Clear old cached data from localStorage
    const keysToRemove = [
      "dutysync_units",
      "dutysync_personnel",
      "dutysync_duty_types",
      "dutysync_duty_values",
      "dutysync_duty_requirements",
      "dutysync_duty_slots",
      "dutysync_non_availability",
      "dutysync_duty_change_requests",
      "dutysync_qualifications",
      "dutysync_blocked_duties",
      "dutysync_users",
      "dutysync_rucs",
      "dutysync_seed_loaded",
    ];
    keysToRemove.forEach(key => localStorage.removeItem(key));

    // Clear data layer caches and organization context
    dataLayer.clearAllDataCaches();
  };

  const refreshSession = async () => {
    if (!user || !isSupabaseConfigured()) return;

    try {
      const dbUser = await supabaseData.getUserByEdipi(user.edipi);
      if (!dbUser) return;

      // Get personnel and unit info using shared helper
      const { personnel, unit } = await fetchPersonnelAndUnit(dbUser);

      const refreshedUser = await buildSessionUser(dbUser, personnel, unit);
      setUser(refreshedUser);
      localStorage.setItem("dutysync_user", JSON.stringify(refreshedUser));

      // Refresh available RUCs
      const rucs = await getUserAvailableRucs(refreshedUser);
      setAvailableRucs(rucs);

      // Validate selected RUC is still valid
      if (selectedRuc && rucs.length > 0 && !rucs.some(r => r.ruc === selectedRuc)) {
        // Selected RUC no longer valid, switch to first available
        setSelectedRucState(rucs[0].ruc);
        localStorage.setItem(SELECTED_RUC_KEY, rucs[0].ruc);
      }
    } catch (error) {
      console.error("Failed to refresh session:", error);
    }
  };

  // Switch to a different RUC and reload data
  const setSelectedRuc = async (ruc: string | null): Promise<void> => {
    if (ruc === selectedRuc) return; // No change

    setSelectedRucState(ruc);

    if (ruc) {
      localStorage.setItem(SELECTED_RUC_KEY, ruc);
    } else {
      localStorage.removeItem(SELECTED_RUC_KEY);
    }

    // Reload data for the new RUC
    await dataLayer.loadAllData(ruc || undefined);
  };

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      login,
      logout,
      signup,
      refreshSession,
      selectedRuc,
      availableRucs,
      setSelectedRuc,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useSupabaseAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useSupabaseAuth must be used within SupabaseAuthProvider");
  }
  return context;
}

// ============================================================================
// USER ROLE MANAGEMENT (for admin pages)
// ============================================================================

export async function updateUserRoles(
  userId: string,
  roles: Array<{ role_name: RoleName; scope_unit_id: string | null }>
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "Database not configured" };
  }

  try {
    const supabase = getSupabase();

    // Get all available roles
    const allRoles = await supabaseData.getRoles();
    const roleMap = new Map(allRoles.map(r => [r.name, r.id]));

    // Delete existing roles for user
    await supabase.from("user_roles").delete().eq("user_id", userId);

    // Insert new roles
    for (const role of roles) {
      const roleId = roleMap.get(role.role_name);
      if (roleId) {
        await supabaseData.addUserRole(userId, roleId, role.scope_unit_id || undefined);
      }
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to update user roles:", error);
    return { success: false, error: "Failed to update roles" };
  }
}

export async function updateUserApprovalPermission(
  userId: string,
  canApprove: boolean
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "Database not configured" };
  }

  try {
    const updated = await supabaseData.updateUser(userId, {
      can_approve_non_availability: canApprove,
    });

    if (!updated) {
      return { success: false, error: "Failed to update user" };
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to update approval permission:", error);
    return { success: false, error: "Failed to update permission" };
  }
}

export async function deleteUserAccount(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "Database not configured" };
  }

  try {
    const deleted = await supabaseData.deleteUser(userId);
    if (!deleted) {
      return { success: false, error: "Failed to delete user" };
    }
    return { success: true };
  } catch (error) {
    console.error("Failed to delete user:", error);
    return { success: false, error: "Failed to delete user" };
  }
}

// ============================================================================
// ALIASES FOR BACKWARD COMPATIBILITY
// These allow the rest of the app to import { AuthProvider, useAuth } from this file
// ============================================================================

export const AuthProvider = SupabaseAuthProvider;
export const useAuth = useSupabaseAuth;

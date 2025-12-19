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
}

interface AuthContextType {
  user: SessionUser | null;
  isLoading: boolean;
  login: (edipi: string, password: string) => Promise<boolean>;
  logout: () => void;
  signup: (edipi: string, email: string, password: string) => Promise<SignupResult>;
  refreshSession: () => Promise<void>;
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
 * Fetch personnel and unit info for a user, linking by EDIPI if needed.
 * This handles the case where personnel were imported after user was created.
 */
async function fetchPersonnelAndUnit(
  dbUser: User,
  logPrefix: string = "[Auth]"
): Promise<{ personnel: Personnel | null; unit: Unit | null }> {
  let personnel: Personnel | null = null;
  let unit: Unit | null = null;

  if (dbUser.personnel_id) {
    console.log(`${logPrefix} User has personnel_id:`, dbUser.personnel_id);
    personnel = await supabaseData.getPersonnelById(dbUser.personnel_id);
    if (personnel) {
      unit = await supabaseData.getUnitById(personnel.unit_id);
    }
  } else {
    // Try to find personnel by service_id (EDIPI)
    console.log(`${logPrefix} Looking up personnel by EDIPI:`, dbUser.edipi);
    personnel = await supabaseData.getPersonnelByServiceId(dbUser.edipi);
    if (personnel) {
      console.log(`${logPrefix} Found personnel:`, personnel.rank, personnel.last_name, "- linking to user");
      unit = await supabaseData.getUnitById(personnel.unit_id);
      // Link personnel to user for future sessions
      await supabaseData.updateUser(dbUser.id, { personnel_id: personnel.id });
    } else {
      console.log(`${logPrefix} No personnel found with EDIPI:`, dbUser.edipi);
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

export function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
            const { personnel, unit } = await fetchPersonnelAndUnit(dbUser, "[Auth] Session restore -");

            // Rebuild session with fresh data
            const refreshedUser = await buildSessionUser(dbUser, personnel, unit);
            setUser(refreshedUser);
            localStorage.setItem("dutysync_user", JSON.stringify(refreshedUser));

            // Load all data from Supabase into the data layer cache
            console.log("[Auth] Restoring session - loading data from Supabase...");
            await dataLayer.loadAllData();
            console.log("[Auth] Data loaded successfully");
          } else {
            // User no longer exists in database
            localStorage.removeItem("dutysync_user");
          }
        } catch (error) {
          console.error("Failed to restore session:", error);
          localStorage.removeItem("dutysync_user");
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

      // Load all data from Supabase into the data layer cache
      console.log("[Auth] Loading data from Supabase...");
      await dataLayer.loadAllData();
      console.log("[Auth] Data loaded successfully");

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

      // Add default Standard User role
      const standardRole = await supabaseData.getRoleByName(ROLE_NAMES.STANDARD_USER);
      if (standardRole) {
        await supabaseData.addUserRole(newUser.id, standardRole.id);
      }

      return { success: true };
    } catch (error) {
      console.error("Signup failed:", error);
      return { success: false, error: "An unexpected error occurred" };
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("dutysync_user");

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
      const { personnel, unit } = await fetchPersonnelAndUnit(dbUser, "[Auth] Refresh -");

      const refreshedUser = await buildSessionUser(dbUser, personnel, unit);
      setUser(refreshedUser);
      localStorage.setItem("dutysync_user", JSON.stringify(refreshedUser));
    } catch (error) {
      console.error("Failed to refresh session:", error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, signup, refreshSession }}>
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

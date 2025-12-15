"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import type { SessionUser, UserRole, RoleName } from "@/types";
import {
  getPersonnelByEdipi,
  getPersonnelById,
  getUnitSectionById,
  loadSeedDataIfNeeded,
  loadSeedUsers,
  getSeedUserByEdipi,
  seedUserExists,
  encryptEdipi,
} from "@/lib/client-stores";
import { startSyncPolling, stopSyncPolling } from "@/lib/sync-service";

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
  refreshSession: () => void; // Refresh current user's session from seed data
}

const AuthContext = createContext<AuthContextType | null>(null);

// Role name constants to avoid hardcoded strings
const ROLE_NAMES = {
  APP_ADMIN: "App Admin" as RoleName,
  UNIT_ADMIN: "Unit Admin" as RoleName,
  STANDARD_USER: "Standard User" as RoleName,
};

// App Admin EDIPI from environment variable (set in GitHub Secrets)
const APP_ADMIN_EDIPI = process.env.NEXT_PUBLIC_APP_ADMIN || "";

// GitHub API configuration for workflow trigger
const GITHUB_OWNER = process.env.NEXT_PUBLIC_GITHUB_OWNER || "";
const GITHUB_REPO = process.env.NEXT_PUBLIC_GITHUB_REPO || "";
const GITHUB_TOKEN = process.env.NEXT_PUBLIC_GITHUB_TOKEN || "";

// Trigger GitHub workflow to update user roles and permissions
export async function triggerUpdateRolesWorkflow(
  userId: string,
  roles: Array<{ role_name: string; scope_unit_id: string | null }>,
  canApproveNonAvailability?: boolean
): Promise<{ success: boolean; error?: string }> {
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return { success: false, error: "GitHub API not configured" };
  }

  try {
    const inputs: Record<string, string> = {
      user_id: userId,
      roles_json: JSON.stringify(roles),
    };

    // Only include can_approve_non_availability if explicitly set
    if (canApproveNonAvailability !== undefined) {
      inputs.can_approve_non_availability = canApproveNonAvailability ? "true" : "false";
    }

    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/update-user-roles.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          ref: "main",
          inputs,
        }),
      }
    );

    if (response.status === 204) {
      return { success: true };
    }

    const errorText = await response.text();
    console.error("GitHub API error:", response.status, errorText);
    return {
      success: false,
      error: `GitHub API error: ${response.status}`,
    };
  } catch (error) {
    console.error("Failed to trigger workflow:", error);
    return {
      success: false,
      error: "Failed to connect to GitHub API",
    };
  }
}

// Trigger GitHub workflow to delete user
export async function triggerDeleteUserWorkflow(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return { success: false, error: "GitHub API not configured" };
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/delete-user.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          ref: "main",
          inputs: {
            user_id: userId,
          },
        }),
      }
    );

    if (response.status === 204) {
      return { success: true };
    }

    const errorText = await response.text();
    console.error("GitHub API error:", response.status, errorText);
    return {
      success: false,
      error: `GitHub API error: ${response.status}`,
    };
  } catch (error) {
    console.error("Failed to trigger delete workflow:", error);
    return {
      success: false,
      error: "Failed to connect to GitHub API",
    };
  }
}

// Trigger GitHub workflow to create user
async function triggerCreateUserWorkflow(
  edipiEncrypted: string,
  email: string,
  passwordHash: string,
  personnelId: string | null
): Promise<{ success: boolean; error?: string }> {
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return { success: false, error: "GitHub API not configured" };
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/create-user.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          ref: "main",
          inputs: {
            edipi_encrypted: edipiEncrypted,
            email: email,
            password_hash: passwordHash,
            personnel_id: personnelId || "",
          },
        }),
      }
    );

    if (response.status === 204) {
      return { success: true };
    }

    // Try to get error message from response
    const errorText = await response.text();
    console.error("GitHub API error:", response.status, errorText);
    return {
      success: false,
      error: `GitHub API error: ${response.status}`,
    };
  } catch (error) {
    console.error("Failed to trigger workflow:", error);
    return {
      success: false,
      error: "Failed to connect to GitHub API",
    };
  }
}

// Check if a user's service ID matches the App Admin EDIPI
function isAppAdmin(serviceId: string | null | undefined): boolean {
  if (!serviceId || !APP_ADMIN_EDIPI) return false;
  return serviceId === APP_ADMIN_EDIPI;
}

// Stored role structure from localStorage
interface StoredRole {
  id?: string;
  role_name: RoleName;
  scope_unit_id?: string | null;
  created_at?: string | Date;
}

// Create a UserRole with consistent ID format
function createRole(
  userId: string,
  roleName: RoleName,
  scopeUnitId: string | null = null,
  existingId?: string,
  existingCreatedAt?: string | Date
): UserRole {
  return {
    id: existingId || `role-${userId}-${roleName}-${scopeUnitId || "global"}`,
    user_id: userId,
    role_name: roleName,
    scope_unit_id: scopeUnitId,
    created_at: existingCreatedAt ? new Date(existingCreatedAt) : new Date(),
  };
}

// Seed user type from getSeedUserByEdipi
type SeedUser = NonNullable<ReturnType<typeof getSeedUserByEdipi>>;

// Build user roles from seed user data - reusable helper to avoid duplication
function buildUserRoles(seedUser: SeedUser): UserRole[] {
  const roles: UserRole[] = [];
  const userIsAppAdminByEdipi = isAppAdmin(seedUser.edipi);

  if (userIsAppAdminByEdipi) {
    roles.push(createRole(seedUser.id, ROLE_NAMES.APP_ADMIN));
  }

  if (seedUser.roles && Array.isArray(seedUser.roles)) {
    seedUser.roles.forEach((role) => {
      const isStoredAppAdminRole = role.role_name === ROLE_NAMES.APP_ADMIN;
      if (isStoredAppAdminRole && userIsAppAdminByEdipi) {
        return; // Skip duplicate
      }
      roles.push(createRole(
        seedUser.id,
        role.role_name as RoleName,
        role.scope_unit_id || null,
        role.id,
        role.created_at
      ));
    });
  }

  if (roles.length === 0) {
    roles.push(createRole(seedUser.id, ROLE_NAMES.STANDARD_USER));
  }

  return roles;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initializeApp = async () => {
      // Load seed data from JSON files if this is a fresh install
      await loadSeedDataIfNeeded();

      // Load seed users from JSON files
      await loadSeedUsers();

      // Check for existing session in localStorage
      const stored = localStorage.getItem("dutysync_user");
      if (stored) {
        try {
          const sessionUser: SessionUser = JSON.parse(stored);

          // Force reload seed users to pick up any role changes since last login
          await loadSeedUsers(true);

          // Refresh roles and personnel info from seed data to pick up any changes
          const seedUser = getSeedUserByEdipi(sessionUser.edipi);
          if (seedUser) {
            // Update session with refreshed roles using shared helper
            sessionUser.roles = buildUserRoles(seedUser);
            sessionUser.can_approve_non_availability = seedUser.can_approve_non_availability || false;

            // Also refresh personnel info (displayName, rank, etc.) in case it was missing
            // This handles sessions created before these fields were added
            let personnel = getPersonnelByEdipi(seedUser.edipi);
            if (!personnel && seedUser.personnel_id) {
              personnel = getPersonnelById(seedUser.personnel_id);
            }

            if (personnel) {
              sessionUser.personnel_id = personnel.id;
              sessionUser.rank = personnel.rank;
              sessionUser.firstName = personnel.first_name;
              sessionUser.lastName = personnel.last_name;
              sessionUser.displayName = `${personnel.rank} ${personnel.last_name}`;
              sessionUser.unitId = personnel.unit_section_id;
              const unit = getUnitSectionById(sessionUser.unitId);
              sessionUser.unitName = unit?.unit_name;
            }

            // Save refreshed session back to localStorage
            localStorage.setItem("dutysync_user", JSON.stringify(sessionUser));
          }

          setUser(sessionUser);
        } catch (error) {
          console.error("Failed to parse user session from localStorage:", error);
          localStorage.removeItem("dutysync_user");
        }
      }
      setIsLoading(false);

      // Start sync polling for cross-device updates
      startSyncPolling();
    };

    initializeApp();

    // Cleanup sync polling on unmount
    return () => {
      stopSyncPolling();
    };
  }, []);

  const login = async (edipi: string, password: string): Promise<boolean> => {
    try {
      // Verify against seed users (loaded from public/data/user/)
      const found = getSeedUserByEdipi(edipi);

      if (!found) {
        // User not found in seed data
        return false;
      }

      // Verify password if password_hash exists in seed data
      // SECURITY WARNING: btoa() is NOT cryptographically secure - it's just base64 encoding.
      // This MVP approach is ONLY acceptable because:
      // 1. This is a demo/prototype with no real user data
      // 2. There is no backend server to handle proper password hashing
      // PRODUCTION REQUIREMENT: Use bcrypt/argon2 with a secure backend API
      if (found.password_hash) {
        const inputHash = btoa(password);
        if (inputHash !== found.password_hash) {
          return false; // Password mismatch
        }
      }
      // If no password_hash in seed data, allow login (demo mode)

      // Build user roles using shared helper
      const roles = buildUserRoles(found);

      // Look up personnel record by EDIPI for display info
      // Fall back to personnel_id if EDIPI lookup fails
      let personnel = getPersonnelByEdipi(found.edipi);
      if (!personnel && found.personnel_id) {
        personnel = getPersonnelById(found.personnel_id);
      }

      let displayName: string | undefined;
      let rank: string | undefined;
      let firstName: string | undefined;
      let lastName: string | undefined;
      let unitId: string | undefined;
      let unitName: string | undefined;

      if (personnel) {
        rank = personnel.rank;
        firstName = personnel.first_name;
        lastName = personnel.last_name;
        displayName = `${rank} ${lastName}`;
        unitId = personnel.unit_section_id;
        const unit = getUnitSectionById(unitId);
        unitName = unit?.unit_name;
      }

      const sessionUser: SessionUser = {
        id: found.id,
        edipi: found.edipi,
        email: found.email,
        personnel_id: personnel?.id || found.personnel_id || null,
        roles,
        can_approve_non_availability: found.can_approve_non_availability || false,
        displayName,
        rank,
        firstName,
        lastName,
        unitId,
        unitName,
      };
      setUser(sessionUser);
      // Session is stored in localStorage (just for current browser session)
      localStorage.setItem("dutysync_user", JSON.stringify(sessionUser));
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
    try {
      // Validate EDIPI format
      if (!/^[0-9]{10}$/.test(edipi)) {
        return { success: false, error: "EDIPI must be exactly 10 digits" };
      }

      // Check if EDIPI already registered in seed data
      if (seedUserExists(edipi)) {
        return { success: false, error: "EDIPI already registered" };
      }

      // Look up personnel record by EDIPI to link user to their personnel data
      const personnel = getPersonnelByEdipi(edipi);

      // Generate encrypted values for the workflow
      const edipiEncrypted = encryptEdipi(edipi);
      // SECURITY WARNING: btoa() is NOT cryptographically secure - it's just base64 encoding.
      // PRODUCTION REQUIREMENT: Use bcrypt/argon2 with a secure backend API
      const passwordHash = btoa(password);

      // Trigger GitHub workflow to create user
      const workflowResult = await triggerCreateUserWorkflow(
        edipiEncrypted,
        email,
        passwordHash,
        personnel?.id || null
      );

      if (workflowResult.success) {
        return { success: true };
      }

      // Return error if workflow failed
      return {
        success: false,
        error: workflowResult.error || "Failed to create account",
      };
    } catch (error) {
      console.error("Signup failed:", error);
      return { success: false, error: "An unexpected error occurred" };
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("dutysync_user");
  };

  // Refresh current user's session from seed data (call after role changes)
  const refreshSession = () => {
    if (!user) return;

    const seedUser = getSeedUserByEdipi(user.edipi);
    if (seedUser) {
      const updatedUser: SessionUser = {
        ...user,
        roles: buildUserRoles(seedUser),
        can_approve_non_availability: seedUser.can_approve_non_availability || false,
      };

      // Also refresh personnel info (displayName, rank, etc.)
      let personnel = getPersonnelByEdipi(seedUser.edipi);
      if (!personnel && seedUser.personnel_id) {
        personnel = getPersonnelById(seedUser.personnel_id);
      }

      if (personnel) {
        updatedUser.personnel_id = personnel.id;
        updatedUser.rank = personnel.rank;
        updatedUser.firstName = personnel.first_name;
        updatedUser.lastName = personnel.last_name;
        updatedUser.displayName = `${personnel.rank} ${personnel.last_name}`;
        updatedUser.unitId = personnel.unit_section_id;
        const unit = getUnitSectionById(updatedUser.unitId);
        updatedUser.unitName = unit?.unit_name;
      }

      setUser(updatedUser);
      localStorage.setItem("dutysync_user", JSON.stringify(updatedUser));
      console.log("[refreshSession] Session refreshed with updated roles and personnel info");
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, signup, refreshSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

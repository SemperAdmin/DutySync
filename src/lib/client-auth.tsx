"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import type { SessionUser, UserRole, RoleName } from "@/types";
import { getPersonnelByEdipi, getUnitSectionById, loadSeedDataIfNeeded, loadSeedUsers } from "@/lib/client-stores";

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
          setUser(JSON.parse(stored));
        } catch (error) {
          console.error("Failed to parse user session from localStorage:", error);
          localStorage.removeItem("dutysync_user");
        }
      }
      setIsLoading(false);
    };

    initializeApp();
  }, []);

  const login = async (edipi: string, password: string): Promise<boolean> => {
    try {
      // Check for registered users in localStorage
      const users = JSON.parse(localStorage.getItem("dutysync_users") || "[]");
      const found = users.find(
        (u: { edipi: string; password: string }) =>
          u.edipi === edipi && u.password === password
      );

      if (found) {
        // Determine roles based on EDIPI match
        const roles: UserRole[] = [];
        const userIsAppAdminByEdipi = isAppAdmin(found.edipi);

        // Check if user's service ID matches App Admin EDIPI
        if (userIsAppAdminByEdipi) {
          roles.push(createRole(found.id, ROLE_NAMES.APP_ADMIN));
        }

        // Also check for any stored roles (like Unit Admin assignments)
        if (found.roles && Array.isArray(found.roles)) {
          found.roles.forEach((role: StoredRole) => {
            // Skip App Admin role if user already has it via EDIPI match
            const isStoredAppAdminRole = role.role_name === ROLE_NAMES.APP_ADMIN;
            if (isStoredAppAdminRole && userIsAppAdminByEdipi) {
              return; // Skip to avoid duplicate
            }

            // Preserve existing role with its original ID and created_at
            roles.push(createRole(
              found.id,
              role.role_name,
              role.scope_unit_id || null,
              role.id,
              role.created_at
            ));
          });
        }

        // If no roles assigned, give Standard User
        if (roles.length === 0) {
          roles.push(createRole(found.id, ROLE_NAMES.STANDARD_USER));
        }

        // Look up personnel record by EDIPI for display info
        const personnel = getPersonnelByEdipi(found.edipi);
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
          displayName,
          rank,
          firstName,
          lastName,
          unitId,
          unitName,
        };
        setUser(sessionUser);
        localStorage.setItem("dutysync_user", JSON.stringify(sessionUser));
        return true;
      }

      return false;
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
      const users = JSON.parse(localStorage.getItem("dutysync_users") || "[]");

      // Validate EDIPI format
      if (!/^[0-9]{10}$/.test(edipi)) {
        return { success: false, error: "EDIPI must be exactly 10 digits" };
      }

      // Check if user exists
      if (users.some((u: { edipi: string }) => u.edipi === edipi)) {
        return { success: false, error: "EDIPI already registered" };
      }

      if (users.some((u: { email: string }) => u.email === email)) {
        return { success: false, error: "Email already registered" };
      }

      const newUser = {
        id: `user-${Date.now()}`,
        edipi,
        email,
        password,
        roles: [{ role_name: ROLE_NAMES.STANDARD_USER, scope_unit_id: null, created_at: new Date().toISOString() }],
        created_at: new Date().toISOString(),
      };

      users.push(newUser);
      localStorage.setItem("dutysync_users", JSON.stringify(users));

      return { success: true };
    } catch (error) {
      console.error("Signup failed:", error);
      return { success: false, error: "An unexpected error occurred" };
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("dutysync_user");
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, signup }}>
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

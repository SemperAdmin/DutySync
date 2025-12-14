"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import type { SessionUser, UserRole, RoleName } from "@/types";
import {
  getPersonnelByEdipi,
  getUnitSectionById,
  loadSeedDataIfNeeded,
  loadSeedUsers,
  getSeedUserByEdipi,
  seedUserExists,
  encryptEdipi,
  downloadAsJson,
} from "@/lib/client-stores";

interface SignupResult {
  success: boolean;
  error?: string;
  downloadedFiles?: string[]; // List of files that were downloaded
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
      // Verify against seed users (loaded from public/data/user/)
      const found = getSeedUserByEdipi(edipi);

      if (!found) {
        // User not found in seed data
        return false;
      }

      // Verify password if password_hash exists in seed data
      // For MVP: use simple base64 encoded password comparison
      // In production, use proper bcrypt/argon2 with a backend
      if (found.password_hash) {
        const inputHash = btoa(password); // Simple encoding for MVP
        if (inputHash !== found.password_hash) {
          return false; // Password mismatch
        }
      }
      // If no password_hash in seed data, allow login (demo mode)

      // Determine roles based on EDIPI match
      const roles: UserRole[] = [];
      const userIsAppAdminByEdipi = isAppAdmin(found.edipi);

      // Check if user's service ID matches App Admin EDIPI
      if (userIsAppAdminByEdipi) {
        roles.push(createRole(found.id, ROLE_NAMES.APP_ADMIN));
      }

      // Also check for any stored roles (like Unit Admin assignments)
      if (found.roles && Array.isArray(found.roles)) {
        found.roles.forEach((role) => {
          // Skip App Admin role if user already has it via EDIPI match
          const isStoredAppAdminRole = role.role_name === ROLE_NAMES.APP_ADMIN;
          if (isStoredAppAdminRole && userIsAppAdminByEdipi) {
            return; // Skip to avoid duplicate
          }

          // Preserve existing role with its original ID and created_at
          roles.push(createRole(
            found.id,
            role.role_name as RoleName,
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
      const passwordHash = btoa(password); // Simple base64 encoding for MVP

      // Create user data for download
      const userId = `user-${Date.now()}`;
      const createdAt = new Date().toISOString();

      const userSeedData = {
        id: userId,
        edipi_encrypted: edipiEncrypted,
        email,
        personnel_id: personnel?.id || null,
        password_hash: passwordHash,
        roles: [
          {
            id: `role-${userId}-standard`,
            role_name: ROLE_NAMES.STANDARD_USER,
            scope_unit_id: null,
            created_at: createdAt,
          },
        ],
        created_at: createdAt,
      };

      // Download the user file
      downloadAsJson(userSeedData, `${edipiEncrypted}.json`);

      // Create users-index entry for reference
      const indexEntry = {
        note: "Add this entry to users array in public/data/users-index.json",
        entry: {
          edipi_encrypted: edipiEncrypted,
          email,
        },
      };
      downloadAsJson(indexEntry, `${edipiEncrypted}-index-entry.json`);

      return {
        success: true,
        downloadedFiles: [`${edipiEncrypted}.json`, `${edipiEncrypted}-index-entry.json`],
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

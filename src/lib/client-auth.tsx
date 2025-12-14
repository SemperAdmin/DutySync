"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import type { SessionUser, UserRole, RoleName } from "@/types";

interface SignupResult {
  success: boolean;
  error?: string;
}

interface AuthContextType {
  user: SessionUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  signup: (username: string, email: string, password: string, serviceId?: string) => Promise<SignupResult>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// App Admin EDIPI from environment variable (set in GitHub Secrets)
const APP_ADMIN_EDIPI = process.env.NEXT_PUBLIC_APP_ADMIN || "";

// Check if a user's service ID matches the App Admin EDIPI
function isAppAdmin(serviceId: string | null | undefined): boolean {
  if (!serviceId || !APP_ADMIN_EDIPI) return false;
  return serviceId === APP_ADMIN_EDIPI;
}

// Create App Admin role
function createAppAdminRole(userId: string): UserRole {
  return {
    id: `role-admin-${userId}`,
    user_id: userId,
    role_name: "App Admin",
    scope_unit_id: null,
    created_at: new Date(),
  };
}

// Create Standard User role
function createStandardUserRole(userId: string): UserRole {
  return {
    id: `role-${userId}`,
    user_id: userId,
    role_name: "Standard User",
    scope_unit_id: null,
    created_at: new Date(),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for existing session in localStorage
    const stored = localStorage.getItem("dutysync_user");
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {
        localStorage.removeItem("dutysync_user");
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (username: string, password: string): Promise<boolean> => {
    // Check for registered users in localStorage
    const users = JSON.parse(localStorage.getItem("dutysync_users") || "[]");
    const found = users.find(
      (u: { username: string; password: string }) =>
        u.username === username && u.password === password
    );

    if (found) {
      // Determine roles based on EDIPI match
      const roles: UserRole[] = [];

      // Check if user's service ID matches App Admin EDIPI
      if (isAppAdmin(found.serviceId)) {
        roles.push(createAppAdminRole(found.id));
      }

      // Also check for any stored roles (like Unit Admin assignments)
      if (found.roles && Array.isArray(found.roles)) {
        found.roles.forEach((role: { role_name: RoleName; scope_unit_id?: string | null }) => {
          // Don't duplicate if already App Admin
          if (role.role_name !== "App Admin" || !isAppAdmin(found.serviceId)) {
            roles.push({
              id: `role-${found.id}-${role.role_name}`,
              user_id: found.id,
              role_name: role.role_name,
              scope_unit_id: role.scope_unit_id || null,
              created_at: new Date(),
            });
          }
        });
      }

      // If no roles assigned, give Standard User
      if (roles.length === 0) {
        roles.push(createStandardUserRole(found.id));
      }

      const sessionUser: SessionUser = {
        id: found.id,
        username: found.username,
        email: found.email,
        personnel_id: found.personnel_id || null,
        serviceId: found.serviceId || null,
        roles,
      };
      setUser(sessionUser);
      localStorage.setItem("dutysync_user", JSON.stringify(sessionUser));
      return true;
    }

    return false;
  };

  const signup = async (
    username: string,
    email: string,
    password: string,
    serviceId?: string
  ): Promise<SignupResult> => {
    const users = JSON.parse(localStorage.getItem("dutysync_users") || "[]");

    // Check if user exists
    if (users.some((u: { username: string }) => u.username === username)) {
      return { success: false, error: "Username already exists" };
    }

    if (users.some((u: { email: string }) => u.email === email)) {
      return { success: false, error: "Email already registered" };
    }

    const newUser = {
      id: `user-${Date.now()}`,
      username,
      email,
      password,
      serviceId: serviceId || null,
      roles: [{ role_name: "Standard User", scope_unit_id: null }],
      created_at: new Date().toISOString(),
    };

    users.push(newUser);
    localStorage.setItem("dutysync_users", JSON.stringify(users));

    return { success: true };
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

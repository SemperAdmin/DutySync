"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import type { SessionUser, UserRole } from "@/types";

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

// Demo users stored in localStorage
const DEMO_ADMIN: SessionUser = {
  id: "admin-001",
  username: "admin",
  email: "admin@dutysync.mil",
  personnel_id: null,
  roles: [
    {
      id: "role-001",
      user_id: "admin-001",
      role_name: "App Admin",
      scope_unit_id: null,
      created_at: new Date(),
    },
  ],
};

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
    // Demo login - accept admin/admin123 or any registered user
    if (username === "admin" && password === "admin123") {
      setUser(DEMO_ADMIN);
      localStorage.setItem("dutysync_user", JSON.stringify(DEMO_ADMIN));
      return true;
    }

    // Check for registered users in localStorage
    const users = JSON.parse(localStorage.getItem("dutysync_users") || "[]");
    const found = users.find(
      (u: { username: string; password: string }) =>
        u.username === username && u.password === password
    );

    if (found) {
      const sessionUser: SessionUser = {
        id: found.id,
        username: found.username,
        email: found.email,
        personnel_id: null,
        roles: [
          {
            id: `role-${found.id}`,
            user_id: found.id,
            role_name: "Standard User",
            scope_unit_id: null,
            created_at: new Date(),
          },
        ],
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

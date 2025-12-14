import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import type { UserRole, SessionUser } from "@/types";

// Temporary in-memory store for MVP development
// In production, this will be replaced with Hasura/Neon PostgreSQL queries
interface StoredUser {
  id: string;
  edipi: string;
  email: string;
  password_hash: string;
  personnel_id: string | null;
  roles: UserRole[];
}

// In-memory user store (for development only)
// This will be replaced with database queries
export const userStore: Map<string, StoredUser> = new Map();

// Initialize with a default App Admin user
const initializeDefaultAdmin = async () => {
  if (userStore.size === 0) {
    const hashedPassword = await bcrypt.hash("admin123", 12);
    userStore.set("1234567890", {
      id: "00000000-0000-0000-0000-000000000001",
      edipi: "1234567890",
      email: "admin@dutysync.mil",
      password_hash: hashedPassword,
      personnel_id: null,
      roles: [
        {
          id: "00000000-0000-0000-0000-000000000001",
          user_id: "00000000-0000-0000-0000-000000000001",
          role_name: "App Admin",
          scope_unit_id: null,
          created_at: new Date(),
        },
      ],
    });
  }
};

// Initialize on module load
initializeDefaultAdmin();

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        edipi: { label: "EDIPI", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.edipi || !credentials?.password) {
          return null;
        }

        const edipi = credentials.edipi as string;
        const password = credentials.password as string;

        // Look up user (will be replaced with Hasura query)
        const user = userStore.get(edipi);

        if (!user) {
          return null;
        }

        // Verify password
        const isValid = await bcrypt.compare(password, user.password_hash);

        if (!isValid) {
          return null;
        }

        // Return user object for session
        return {
          id: user.id,
          name: user.edipi,
          email: user.email,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // On sign in, add user data to token
        const storedUser = userStore.get(user.name || "");
        if (storedUser) {
          token.id = storedUser.id;
          token.edipi = storedUser.edipi;
          token.personnel_id = storedUser.personnel_id;
          token.roles = storedUser.roles;
        }
      }
      return token;
    },
    async session({ session, token }) {
      // Add custom fields to session
      if (token && session.user) {
        // Extend the existing session user with custom fields
        // Use double casting to satisfy TypeScript
        const user = session.user as unknown as SessionUser;
        user.id = token.id as string;
        user.edipi = token.edipi as string;
        user.personnel_id = token.personnel_id as string | null;
        user.roles = token.roles as UserRole[];
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },
  secret: process.env.AUTH_SECRET || "development-secret-change-in-production",
});

// Helper function to hash passwords
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

// Helper function to verify passwords
export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

// Helper to check if user has specific role
export function hasRole(user: SessionUser | null, roleName: string): boolean {
  if (!user || !user.roles) return false;
  return user.roles.some((role) => role.role_name === roleName);
}

// Helper to check if user is App Admin
export function isAppAdmin(user: SessionUser | null): boolean {
  return hasRole(user, "App Admin");
}

// Helper to check if user is Unit Admin for a specific unit
export function isUnitAdmin(
  user: SessionUser | null,
  unitId?: string
): boolean {
  if (!user || !user.roles) return false;
  return user.roles.some(
    (role) =>
      role.role_name === "Unit Admin" &&
      (unitId === undefined || role.scope_unit_id === unitId)
  );
}

// Helper to get typed session user
export function getSessionUser(session: { user?: unknown } | null): SessionUser | null {
  if (!session?.user) return null;
  return session.user as SessionUser;
}

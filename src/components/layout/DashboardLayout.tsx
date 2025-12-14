"use client";

import { ReactNode, useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/client-auth";
import Logo from "@/components/ui/Logo";
import Button from "@/components/ui/Button";
import type { SessionUser, RoleName } from "@/types";

// Key for storing view mode preference
const VIEW_MODE_KEY = "dutysync_admin_view_mode";

interface DashboardLayoutProps {
  children: ReactNode;
  user: SessionUser | null;
}

// Define which roles can access each navigation item
// All users can access items with empty allowedRoles array
interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  allowedRoles?: RoleName[]; // If undefined/empty, all roles can access
}

// Helper to check if user has any of the specified roles
function hasAnyRole(user: SessionUser | null, roles: RoleName[]): boolean {
  if (!user?.roles) return false;
  return user.roles.some((userRole) =>
    roles.includes(userRole.role_name as RoleName)
  );
}

// Helper to check if user is any type of manager
function isManager(user: SessionUser | null): boolean {
  return hasAnyRole(user, [
    "Unit Manager",
    "Company Manager",
    "Platoon Manager",
    "Section Manager",
  ]);
}

// Admin roles that have full access
const ADMIN_ROLES: RoleName[] = ["App Admin", "Unit Admin"];

// All manager roles
const MANAGER_ROLES: RoleName[] = [
  "Unit Manager",
  "Company Manager",
  "Platoon Manager",
  "Section Manager",
];

// Roles that can access personnel/non-availability (admins + all managers)
const PERSONNEL_ACCESS_ROLES: RoleName[] = [...ADMIN_ROLES, ...MANAGER_ROLES];

export default function DashboardLayout({
  children,
  user,
}: DashboardLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isAdminView, setIsAdminView] = useState(true);

  // Load view mode preference from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    if (stored !== null) {
      setIsAdminView(stored === "admin");
    }
  }, []);

  // Save view mode preference when it changes
  const toggleViewMode = () => {
    const newMode = !isAdminView;
    setIsAdminView(newMode);
    localStorage.setItem(VIEW_MODE_KEY, newMode ? "admin" : "user");
  };

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  // Check actual admin status (not affected by view mode)
  const actuallyIsAdmin = hasAnyRole(user, ["App Admin"]);
  const isUnitAdmin = hasAnyRole(user, ["Unit Admin"]);

  // Effective admin status based on view mode (for filtering nav items)
  const isAdmin = actuallyIsAdmin && isAdminView;

  const navItems: NavItem[] = [
    {
      href: "/admin",
      label: "Dashboard",
      // All roles can access dashboard
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
          />
        </svg>
      ),
    },
    {
      href: "/admin/units",
      label: "Unit Sections",
      allowedRoles: ADMIN_ROLES,
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
          />
        </svg>
      ),
    },
    {
      href: "/admin/users",
      label: "User Management",
      allowedRoles: ADMIN_ROLES,
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
      ),
    },
    {
      href: "/admin/personnel",
      label: "Personnel",
      allowedRoles: PERSONNEL_ACCESS_ROLES,
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
      ),
    },
    {
      href: "/admin/duty-types",
      label: "Duty Types",
      allowedRoles: ADMIN_ROLES,
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
          />
        </svg>
      ),
    },
    {
      href: "/admin/scheduler",
      label: "Scheduler",
      allowedRoles: ADMIN_ROLES,
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
      ),
    },
    {
      href: "/admin/non-availability",
      label: "Non-Availability",
      allowedRoles: PERSONNEL_ACCESS_ROLES,
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
          />
        </svg>
      ),
    },
    {
      href: "/roster",
      label: "Duty Roster",
      // All roles can access duty roster
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      ),
    },
    {
      href: "/profile",
      label: "My Profile",
      // All roles can access profile
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
          />
        </svg>
      ),
    },
  ];

  // Filter nav items based on user roles and view mode
  const filteredNavItems = navItems.filter((item) => {
    // If no allowedRoles specified, all users can access
    if (!item.allowedRoles || item.allowedRoles.length === 0) {
      return true;
    }
    // If App Admin in user view mode, only show items accessible to Standard User
    if (actuallyIsAdmin && !isAdminView) {
      // In user view, hide admin-only items
      return false;
    }
    // Check if user has any of the allowed roles
    return hasAnyRole(user, item.allowedRoles);
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-surface border-r border-border transform transition-transform duration-200 lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="p-4 border-b border-border">
            <Link href="/" className="block">
              <Logo size="sm" />
            </Link>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            {filteredNavItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                    isActive
                      ? "bg-primary text-white"
                      : "text-foreground-muted hover:bg-surface-elevated hover:text-foreground"
                  }`}
                  onClick={() => setSidebarOpen(false)}
                >
                  {item.icon}
                  <span className="font-medium">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* User info & logout */}
          <div className="p-4 border-t border-border">
            <div className="mb-3">
              <p className="text-sm font-medium text-foreground truncate">
                {user?.displayName || user?.edipi || user?.email}
              </p>
              <p className="text-xs text-foreground-muted">
                {user?.roles?.[0]?.role_name || "Standard User"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={handleLogout}
            >
              <svg
                className="w-4 h-4 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
              Sign Out
            </Button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-sm border-b border-border">
          <div className="flex items-center justify-between px-4 h-16">
            {/* Mobile menu button */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg hover:bg-surface-elevated"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>

            {/* Right side actions - show role badge and view toggle */}
            <div className="flex items-center gap-3 ml-auto">
              {/* View mode toggle for App Admins */}
              {actuallyIsAdmin && (
                <button
                  onClick={toggleViewMode}
                  className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                    isAdminView
                      ? "bg-highlight/20 text-highlight border-highlight/30 hover:bg-highlight/30"
                      : "bg-foreground-muted/20 text-foreground-muted border-foreground-muted/30 hover:bg-foreground-muted/30"
                  }`}
                  title={isAdminView ? "Switch to User View" : "Switch to Admin View"}
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    {isAdminView ? (
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                      />
                    ) : (
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    )}
                  </svg>
                  {isAdminView ? "Admin View" : "User View"}
                </button>
              )}
              {/* Role badge for non-admins */}
              {!actuallyIsAdmin && isUnitAdmin && (
                <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-primary/20 text-blue-400">
                  Unit Admin
                </span>
              )}
              {!actuallyIsAdmin && !isUnitAdmin && isManager(user) && (
                <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-success/20 text-success">
                  Manager
                </span>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}

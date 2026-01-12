"use client";

import { ReactNode, useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth, type RucOption } from "@/lib/supabase-auth";
import Logo from "@/components/ui/Logo";
import Button from "@/components/ui/Button";
import {
  VIEW_MODE_KEY,
  VIEW_MODE_CHANGE_EVENT,
  VIEW_MODE_ADMIN,
  VIEW_MODE_UNIT_ADMIN,
  VIEW_MODE_USER,
  type ViewMode,
} from "@/lib/constants";
import AutoSaveStatus from "@/components/AutoSaveStatus";
import SyncIndicator from "@/components/ui/SyncIndicator";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import SessionTimeoutWarning from "@/components/SessionTimeoutWarning";
import type { SessionUser, RoleName } from "@/types";

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
    "Section Manager",
    "Work Section Manager",
  ]);
}

// Admin roles that have full access
const ADMIN_ROLES: RoleName[] = ["App Admin", "Unit Admin"];

// All manager roles
const MANAGER_ROLES: RoleName[] = [
  "Unit Manager",
  "Company Manager",
  "Section Manager",
  "Work Section Manager",
];

// Roles that can access personnel/non-availability (admins + all managers)
const PERSONNEL_ACCESS_ROLES: RoleName[] = [...ADMIN_ROLES, ...MANAGER_ROLES];

export default function DashboardLayout({
  children,
  user,
}: DashboardLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout, selectedRuc, availableRucs, setSelectedRuc } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(VIEW_MODE_USER);
  const [isChangingRuc, setIsChangingRuc] = useState(false);

  // Check actual admin status (not affected by view mode)
  const actuallyIsAppAdmin = hasAnyRole(user, ["App Admin"]);
  const actuallyIsUnitAdmin = hasAnyRole(user, ["Unit Admin"]);
  const hasAnyAdminRole = actuallyIsAppAdmin || actuallyIsUnitAdmin;

  // Determine default view mode based on roles
  const getDefaultViewMode = (): ViewMode => {
    if (actuallyIsAppAdmin) return VIEW_MODE_ADMIN;
    if (actuallyIsUnitAdmin) return VIEW_MODE_UNIT_ADMIN;
    return VIEW_MODE_USER;
  };

  // Load view mode preference from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(VIEW_MODE_KEY) as ViewMode | null;
    if (stored && [VIEW_MODE_ADMIN, VIEW_MODE_UNIT_ADMIN, VIEW_MODE_USER].includes(stored)) {
      // Validate that user can use this view mode
      if (stored === VIEW_MODE_ADMIN && !actuallyIsAppAdmin) {
        setViewMode(getDefaultViewMode());
      } else if (stored === VIEW_MODE_UNIT_ADMIN && !actuallyIsUnitAdmin) {
        setViewMode(getDefaultViewMode());
      } else {
        setViewMode(stored);
      }
    } else {
      setViewMode(getDefaultViewMode());
    }
  }, [actuallyIsAppAdmin, actuallyIsUnitAdmin]);

  // Change view mode and redirect to appropriate dashboard
  const changeViewMode = (newMode: ViewMode) => {
    setViewMode(newMode);
    localStorage.setItem(VIEW_MODE_KEY, newMode);
    // Dispatch custom event for same-tab communication
    window.dispatchEvent(new CustomEvent(VIEW_MODE_CHANGE_EVENT));

    // Redirect to appropriate dashboard based on new role
    if (newMode === VIEW_MODE_ADMIN || newMode === VIEW_MODE_UNIT_ADMIN) {
      router.push("/admin");
    } else {
      router.push("/profile");
    }
  };

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  // Effective status based on view mode
  const isAdminView = viewMode === VIEW_MODE_ADMIN;
  const isUnitAdminView = viewMode === VIEW_MODE_UNIT_ADMIN;
  const isUserView = viewMode === VIEW_MODE_USER;

  // Check if user is a manager
  const actuallyIsManager = isManager(user);

  // Navigation items with view mode flags
  interface ExtendedNavItem extends NavItem {
    adminOnly?: boolean; // Only show in Admin View (App Admin only)
    unitAdminOnly?: boolean; // Show in Admin View OR Unit Admin View
    unitAdminViewOnly?: boolean; // Only show in Unit Admin View (NOT App Admin View)
    userOnly?: boolean; // Only show in User View (hide from Admin/Unit Admin View)
    userAndUnitAdminView?: boolean; // Show in User View AND Unit Admin View (NOT App Admin View)
    managerOnly?: boolean; // Only show for managers in User View
    managerOrUnitAdmin?: boolean; // Show for managers in User View OR Unit Admins in Unit Admin View
  }

  const navItems: ExtendedNavItem[] = [
    {
      href: "/admin",
      label: "Dashboard",
      // All roles can access dashboard (content changes based on role/view mode)
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
      href: "/admin/manager",
      label: "Manager Dashboard",
      managerOnly: true, // Only show for managers in User View
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
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
      ),
    },
    {
      href: "/admin/users",
      label: "User Management",
      allowedRoles: ADMIN_ROLES,
      unitAdminOnly: true, // Show in Admin View OR Unit Admin View
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
      href: "/admin/units",
      label: "Unit Management",
      allowedRoles: ADMIN_ROLES,
      unitAdminOnly: true, // Show in Admin View OR Unit Admin View
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
      href: "/admin/personnel",
      label: "Personnel",
      managerOrUnitAdmin: true, // Show for managers in User View OR Unit Admins in Unit Admin View
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
      allowedRoles: ["Unit Admin"],
      unitAdminViewOnly: true, // Only show in Unit Admin View (NOT App Admin View)
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
      href: "/admin/non-availability",
      label: "Non-Availability",
      // All users can access to submit their own requests
      userOnly: true, // Only show in User View
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
      href: "/admin/duty-swaps",
      label: "Duty Swaps",
      // Only show in User View (not for App Admin or Unit Admin)
      userOnly: true,
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
            d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
          />
        </svg>
      ),
    },
    {
      href: "/roster",
      label: "Duty Roster",
      userAndUnitAdminView: true, // Show in User View AND Unit Admin View (NOT App Admin View)
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
      href: "/admin/scheduler",
      label: "Scheduler",
      allowedRoles: ["Unit Admin"],
      unitAdminViewOnly: true, // Only show in Unit Admin View (NOT App Admin View)
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
    // If item is marked adminOnly, only show when App Admin is in Admin View
    if (item.adminOnly) {
      return actuallyIsAppAdmin && isAdminView;
    }

    // If item is marked unitAdminOnly, show in Admin View OR Unit Admin View
    if (item.unitAdminOnly) {
      // App Admin in Admin View
      if (actuallyIsAppAdmin && isAdminView) return true;
      // Unit Admin in Unit Admin View
      if (actuallyIsUnitAdmin && isUnitAdminView) return true;
      return false;
    }

    // If item is marked unitAdminViewOnly, ONLY show in Unit Admin View (not App Admin View)
    if (item.unitAdminViewOnly) {
      return actuallyIsUnitAdmin && isUnitAdminView;
    }

    // If item is marked userAndUnitAdminView, show in User View AND Unit Admin View (NOT App Admin View)
    if (item.userAndUnitAdminView) {
      // Hide from App Admin in Admin View
      if (actuallyIsAppAdmin && isAdminView) return false;
      // Show for Unit Admin in Unit Admin View
      if (actuallyIsUnitAdmin && isUnitAdminView) return true;
      // Show in User View for everyone
      return true;
    }

    // If item is marked userOnly, hide it when in Admin View or Unit Admin View
    if (item.userOnly) {
      if ((actuallyIsAppAdmin && isAdminView) || (actuallyIsUnitAdmin && isUnitAdminView)) {
        return false;
      }
    }

    // If item is marked managerOnly, only show for managers in User View (not in Admin/Unit Admin views)
    if (item.managerOnly) {
      // Must be a manager
      if (!actuallyIsManager) return false;
      // Hide from Admin View and Unit Admin View
      if ((actuallyIsAppAdmin && isAdminView) || (actuallyIsUnitAdmin && isUnitAdminView)) {
        return false;
      }
      return true;
    }

    // If item is marked managerOrUnitAdmin, show for managers in User View OR Unit Admins in Unit Admin View
    if (item.managerOrUnitAdmin) {
      // Show for Unit Admin in Unit Admin View
      if (actuallyIsUnitAdmin && isUnitAdminView) return true;
      // Show for managers in User View (not in Admin/Unit Admin views)
      if (actuallyIsManager && !isAdminView && !isUnitAdminView) return true;
      // Hide otherwise (regular users without manager role, or App Admins)
      return false;
    }

    // If no allowedRoles specified, all users can access
    if (!item.allowedRoles || item.allowedRoles.length === 0) {
      return true;
    }

    // In User View, check if user has the required roles (including manager roles)
    if (isUserView) {
      // For items that allow manager roles, check if user actually has those roles
      const hasManagerRole = item.allowedRoles.some(role => MANAGER_ROLES.includes(role));
      if (hasManagerRole && hasAnyRole(user, MANAGER_ROLES)) {
        return true;
      }
      // Also check if user has any of the allowed admin roles (they can still access in user view)
      if (hasAnyRole(user, item.allowedRoles.filter(r => !MANAGER_ROLES.includes(r)))) {
        return true;
      }
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
                {(() => {
                  if (!user?.roles || user.roles.length === 0) return "Standard User";
                  // Show all roles, prioritizing manager roles for clarity
                  const roleNames = user.roles
                    .map(r => r.role_name)
                    .filter(name => name !== "Standard User");
                  if (roleNames.length === 0) return "Standard User";
                  return roleNames.join(", ");
                })()}
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
              aria-label="Open navigation menu"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>

            {/* Right side actions - auto-save status, RUC selector, role badge and view toggle */}
            <div className="flex items-center gap-3 ml-auto">
              {/* Auto-save status indicator */}
              <AutoSaveStatus ruc={selectedRuc || "02301"} />

              {/* Sync indicator */}
              <SyncIndicator />

              {/* RUC Selector - show for Unit Admins with multiple RUCs when in Unit Admin view */}
              {availableRucs.length > 1 && (!actuallyIsAppAdmin || isUnitAdminView) && (
                <div className="relative">
                  <select
                    value={selectedRuc || ""}
                    onChange={async (e) => {
                      setIsChangingRuc(true);
                      await setSelectedRuc(e.target.value);
                      setIsChangingRuc(false);
                    }}
                    disabled={isChangingRuc}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                    title="Switch between your assigned RUCs"
                  >
                    {availableRucs.map((ruc) => (
                      <option key={ruc.ruc} value={ruc.ruc}>
                        {ruc.ruc}{ruc.name ? ` - ${ruc.name}` : ""}
                      </option>
                    ))}
                  </select>
                  {isChangingRuc && (
                    <div className="absolute inset-0 flex items-center justify-center bg-surface/50 rounded-lg">
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
              )}

              {/* View mode toggle for users with admin roles */}
              {hasAnyAdminRole && (
                <div className="flex items-center rounded-full border border-border overflow-hidden">
                  {/* Admin View - only for App Admins */}
                  {actuallyIsAppAdmin && (
                    <button
                      onClick={() => changeViewMode(VIEW_MODE_ADMIN)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                        isAdminView
                          ? "bg-highlight/20 text-highlight"
                          : "bg-surface text-foreground-muted hover:bg-surface-elevated"
                      }`}
                      title="App Admin View - Full access to all units"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      Admin
                    </button>
                  )}
                  {/* Unit Admin View - for Unit Admins */}
                  {actuallyIsUnitAdmin && (
                    <button
                      onClick={() => changeViewMode(VIEW_MODE_UNIT_ADMIN)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                        isUnitAdminView
                          ? "bg-primary/20 text-blue-400"
                          : "bg-surface text-foreground-muted hover:bg-surface-elevated"
                      }`}
                      title="Unit Admin View - Access to your unit"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                      Unit Admin
                    </button>
                  )}
                  {/* User View - always available */}
                  <button
                    onClick={() => changeViewMode(VIEW_MODE_USER)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                      isUserView
                        ? "bg-success/20 text-success"
                        : "bg-surface text-foreground-muted hover:bg-surface-elevated"
                    }`}
                    title="User View - Personal scope"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    User
                  </button>
                </div>
              )}
              {/* Role badge for users without admin roles */}
              {!hasAnyAdminRole && isManager(user) && (
                <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-success/20 text-success">
                  Manager
                </span>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main id="main-content" className="p-6" tabIndex={-1}>
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>
      </div>

      {/* Session timeout warning modal */}
      <SessionTimeoutWarning />
    </div>
  );
}

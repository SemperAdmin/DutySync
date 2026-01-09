// Shared constants used across the application

import type { RoleName } from "@/types";

// ============================================================================
// ROLE CONSTANTS
// ============================================================================

// Admin roles with elevated privileges
export const ADMIN_ROLES: RoleName[] = ["App Admin", "Unit Admin"];

// Manager roles (hierarchical)
export const MANAGER_ROLES: RoleName[] = [
  "Unit Manager",
  "Company Manager",
  "Section Manager",
  "Work Section Manager",
];

// Roles that can access personnel data
export const PERSONNEL_ACCESS_ROLES: RoleName[] = [...ADMIN_ROLES, ...MANAGER_ROLES];

// Organization-scoped roles (have scope_unit_id)
export const ORG_SCOPED_ROLES: RoleName[] = ["Unit Admin", ...MANAGER_ROLES];

// All role names
export const ALL_ROLES: RoleName[] = [
  "App Admin",
  "Unit Admin",
  "Unit Manager",
  "Company Manager",
  "Section Manager",
  "Work Section Manager",
  "Standard User",
];

// ============================================================================
// ROLE HELPER FUNCTIONS
// ============================================================================

import type { SessionUser, UserRole } from "@/types";

/**
 * Check if user has any of the specified roles
 */
export function hasAnyRole(user: SessionUser | null, roles: RoleName[]): boolean {
  if (!user?.roles) return false;
  return user.roles.some((userRole) => roles.includes(userRole.role_name as RoleName));
}

/**
 * Check if user is an App Admin
 */
export function isAppAdmin(user: SessionUser | null): boolean {
  return hasAnyRole(user, ["App Admin"]);
}

/**
 * Check if user is a Unit Admin
 */
export function isUnitAdmin(user: SessionUser | null): boolean {
  return hasAnyRole(user, ["Unit Admin"]);
}

/**
 * Check if user has any manager role
 */
export function isManager(user: SessionUser | null): boolean {
  return hasAnyRole(user, MANAGER_ROLES);
}

/**
 * Get user's scope unit ID from their roles
 */
export function getUserScopeUnitId(user: SessionUser | null): string | null {
  if (!user?.roles) return null;

  // Priority: Unit Admin scope, then Manager scope
  const unitAdminRole = user.roles.find(
    (r) => r.role_name === "Unit Admin" && r.scope_unit_id
  );
  if (unitAdminRole?.scope_unit_id) return unitAdminRole.scope_unit_id;

  const managerRole = user.roles.find(
    (r) => MANAGER_ROLES.includes(r.role_name as RoleName) && r.scope_unit_id
  );
  return managerRole?.scope_unit_id || null;
}

/**
 * Get color class for role badge
 */
export function getRoleColor(roleName: string): string {
  switch (roleName) {
    case "App Admin":
      return "bg-error/20 text-error border-error/30";
    case "Unit Admin":
      return "bg-warning/20 text-warning border-warning/30";
    case "Unit Manager":
      return "bg-primary/20 text-primary border-primary/30";
    case "Company Manager":
      return "bg-highlight/20 text-highlight border-highlight/30";
    case "Section Manager":
      return "bg-success/20 text-success border-success/30";
    case "Work Section Manager":
      return "bg-cyan-500/20 text-cyan-400 border-cyan-500/30";
    default:
      return "bg-surface-alt text-foreground-muted border-border";
  }
}

// ============================================================================
// VIEW MODE CONSTANTS
// ============================================================================

// Key for storing view mode preference in localStorage
export const VIEW_MODE_KEY = "dutysync_admin_view_mode";

// Custom event name for view mode changes (for same-tab communication)
export const VIEW_MODE_CHANGE_EVENT = "viewModeChange";

// View mode values
export type ViewMode = "admin" | "unit-admin" | "user";
export const VIEW_MODE_ADMIN: ViewMode = "admin";
export const VIEW_MODE_UNIT_ADMIN: ViewMode = "unit-admin";
export const VIEW_MODE_USER: ViewMode = "user";

// Maximum duty score for display calculations
export const MAX_DUTY_SCORE = 15;

// Default duty score multipliers
export const DEFAULT_WEEKEND_MULTIPLIER = 1.5;
export const DEFAULT_HOLIDAY_MULTIPLIER = 2.0;

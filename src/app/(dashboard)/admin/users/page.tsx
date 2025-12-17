"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Card, {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import type { UnitSection, RoleName, Personnel } from "@/types";
import {
  getAllUsers,
  getUnitSections,
  getAllPersonnel,
  assignUserRole,
  removeUserRole,
  deleteUser,
  getAllDescendantUnitIds,
  loadUsers,
  loadUnits,
  loadRucs,
  getAllRucs,
  getTopLevelUnitForOrganization,
  type RucEntry,
} from "@/lib/data-layer";
import { useAuth } from "@/lib/supabase-auth";

interface UserRole {
  id?: string;
  role_name: RoleName;
  scope_unit_id: string | null;
}

interface UserData {
  id: string;
  edipi: string;
  email: string;
  personnel_id: string | null;
  can_approve_non_availability: boolean;
  roles: UserRole[];
}

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserData[]>([]);
  const [units, setUnits] = useState<UnitSection[]>([]);
  const [rucs, setRucs] = useState<RucEntry[]>([]);
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);

  // Check if user is App Admin (can see all users) or Unit Admin (limited scope)
  const isAppAdmin = currentUser?.roles?.some(r => r.role_name === "App Admin") ?? false;
  const unitAdminRole = currentUser?.roles?.find(r => r.role_name === "Unit Admin");
  const unitAdminScopeId = unitAdminRole?.scope_unit_id ?? null;

  const fetchData = useCallback(async () => {
    try {
      // Reload users, units, and rucs from Supabase
      await Promise.all([loadUsers(), loadUnits(), loadRucs()]);

      const usersData = getAllUsers();
      const unitsData = getUnitSections();
      const rucsData = getAllRucs();
      const personnelData = getAllPersonnel();

      setUsers(usersData.map(u => ({
        id: u.id,
        edipi: u.edipi,
        email: u.email,
        personnel_id: u.personnel_id || null,
        can_approve_non_availability: false,
        roles: (u.roles || []).map(r => ({
          id: r.id,
          role_name: r.role_name as RoleName,
          scope_unit_id: r.scope_unit_id,
        })),
      })));
      setUnits(unitsData);
      setRucs(rucsData);
      setPersonnel(personnelData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Create a map of EDIPI to personnel for O(1) lookups
  const personnelByEdipi = useMemo(() => {
    const map = new Map<string, Personnel>();
    personnel.forEach(p => {
      // service_id is the EDIPI
      map.set(p.service_id, p);
    });
    return map;
  }, [personnel]);

  // Get all descendant unit IDs for the Unit Admin's scope (includes nested sub-units)
  const [scopeUnitIds, setScopeUnitIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    async function loadScopeUnitIds() {
      if (isAppAdmin || !unitAdminScopeId) {
        setScopeUnitIds(null);
        return;
      }
      // Get all descendant unit IDs recursively (includes the scope unit itself)
      const allDescendantIds = await getAllDescendantUnitIds(unitAdminScopeId);
      setScopeUnitIds(new Set<string>(allDescendantIds));
    }
    loadScopeUnitIds();
  }, [isAppAdmin, unitAdminScopeId]);

  // Filter users based on scope - Unit Admins only see users in their RUC/unit hierarchy
  const filteredUsers = useMemo(() => {
    if (isAppAdmin || !scopeUnitIds) {
      // App Admin sees all users
      return users;
    }
    // Unit Admin: filter to users whose linked personnel is in their scope
    return users.filter(user => {
      const person = personnelByEdipi.get(user.edipi);
      if (!person) {
        // User not linked to personnel - don't show to Unit Admins
        return false;
      }
      // Check if personnel's unit is within scope
      return scopeUnitIds.has(person.unit_section_id);
    });
  }, [users, isAppAdmin, scopeUnitIds, personnelByEdipi]);

  const getPersonnelInfo = (edipi: string) => {
    return personnelByEdipi.get(edipi);
  };

  const getRoleColor = (roleName: RoleName) => {
    switch (roleName) {
      case "App Admin":
        return "bg-highlight/20 text-highlight border-highlight/30";
      case "Unit Admin":
        return "bg-primary/20 text-blue-400 border-primary/30";
      case "Unit Manager":
      case "Company Manager":
      case "Section Manager":
      case "Work Section Manager":
        return "bg-success/20 text-success border-success/30";
      default:
        return "bg-foreground-muted/20 text-foreground-muted border-foreground-muted/30";
    }
  };

  // Check if user has any scoped role (manager or unit admin)
  const hasScopedRoles = (user: UserData) => {
    return user.roles.some(r => [
      "Unit Admin",
      "Unit Manager",
      "Company Manager",
      "Section Manager",
      "Work Section Manager"
    ].includes(r.role_name) && r.scope_unit_id);
  };

  // Build the full unit hierarchy path (e.g., "02301 > H Company > S1DV > MPHQ")
  const buildUnitPath = (unitId: string, allUnits: UnitSection[]): string => {
    const path: string[] = [];
    let currentUnit = allUnits.find(u => u.id === unitId);

    while (currentUnit) {
      path.unshift(currentUnit.unit_name);
      currentUnit = currentUnit.parent_id
        ? allUnits.find(u => u.id === currentUnit?.parent_id)
        : undefined;
    }

    return path.join(" > ");
  };

  // Note: Uses getUnitSections() directly to ensure we have latest data
  const getUnitName = (unitId: string | null) => {
    if (!unitId) return null;
    const allUnits = getUnitSections();
    return buildUnitPath(unitId, allUnits) || "Unknown Unit";
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">User Management</h1>
        <p className="text-foreground-muted mt-1">
          Manage user roles and permissions
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-lg bg-error/10 border border-error/20 text-error">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-error hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Role Assignment Modal */}
      {editingUser && (
        <RoleAssignmentModal
          user={editingUser}
          units={units}
          rucs={rucs}
          getUnitName={getUnitName}
          onClose={() => setEditingUser(null)}
          onSuccess={() => {
            setEditingUser(null);
            fetchData();
          }}
        />
      )}

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>Registered Users</CardTitle>
          <CardDescription>
            {filteredUsers.length} user{filteredUsers.length !== 1 ? "s" : ""} registered
            {!isAppAdmin && unitAdminScopeId && " (within your unit scope)"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredUsers.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-foreground-muted">No users found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      EDIPI
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Rank
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Name
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Email
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Roles
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Permissions
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => {
                    const personnelInfo = getPersonnelInfo(user.edipi);
                    return (
                      <tr
                        key={user.id}
                        className="border-b border-border hover:bg-surface-elevated"
                      >
                        <td className="py-3 px-4">
                          <span className="font-medium text-foreground font-mono">
                            {user.edipi}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-foreground-muted">
                          {personnelInfo?.rank || "-"}
                        </td>
                        <td className="py-3 px-4 text-foreground-muted">
                          {personnelInfo
                            ? `${personnelInfo.last_name}, ${personnelInfo.first_name}`
                            : "-"}
                        </td>
                        <td className="py-3 px-4 text-foreground-muted">
                          {user.email}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1">
                            {user.roles.map((role, idx) => (
                              <span
                                key={role.id || idx}
                                className={`px-2 py-0.5 text-xs font-medium rounded border ${getRoleColor(
                                  role.role_name
                                )}`}
                              >
                                {role.role_name}
                                {role.scope_unit_id && (
                                  <span className="ml-1 opacity-75">
                                    ({getUnitName(role.scope_unit_id)})
                                  </span>
                                )}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {hasScopedRoles(user) && user.can_approve_non_availability && (
                            <span className="px-2 py-0.5 text-xs font-medium rounded bg-warning/20 text-warning border border-warning/30">
                              Can Approve N/A
                            </span>
                          )}
                          {hasScopedRoles(user) && !user.can_approve_non_availability && (
                            <span className="text-foreground-muted text-xs">-</span>
                          )}
                          {!hasScopedRoles(user) && (
                            <span className="text-foreground-muted text-xs">N/A</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingUser(user)}
                          >
                            <svg
                              className="w-4 h-4 mr-1"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                              />
                            </svg>
                            Edit Roles
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RoleAssignmentModal({
  user,
  units,
  rucs,
  getUnitName,
  onClose,
  onSuccess,
}: {
  user: UserData;
  units: UnitSection[];
  rucs: RucEntry[];
  getUnitName: (unitId: string | null) => string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Manager role options
  const MANAGER_ROLES: RoleName[] = [
    "Unit Manager",
    "Company Manager",
    "Section Manager",
    "Work Section Manager",
  ];

  // Check if user is App Admin (cannot be changed via UI)
  const isAppAdmin = user.roles.some((r) => r.role_name === "App Admin");

  // Initialize state from user's current roles
  const currentUnitAdminRole = user.roles.find(r => r.role_name === "Unit Admin");
  const currentManagerRole = user.roles.find(r => MANAGER_ROLES.includes(r.role_name));

  // Convert unit ID to org ID for dropdown initialization
  // scope_unit_id is now a unit ID, but dropdown uses org IDs
  const getOrgIdFromUnitId = useCallback((unitId: string | null): string => {
    if (!unitId) return "";
    const unit = units.find(u => u.id === unitId);
    if (unit) {
      // Get organization_id from unit (added in data layer)
      const orgId = (unit as UnitSection & { organization_id?: string }).organization_id;
      if (orgId) return orgId;
    }
    // Fallback: return empty string if no mapping found
    return "";
  }, [units]);

  // Local state for the form
  const [isUnitAdmin, setIsUnitAdmin] = useState(!!currentUnitAdminRole);
  const [unitAdminScope, setUnitAdminScope] = useState(
    getOrgIdFromUnitId(currentUnitAdminRole?.scope_unit_id || null)
  );
  const [managerRole, setManagerRole] = useState<RoleName | "">(currentManagerRole?.role_name || "");
  const [managerScope, setManagerScope] = useState(currentManagerRole?.scope_unit_id || "");
  const [canApproveNA, setCanApproveNA] = useState(user.can_approve_non_availability);

  // Check if there are changes
  const hasChanges = useMemo(() => {
    // Check Unit Admin change
    const originalUnitAdmin = !!currentUnitAdminRole;
    // Convert unit ID to org ID for comparison
    const originalUnitAdminScope = getOrgIdFromUnitId(currentUnitAdminRole?.scope_unit_id || null);
    const unitAdminChanged = isUnitAdmin !== originalUnitAdmin ||
      (isUnitAdmin && unitAdminScope !== originalUnitAdminScope);

    // Check Manager role change
    const originalManagerRole = currentManagerRole?.role_name || "";
    const originalManagerScope = currentManagerRole?.scope_unit_id || "";
    const managerChanged = managerRole !== originalManagerRole ||
      (managerRole && managerScope !== originalManagerScope);

    // Check approval permission change
    const approvalChanged = canApproveNA !== user.can_approve_non_availability;

    return unitAdminChanged || managerChanged || approvalChanged;
  }, [isUnitAdmin, unitAdminScope, managerRole, managerScope, canApproveNA,
      currentUnitAdminRole, currentManagerRole, user.can_approve_non_availability, getOrgIdFromUnitId]);

  // Check if user has any scoped role that could have approval permissions
  const hasScopedRole = isUnitAdmin || !!managerRole;

  const handleSaveChanges = async () => {
    // Validation
    if (isUnitAdmin && !unitAdminScope) {
      setError("Please select a RUC scope for Unit Admin");
      return;
    }
    if (managerRole && !managerScope) {
      setError("Please select a RUC scope for the manager role");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      // Remove old Unit Admin role if it exists and changed
      if (currentUnitAdminRole) {
        await removeUserRole(user.id, "Unit Admin", currentUnitAdminRole.scope_unit_id);
      }

      // Remove old Manager role if it exists
      if (currentManagerRole) {
        await removeUserRole(user.id, currentManagerRole.role_name, currentManagerRole.scope_unit_id);
      }

      // Add new Unit Admin role if enabled
      // Note: unitAdminScope is an organization ID from the dropdown, we need to convert to unit ID
      if (isUnitAdmin && unitAdminScope) {
        const topLevelUnit = await getTopLevelUnitForOrganization(unitAdminScope);
        if (!topLevelUnit) {
          setError("No top-level unit found for this organization. Please create a unit first.");
          setIsSaving(false);
          return;
        }
        await assignUserRole(user.id, "Unit Admin", topLevelUnit.id);
      }

      // Add new Manager role if selected
      if (managerRole && managerScope) {
        await assignUserRole(user.id, managerRole, managerScope);
      }

      // Ensure user has Standard User role if they have no other roles
      if (!isUnitAdmin && !managerRole && !isAppAdmin) {
        // Check if they already have Standard User
        const hasStandardUser = user.roles.some(r => r.role_name === "Standard User");
        if (!hasStandardUser) {
          await assignUserRole(user.id, "Standard User", null);
        }
      }

      // Roles are now managed directly via assignUserRole/removeUserRole in data-layer
      // The role changes were already applied above, just refresh data
      await loadUsers();

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    setError(null);

    try {
      // Delete user from Supabase (data-layer handles both DB and cache)
      const success = await deleteUser(user.id);
      if (!success) {
        throw new Error("Failed to delete user");
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card variant="elevated" className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <CardTitle>Manage Roles - {user.edipi}</CardTitle>
          <CardDescription>
            Configure user roles and permissions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm">
              {error}
            </div>
          )}

          {/* App Admin Badge (if applicable) - Not editable */}
          {isAppAdmin && (
            <div className="p-3 rounded-lg bg-highlight/10 border border-highlight/20">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 text-xs font-medium rounded bg-highlight/20 text-highlight border border-highlight/30">
                  App Admin
                </span>
                <span className="text-sm text-foreground-muted">
                  (Assigned via configuration)
                </span>
              </div>
            </div>
          )}

          {/* Unit Admin Toggle */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium text-foreground">Unit Admin</h4>
                <p className="text-sm text-foreground-muted">
                  Full administrative access to a specific unit
                </p>
              </div>
              <button
                onClick={() => {
                  setIsUnitAdmin(!isUnitAdmin);
                  if (!isUnitAdmin) setUnitAdminScope("");
                }}
                disabled={isSaving}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 ${
                  isUnitAdmin ? "bg-primary" : "bg-foreground-muted/30"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    isUnitAdmin ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Unit Admin Scope Selector */}
            {isUnitAdmin && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Unit Scope (RUC)
                </label>
                <select
                  className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  value={unitAdminScope}
                  onChange={(e) => setUnitAdminScope(e.target.value)}
                  disabled={isSaving}
                >
                  <option value="">Select a unit...</option>
                  {rucs.map((ruc) => (
                    <option key={ruc.id} value={ruc.id}>
                      {ruc.ruc}{ruc.name ? ` - ${ruc.name}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Manager Role Dropdown - Hidden for App Admin users */}
          {!isAppAdmin && (
            <div className="space-y-3 pt-4 border-t border-border">
              <div>
                <h4 className="font-medium text-foreground">Manager Role</h4>
                <p className="text-sm text-foreground-muted">
                  Assign a management role for personnel oversight
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Role
                </label>
                <select
                  className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  value={managerRole}
                  onChange={(e) => {
                    setManagerRole(e.target.value as RoleName | "");
                    if (!e.target.value) setManagerScope("");
                  }}
                  disabled={isSaving}
                >
                  <option value="">None</option>
                  <option value="Unit Manager">Unit Manager</option>
                  <option value="Company Manager">Company Manager</option>
                  <option value="Section Manager">Section Manager</option>
                  <option value="Work Section Manager">Work Section Manager</option>
                </select>
              </div>

              {/* Manager Scope Selector */}
              {managerRole && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Unit Scope (RUC)
                  </label>
                  <select
                    className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    value={managerScope}
                    onChange={(e) => setManagerScope(e.target.value)}
                    disabled={isSaving}
                  >
                    <option value="">Select a unit...</option>
                    {units.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.unit_name} ({unit.hierarchy_level})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Approval Permission Toggle - For users with scoped roles (hidden for App Admins) */}
          {hasScopedRole && !isAppAdmin && (
            <div className="pt-4 border-t border-border">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-foreground">Non-Availability Approval</h4>
                  <p className="text-sm text-foreground-muted">
                    Allow approving/rejecting non-availability requests
                  </p>
                </div>
                <button
                  onClick={() => setCanApproveNA(!canApproveNA)}
                  disabled={isSaving}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 ${
                    canApproveNA ? "bg-success" : "bg-foreground-muted/30"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      canApproveNA ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* Unsaved Changes Indicator */}
          {hasChanges && (
            <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 text-warning text-sm">
              You have unsaved changes. Click &quot;Save Changes&quot; to apply them.
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col gap-3 pt-4 border-t border-border">
            {/* Save Changes Button */}
            <Button
              variant="accent"
              onClick={handleSaveChanges}
              isLoading={isSaving}
              disabled={isSaving || isDeleting || !hasChanges}
              className="w-full"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Save Changes
            </Button>

            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={onClose}
                disabled={isSaving || isDeleting}
                className="flex-1"
              >
                {hasChanges ? "Cancel" : "Close"}
              </Button>

              {/* Delete Account Button */}
              {!isAppAdmin && (
                <>
                  {!showDeleteConfirm ? (
                    <Button
                      variant="ghost"
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={isSaving || isDeleting}
                      className="text-error hover:bg-error/10"
                    >
                      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Delete
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={handleDeleteAccount}
                      isLoading={isDeleting}
                      disabled={isSaving || isDeleting}
                      className="bg-error/10 text-error hover:bg-error/20"
                    >
                      Confirm Delete
                    </Button>
                  )}
                </>
              )}
            </div>

            {showDeleteConfirm && (
              <p className="text-xs text-error text-center">
                Are you sure? This will permanently delete this user account.
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="ml-2 underline hover:no-underline"
                >
                  Cancel
                </button>
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

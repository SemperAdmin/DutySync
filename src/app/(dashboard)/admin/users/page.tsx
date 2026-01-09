"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Card, {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import type { UnitSection, RoleName, Personnel, SessionUser } from "@/types";
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
  canManageUser,
  type RucEntry,
} from "@/lib/data-layer";
import { useAuth } from "@/lib/supabase-auth";
import { buildHierarchicalUnitOptions } from "@/lib/unit-hierarchy";

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

  // Build hierarchical unit options for dropdowns
  const hierarchicalUnits = useMemo(() => {
    return buildHierarchicalUnitOptions(units);
  }, [units]);

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
          currentUser={currentUser}
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
  currentUser,
  units,
  rucs,
  getUnitName,
  onClose,
  onSuccess,
}: {
  user: UserData;
  currentUser: SessionUser | null;
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
  const [authError, setAuthError] = useState<string | null>(null);

  // Check authorization on mount
  useEffect(() => {
    async function checkAuth() {
      const authCheck = await canManageUser(currentUser, user.id);
      if (!authCheck.allowed) {
        setAuthError(authCheck.reason || "You are not authorized to manage this user");
      }
    }
    checkAuth();
  }, [currentUser, user.id]);

  // Check if user is App Admin (cannot be changed via UI)
  const isAppAdmin = user.roles.some((r) => r.role_name === "App Admin");

  // Get current Unit Admin roles (user can have multiple, one per RUC)
  const currentUnitAdminRoles = user.roles.filter(r => r.role_name === "Unit Admin");

  // Map unit IDs to organization IDs for tracking
  const getOrgIdFromUnitId = useCallback((unitId: string | null): string | null => {
    if (!unitId) return null;
    const unit = units.find(u => u.id === unitId);
    return unit?.organization_id || null;
  }, [units]);

  // Get set of organization IDs where user is currently Unit Admin
  const currentUnitAdminOrgIds = useMemo(() => {
    const orgIds = new Set<string>();
    for (const role of currentUnitAdminRoles) {
      const orgId = getOrgIdFromUnitId(role.scope_unit_id);
      if (orgId) orgIds.add(orgId);
    }
    return orgIds;
  }, [currentUnitAdminRoles, getOrgIdFromUnitId]);

  // Track selected RUCs (organization IDs)
  const [selectedRucIds, setSelectedRucIds] = useState<Set<string>>(
    new Set(currentUnitAdminOrgIds)
  );

  // Check if there are changes
  const hasChanges = useMemo(() => {
    if (selectedRucIds.size !== currentUnitAdminOrgIds.size) return true;
    for (const orgId of selectedRucIds) {
      if (!currentUnitAdminOrgIds.has(orgId)) return true;
    }
    for (const orgId of currentUnitAdminOrgIds) {
      if (!selectedRucIds.has(orgId)) return true;
    }
    return false;
  }, [selectedRucIds, currentUnitAdminOrgIds]);

  // Toggle RUC selection
  const toggleRuc = (orgId: string) => {
    setSelectedRucIds(prev => {
      const next = new Set(prev);
      if (next.has(orgId)) {
        next.delete(orgId);
      } else {
        next.add(orgId);
      }
      return next;
    });
  };

  const handleSaveChanges = async () => {
    if (authError) {
      setError(authError);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      // Find RUCs to remove (were selected before, not now)
      const toRemove = [...currentUnitAdminOrgIds].filter(orgId => !selectedRucIds.has(orgId));

      // Find RUCs to add (selected now, weren't before)
      const toAdd = [...selectedRucIds].filter(orgId => !currentUnitAdminOrgIds.has(orgId));

      // Remove Unit Admin roles
      for (const orgId of toRemove) {
        const roleToRemove = currentUnitAdminRoles.find(r => {
          const roleOrgId = getOrgIdFromUnitId(r.scope_unit_id);
          return roleOrgId === orgId;
        });
        if (roleToRemove?.scope_unit_id) {
          const result = await removeUserRole(currentUser, user.id, "Unit Admin", roleToRemove.scope_unit_id);
          if (!result.success) {
            setError(result.error || "Failed to remove Unit Admin role");
            setIsSaving(false);
            return;
          }
        }
      }

      // Add new Unit Admin roles
      for (const orgId of toAdd) {
        const topLevelUnit = await getTopLevelUnitForOrganization(orgId);
        if (!topLevelUnit) {
          const ruc = rucs.find(r => r.id === orgId);
          setError(`No top-level unit found for ${ruc?.ruc || orgId}. Please create a unit first.`);
          setIsSaving(false);
          return;
        }
        const result = await assignUserRole(currentUser, user.id, "Unit Admin", topLevelUnit.id);
        if (!result.success) {
          setError(result.error || "Failed to assign Unit Admin role");
          setIsSaving(false);
          return;
        }
      }

      // Ensure user has Standard User role if they have no Unit Admin roles and not App Admin
      if (selectedRucIds.size === 0 && !isAppAdmin) {
        const hasStandardUser = user.roles.some(r => r.role_name === "Standard User");
        if (!hasStandardUser) {
          const result = await assignUserRole(currentUser, user.id, "Standard User", null);
          if (!result.success) {
            setError(result.error || "Failed to assign Standard User role");
            setIsSaving(false);
            return;
          }
        }
      }

      // Refresh user data
      await loadUsers();
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (authError) {
      setError(authError);
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      const result = await deleteUser(currentUser, user.id);
      if (!result.success) {
        setError(result.error || "Failed to delete user");
        setIsDeleting(false);
        return;
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
            Assign Unit Admin access to one or more RUCs
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Authorization Error */}
          {authError && (
            <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>{authError}</span>
              </div>
            </div>
          )}

          {error && !authError && (
            <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm">
              {error}
            </div>
          )}

          {/* App Admin Badge (if applicable) */}
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

          {/* Unit Admin RUC Selection */}
          <div className="space-y-3">
            <div>
              <h4 className="font-medium text-foreground">Unit Admin Access</h4>
              <p className="text-sm text-foreground-muted">
                Select which RUCs this user can administer
              </p>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto">
              {rucs.map((ruc) => {
                const isSelected = selectedRucIds.has(ruc.id);
                return (
                  <label
                    key={ruc.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-primary/10 border-primary"
                        : "bg-surface border-border hover:border-foreground-muted"
                    } ${isSaving ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleRuc(ruc.id)}
                      disabled={isSaving}
                      className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                    />
                    <div className="flex-1">
                      <span className="font-mono font-medium text-foreground">
                        {ruc.ruc}
                      </span>
                      {ruc.name && (
                        <span className="ml-2 text-foreground-muted">
                          - {ruc.name}
                        </span>
                      )}
                    </div>
                    {isSelected && (
                      <span className="px-2 py-0.5 text-xs font-medium rounded bg-primary/20 text-primary">
                        Unit Admin
                      </span>
                    )}
                  </label>
                );
              })}
            </div>

            {selectedRucIds.size === 0 && !isAppAdmin && (
              <p className="text-sm text-foreground-muted italic">
                No Unit Admin roles assigned. User will have Standard User access only.
              </p>
            )}
          </div>

          {/* Unsaved Changes Indicator */}
          {hasChanges && (
            <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 text-warning text-sm">
              You have unsaved changes. Click &quot;Save Changes&quot; to apply them.
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col gap-3 pt-4 border-t border-border">
            <Button
              variant="accent"
              onClick={handleSaveChanges}
              isLoading={isSaving}
              disabled={isSaving || isDeleting || !hasChanges || !!authError}
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
                {authError ? "Close" : hasChanges ? "Cancel" : "Close"}
              </Button>

              {/* Delete Account Button */}
              {!isAppAdmin && !authError && (
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

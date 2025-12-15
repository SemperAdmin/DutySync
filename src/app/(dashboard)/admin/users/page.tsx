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
  getPersonnelByEdipi,
  assignUserRole,
  removeUserRole,
  updateUserApprovalPermission,
  deleteUser,
} from "@/lib/client-stores";
import { triggerUpdateRolesWorkflow, triggerDeleteUserWorkflow } from "@/lib/client-auth";

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

interface PendingChanges {
  rolesToAdd: UserRole[];
  rolesToRemove: UserRole[];
  approvalPermissionChanged: boolean;
  newApprovalValue: boolean;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [units, setUnits] = useState<UnitSection[]>([]);
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);

  const fetchData = useCallback(() => {
    try {
      const usersData = getAllUsers();
      const unitsData = getUnitSections();
      const personnelData = getAllPersonnel();

      setUsers(usersData.map(u => ({
        id: u.id,
        edipi: u.edipi,
        email: u.email,
        personnel_id: u.personnel_id || null,
        can_approve_non_availability: u.can_approve_non_availability || false,
        roles: (u.roles || []).map(r => ({
          id: r.id,
          role_name: r.role_name as RoleName,
          scope_unit_id: r.scope_unit_id,
        })),
      })));
      setUnits(unitsData);
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
      case "Platoon Manager":
      case "Section Manager":
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
      "Platoon Manager",
      "Section Manager"
    ].includes(r.role_name) && r.scope_unit_id);
  };

  const getUnitName = (unitId: string | null) => {
    if (!unitId) return null;
    const unit = units.find((u) => u.id === unitId);
    return unit?.unit_name || "Unknown";
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
            {users.length} user{users.length !== 1 ? "s" : ""} registered
          </CardDescription>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
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
                  {users.map((user) => {
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
  getUnitName,
  onClose,
  onSuccess,
}: {
  user: UserData;
  units: UnitSection[];
  getUnitName: (unitId: string | null) => string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<RoleName>("Standard User");
  const [selectedUnit, setSelectedUnit] = useState<string>("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Track local state for roles and approval permission
  const [localRoles, setLocalRoles] = useState<UserRole[]>(user.roles);
  const [localCanApproveNA, setLocalCanApproveNA] = useState(user.can_approve_non_availability);

  // Track if there are unsaved changes
  const hasChanges = useMemo(() => {
    // Check if roles changed
    const originalRoleKeys = user.roles.map(r => `${r.role_name}:${r.scope_unit_id}`).sort().join(",");
    const localRoleKeys = localRoles.map(r => `${r.role_name}:${r.scope_unit_id}`).sort().join(",");
    const rolesChanged = originalRoleKeys !== localRoleKeys;

    // Check if approval permission changed
    const approvalChanged = user.can_approve_non_availability !== localCanApproveNA;

    return rolesChanged || approvalChanged;
  }, [user.roles, user.can_approve_non_availability, localRoles, localCanApproveNA]);

  const isAppAdmin = localRoles.some((r) => r.role_name === "App Admin");

  // Check if user has a scoped role that could have approval permissions
  const hasScopedRole = localRoles.some(r => [
    "Unit Admin",
    "Unit Manager",
    "Company Manager",
    "Platoon Manager",
    "Section Manager"
  ].includes(r.role_name) && r.scope_unit_id);

  // Check if role requires a unit scope
  const roleRequiresScope = (role: string) => {
    return [
      "Unit Admin",
      "Unit Manager",
      "Company Manager",
      "Platoon Manager",
      "Section Manager",
    ].includes(role);
  };

  const handleAddRole = () => {
    const scopeUnitId = roleRequiresScope(selectedRole) ? selectedUnit : null;

    // Check if role already exists
    const roleExists = localRoles.some(
      r => r.role_name === selectedRole && r.scope_unit_id === scopeUnitId
    );

    if (roleExists) {
      setError("This role is already assigned");
      return;
    }

    setLocalRoles([...localRoles, {
      role_name: selectedRole,
      scope_unit_id: scopeUnitId,
    }]);

    // Reset selection
    setSelectedRole("Standard User");
    setSelectedUnit("");
    setError(null);
  };

  const handleRemoveRole = (roleToRemove: UserRole) => {
    // Don't allow removing the last role
    if (localRoles.length <= 1) {
      setError("User must have at least one role");
      return;
    }

    setLocalRoles(localRoles.filter(
      r => !(r.role_name === roleToRemove.role_name && r.scope_unit_id === roleToRemove.scope_unit_id)
    ));
    setError(null);
  };

  const handleSaveChanges = async () => {
    setIsSaving(true);
    setError(null);

    try {
      // Determine what changed
      const originalRoleKeys = new Set(user.roles.map(r => `${r.role_name}:${r.scope_unit_id}`));
      const localRoleKeys = new Set(localRoles.map(r => `${r.role_name}:${r.scope_unit_id}`));

      // Find roles to add
      const rolesToAdd = localRoles.filter(r => !originalRoleKeys.has(`${r.role_name}:${r.scope_unit_id}`));
      // Find roles to remove
      const rolesToRemove = user.roles.filter(r => !localRoleKeys.has(`${r.role_name}:${r.scope_unit_id}`));

      // Apply role additions to in-memory cache
      for (const role of rolesToAdd) {
        assignUserRole(user.id, role.role_name, role.scope_unit_id);
      }

      // Apply role removals to in-memory cache
      for (const role of rolesToRemove) {
        removeUserRole(user.id, role.role_name, role.scope_unit_id);
      }

      // Update approval permission if changed
      if (user.can_approve_non_availability !== localCanApproveNA) {
        updateUserApprovalPermission(user.id, localCanApproveNA);
      }

      // Build the final roles array for the workflow
      const finalRoles = localRoles.map(r => ({
        role_name: r.role_name,
        scope_unit_id: r.scope_unit_id,
      }));

      // Trigger GitHub workflow to persist all changes
      const workflowResult = await triggerUpdateRolesWorkflow(
        user.id,
        finalRoles,
        localCanApproveNA
      );

      if (!workflowResult.success) {
        console.warn("Failed to persist changes to GitHub:", workflowResult.error);
        // Still show success since in-memory cache was updated
      }

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
      // Delete from in-memory cache
      const success = deleteUser(user.id);

      if (!success) {
        throw new Error("Failed to delete user");
      }

      // Trigger GitHub workflow to persist deletion
      const workflowResult = await triggerDeleteUserWorkflow(user.id);

      if (!workflowResult.success) {
        console.warn("Failed to persist deletion to GitHub:", workflowResult.error);
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
            Assign or modify user roles and permissions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm">
              {error}
            </div>
          )}

          {/* Current Roles with Remove Button */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Current Roles
            </label>
            <div className="flex flex-wrap gap-2">
              {localRoles.map((role, idx) => (
                <span
                  key={role.id || idx}
                  className="inline-flex items-center gap-1 px-3 py-1 text-sm rounded-lg bg-surface-elevated border border-border"
                >
                  {role.role_name}
                  {role.scope_unit_id && (
                    <span className="opacity-75">
                      ({getUnitName(role.scope_unit_id)})
                    </span>
                  )}
                  {/* Remove button - don't show for the last role */}
                  {localRoles.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveRole(role)}
                      className="ml-1 p-0.5 rounded hover:bg-error/20 text-foreground-muted hover:text-error transition-colors"
                      title="Remove role"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>

          {/* Approval Permission Toggle - For users with scoped roles */}
          {hasScopedRole && (
            <div className="pt-4 border-t border-border">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-foreground">Non-Availability Approval</h4>
                  <p className="text-sm text-foreground-muted">
                    Allow this manager to approve/reject non-availability requests within their unit scope
                  </p>
                </div>
                <button
                  onClick={() => setLocalCanApproveNA(!localCanApproveNA)}
                  disabled={isSaving}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 ${
                    localCanApproveNA ? "bg-success" : "bg-foreground-muted/30"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      localCanApproveNA ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* Assign New Role */}
          {!isAppAdmin && (
            <div className="space-y-4 pt-4 border-t border-border">
              <h4 className="font-medium text-foreground">Assign New Role</h4>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Role Type
                </label>
                <select
                  className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  value={selectedRole}
                  onChange={(e) =>
                    setSelectedRole(e.target.value as RoleName)
                  }
                  disabled={isSaving}
                >
                  <option value="Standard User">Standard User</option>
                  <option value="Unit Manager">Unit Manager</option>
                  <option value="Company Manager">Company Manager</option>
                  <option value="Platoon Manager">Platoon Manager</option>
                  <option value="Section Manager">Section Manager</option>
                  <option value="Unit Admin">Unit Admin</option>
                  <option value="App Admin">App Admin</option>
                </select>
              </div>

              {roleRequiresScope(selectedRole) && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Unit Scope
                  </label>
                  <select
                    className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    value={selectedUnit}
                    onChange={(e) => setSelectedUnit(e.target.value)}
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

              <Button
                variant="secondary"
                onClick={handleAddRole}
                disabled={
                  isSaving ||
                  (roleRequiresScope(selectedRole) && !selectedUnit)
                }
                className="w-full"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Add Role
              </Button>
            </div>
          )}

          {isAppAdmin && (
            <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 text-warning text-sm">
              This user is an App Admin. Role changes for App Admins are
              restricted.
            </div>
          )}

          {/* Unsaved Changes Indicator */}
          {hasChanges && (
            <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-primary text-sm">
              You have unsaved changes. Click "Save Changes" to apply them.
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

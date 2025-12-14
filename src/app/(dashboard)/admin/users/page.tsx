"use client";

import { useState, useEffect, useCallback } from "react";
import Card, {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import type { UnitSection, RoleName } from "@/types";
import { getAllUsers, getUnitSections, assignUserRole, updateUserApprovalPermission } from "@/lib/client-stores";
import { triggerUpdateRolesWorkflow } from "@/lib/client-auth";

interface UserData {
  id: string;
  edipi: string;
  email: string;
  personnel_id: string | null;
  can_approve_non_availability: boolean;
  roles: Array<{
    id?: string;
    role_name: RoleName;
    scope_unit_id: string | null;
  }>;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [units, setUnits] = useState<UnitSection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);

  const fetchData = useCallback(() => {
    try {
      const usersData = getAllUsers();
      const unitsData = getUnitSections();

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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

  // Check if user has any manager role
  const isManager = (user: UserData) => {
    return user.roles.some(r => [
      "Unit Manager",
      "Company Manager",
      "Platoon Manager",
      "Section Manager"
    ].includes(r.role_name));
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
                  {users.map((user) => (
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
                        {user.email}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1">
                          {user.roles.map((role) => (
                            <span
                              key={role.id}
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
                        {isManager(user) && user.can_approve_non_availability && (
                          <span className="px-2 py-0.5 text-xs font-medium rounded bg-warning/20 text-warning border border-warning/30">
                            Can Approve N/A
                          </span>
                        )}
                        {isManager(user) && !user.can_approve_non_availability && (
                          <span className="text-foreground-muted text-xs">-</span>
                        )}
                        {!isManager(user) && (
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
                  ))}
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
  onClose,
  onSuccess,
}: {
  user: UserData;
  units: UnitSection[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<RoleName>("Standard User");
  const [selectedUnit, setSelectedUnit] = useState<string>("");
  const [canApproveNA, setCanApproveNA] = useState(user.can_approve_non_availability);

  const isAppAdmin = user.roles.some((r) => r.role_name === "App Admin");

  // Check if user has manager role
  const hasManagerRole = user.roles.some(r => [
    "Unit Manager",
    "Company Manager",
    "Platoon Manager",
    "Section Manager"
  ].includes(r.role_name));

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

  const handleAssignRole = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      // Determine scope based on role type
      const scopeUnitId = roleRequiresScope(selectedRole) ? selectedUnit : null;

      // Update in-memory cache first
      const success = assignUserRole(user.id, selectedRole, scopeUnitId);

      if (!success) {
        throw new Error("Failed to assign role");
      }

      // Build the complete roles array for the user
      const newRole = {
        role_name: selectedRole,
        scope_unit_id: scopeUnitId,
      };

      // Get existing roles and add new one (avoid duplicates)
      const existingRoles = user.roles.map((r) => ({
        role_name: r.role_name,
        scope_unit_id: r.scope_unit_id,
      }));

      const roleExists = existingRoles.some(
        (r) =>
          r.role_name === newRole.role_name &&
          r.scope_unit_id === newRole.scope_unit_id
      );

      const allRoles = roleExists ? existingRoles : [...existingRoles, newRole];

      // Trigger GitHub workflow to persist changes
      const workflowResult = await triggerUpdateRolesWorkflow(user.id, allRoles);

      if (!workflowResult.success) {
        console.warn("Failed to persist role to GitHub:", workflowResult.error);
        // Still show success since in-memory cache was updated
        // The workflow failure means it won't persist across deploys
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle toggling approval permission
  const handleToggleApproval = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const newValue = !canApproveNA;

      // Update in-memory cache first
      updateUserApprovalPermission(user.id, newValue);

      // Build roles for the workflow
      const currentRoles = user.roles.map((r) => ({
        role_name: r.role_name,
        scope_unit_id: r.scope_unit_id,
      }));

      // Trigger workflow to persist the change
      const workflowResult = await triggerUpdateRolesWorkflow(
        user.id,
        currentRoles,
        newValue
      );

      if (!workflowResult.success) {
        console.warn("Failed to persist approval permission to GitHub:", workflowResult.error);
      }

      setCanApproveNA(newValue);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card variant="elevated" className="w-full max-w-md">
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

          {/* Current Roles */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Current Roles
            </label>
            <div className="flex flex-wrap gap-2">
              {user.roles.map((role) => (
                <span
                  key={role.id}
                  className="px-3 py-1 text-sm rounded-lg bg-surface-elevated border border-border"
                >
                  {role.role_name}
                </span>
              ))}
            </div>
          </div>

          {/* Approval Permission Toggle - Only for managers */}
          {hasManagerRole && (
            <div className="pt-4 border-t border-border">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-foreground">Non-Availability Approval</h4>
                  <p className="text-sm text-foreground-muted">
                    Allow this manager to approve/reject non-availability requests within their unit scope
                  </p>
                </div>
                <button
                  onClick={handleToggleApproval}
                  disabled={isSubmitting}
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
                  disabled={isSubmitting}
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
                    disabled={isSubmitting}
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
                variant="accent"
                onClick={handleAssignRole}
                isLoading={isSubmitting}
                disabled={
                  isSubmitting ||
                  (roleRequiresScope(selectedRole) && !selectedUnit)
                }
                className="w-full"
              >
                Assign Role
              </Button>
            </div>
          )}

          {isAppAdmin && (
            <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 text-warning text-sm">
              This user is an App Admin. Role changes for App Admins are
              restricted.
            </div>
          )}

          <div className="flex justify-end pt-4">
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Close
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

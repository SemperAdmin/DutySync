"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Card, { CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useAuth } from "@/lib/client-auth";
import type { UnitSection, HierarchyLevel, RoleName } from "@/types";
import {
  getUnitSections,
  createUnitSection,
  updateUnitSection,
  deleteUnitSection,
  getAllUsers,
  assignUserRole,
  deleteUser,
} from "@/lib/client-stores";
import { levelColors } from "@/lib/unit-constants";

interface UserData {
  id: string;
  edipi: string;
  email: string;
  personnel_id: string | null;
  roles: Array<{
    id?: string;
    role_name: RoleName;
    scope_unit_id: string | null;
  }>;
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const isAppAdmin = user?.roles?.some((role) => role.role_name === "App Admin");
  const [activeTab, setActiveTab] = useState<"units" | "users">("units");

  if (!isAppAdmin) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
          <p className="text-foreground-muted mt-1">
            Welcome back, {user?.displayName || user?.edipi}
          </p>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-warning/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">Access Restricted</h2>
            <p className="text-foreground-muted max-w-md mx-auto">
              You don&apos;t have App Admin privileges. Contact your administrator if you need elevated access.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">App Admin Dashboard</h1>
        <p className="text-foreground-muted mt-1">
          Manage all units and users across the application
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="flex gap-4" aria-label="Tabs">
          <button
            onClick={() => setActiveTab("units")}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === "units"
                ? "border-primary text-primary"
                : "border-transparent text-foreground-muted hover:text-foreground hover:border-border"
            }`}
          >
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              All Units
            </div>
          </button>
          <button
            onClick={() => setActiveTab("users")}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === "users"
                ? "border-primary text-primary"
                : "border-transparent text-foreground-muted hover:text-foreground hover:border-border"
            }`}
          >
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              All Users
            </div>
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === "units" && <UnitsTab />}
      {activeTab === "users" && <UsersTab />}
    </div>
  );
}

// ============ Units Tab ============
function UnitsTab() {
  const [units, setUnits] = useState<UnitSection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingUnit, setEditingUnit] = useState<UnitSection | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  const fetchUnits = useCallback(() => {
    try {
      const data = getUnitSections();
      setUnits(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUnits();
  }, [fetchUnits]);

  const handleDeleteRequest = (id: string, name: string) => {
    setDeleteConfirm({ id, name });
  };

  const handleDeleteConfirm = () => {
    if (!deleteConfirm) return;
    try {
      deleteUnitSection(deleteConfirm.id);
      fetchUnits();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setDeleteConfirm(null);
    }
  };

  const battalions = units.filter((u) => u.hierarchy_level === "battalion");
  const companies = units.filter((u) => u.hierarchy_level === "company");
  const platoons = units.filter((u) => u.hierarchy_level === "platoon");
  const sections = units.filter((u) => u.hierarchy_level === "section");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Add Button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Unit Sections</h2>
          <p className="text-sm text-foreground-muted">{units.length} total units</p>
        </div>
        <Button variant="accent" onClick={() => setShowAddForm(true)}>
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Add Unit
        </Button>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-error/10 border border-error/20 text-error">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-error hover:underline">Dismiss</button>
        </div>
      )}

      {(showAddForm || editingUnit) && (
        <UnitForm
          unit={editingUnit}
          units={units}
          onClose={() => { setShowAddForm(false); setEditingUnit(null); }}
          onSuccess={() => { setShowAddForm(false); setEditingUnit(null); fetchUnits(); }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card variant="elevated" className="w-full max-w-sm">
            <CardHeader>
              <CardTitle>Delete Unit</CardTitle>
              <CardDescription>This action cannot be undone</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-foreground">
                Are you sure you want to delete <strong>{deleteConfirm.name}</strong>?
              </p>
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => setDeleteConfirm(null)} className="flex-1">
                  Cancel
                </Button>
                <Button variant="accent" onClick={handleDeleteConfirm} className="flex-1 bg-error hover:bg-error/90">
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {units.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-highlight" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">No Units Configured</h2>
            <p className="text-foreground-muted mb-6">Add your first unit to get started.</p>
            <Button variant="accent" onClick={() => setShowAddForm(true)}>Add Your First Unit</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {battalions.length > 0 && <UnitHierarchyCard title="Battalions" level="battalion" units={battalions} allUnits={units} onEdit={setEditingUnit} onDelete={handleDeleteRequest} />}
          {companies.length > 0 && <UnitHierarchyCard title="Companies" level="company" units={companies} allUnits={units} onEdit={setEditingUnit} onDelete={handleDeleteRequest} />}
          {platoons.length > 0 && <UnitHierarchyCard title="Platoons" level="platoon" units={platoons} allUnits={units} onEdit={setEditingUnit} onDelete={handleDeleteRequest} />}
          {sections.length > 0 && <UnitHierarchyCard title="Sections" level="section" units={sections} allUnits={units} onEdit={setEditingUnit} onDelete={handleDeleteRequest} />}
        </div>
      )}
    </div>
  );
}

function UnitHierarchyCard({
  title,
  level,
  units,
  allUnits,
  onEdit,
  onDelete,
}: {
  title: string;
  level: HierarchyLevel;
  units: UnitSection[];
  allUnits: UnitSection[];
  onEdit: (unit: UnitSection) => void;
  onDelete: (id: string, name: string) => void;
}) {
  // Memoize parent name lookups for better performance
  const parentNameMap = useMemo(() => {
    return allUnits.reduce((acc, unit) => {
      acc[unit.id] = unit.unit_name;
      return acc;
    }, {} as Record<string, string>);
  }, [allUnits]);

  const getParentName = (parentId: string | null) => {
    if (!parentId) return null;
    return parentNameMap[parentId] || "Unknown";
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <span className={`px-2 py-0.5 text-xs font-medium rounded border ${levelColors[level]}`}>
            {level.toUpperCase()}
          </span>
          {title}
          <span className="text-foreground-muted text-sm font-normal">({units.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {units.map((unit) => (
            <div key={unit.id} className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated border border-border hover:border-border-light transition-colors">
              <div>
                <h3 className="font-medium text-foreground">{unit.unit_name}</h3>
                {unit.parent_id && <p className="text-sm text-foreground-muted">Parent: {getParentName(unit.parent_id)}</p>}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => onEdit(unit)}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onDelete(unit.id, unit.unit_name)} className="text-error hover:bg-error/10">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function UnitForm({ unit, units, onClose, onSuccess }: { unit: UnitSection | null; units: UnitSection[]; onClose: () => void; onSuccess: () => void; }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    unit_name: unit?.unit_name || "",
    hierarchy_level: unit?.hierarchy_level || "battalion",
    parent_id: unit?.parent_id || "",
  });

  const isEditing = !!unit;

  const getPossibleParents = () => {
    switch (formData.hierarchy_level) {
      case "company": return units.filter((u) => u.hierarchy_level === "battalion");
      case "platoon": return units.filter((u) => u.hierarchy_level === "company");
      case "section": return units.filter((u) => u.hierarchy_level === "platoon");
      default: return [];
    }
  };

  const possibleParents = getPossibleParents();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const unitData = {
        unit_name: formData.unit_name,
        hierarchy_level: formData.hierarchy_level as HierarchyLevel,
        parent_id: formData.parent_id || null,
      };

      if (isEditing && unit) {
        updateUnitSection(unit.id, unitData);
      } else {
        const newUnit: UnitSection = {
          id: crypto.randomUUID(),
          ...unitData,
          created_at: new Date(),
          updated_at: new Date(),
        };
        createUnitSection(newUnit);
      }
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
          <CardTitle>{isEditing ? "Edit Unit" : "Add New Unit"}</CardTitle>
          <CardDescription>{isEditing ? "Update the unit information" : "Create a new unit"}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm">{error}</div>}
            <Input label="Unit Name" placeholder="e.g., 1st Battalion" value={formData.unit_name} onChange={(e) => setFormData({ ...formData, unit_name: e.target.value })} required disabled={isSubmitting} />
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Hierarchy Level</label>
              <select className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary" value={formData.hierarchy_level} onChange={(e) => setFormData({ ...formData, hierarchy_level: e.target.value as HierarchyLevel, parent_id: "" })} disabled={isSubmitting || isEditing}>
                <option value="battalion">Battalion</option>
                <option value="company">Company</option>
                <option value="platoon">Platoon</option>
                <option value="section">Section</option>
              </select>
            </div>
            {formData.hierarchy_level !== "battalion" && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Parent Unit</label>
                <select className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary" value={formData.parent_id} onChange={(e) => setFormData({ ...formData, parent_id: e.target.value })} required disabled={isSubmitting}>
                  <option value="">Select parent unit...</option>
                  {possibleParents.map((p) => <option key={p.id} value={p.id}>{p.unit_name}</option>)}
                </select>
              </div>
            )}
            <div className="flex gap-3 pt-4">
              <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting} className="flex-1">Cancel</Button>
              <Button type="submit" variant="accent" isLoading={isSubmitting} disabled={isSubmitting || (formData.hierarchy_level !== "battalion" && possibleParents.length === 0)} className="flex-1">{isEditing ? "Save Changes" : "Add Unit"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ============ Users Tab ============
function UsersTab() {
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
      case "App Admin": return "bg-highlight/20 text-highlight border-highlight/30";
      case "Unit Admin": return "bg-primary/20 text-blue-400 border-primary/30";
      default: return "bg-foreground-muted/20 text-foreground-muted border-foreground-muted/30";
    }
  };

  // Memoize unit name lookups for better performance
  const unitNameMap = useMemo(() => {
    return units.reduce((acc, unit) => {
      acc[unit.id] = unit.unit_name;
      return acc;
    }, {} as Record<string, string>);
  }, [units]);

  const getUnitName = (unitId: string | null) => {
    if (!unitId) return null;
    return unitNameMap[unitId] || "Unknown";
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
        <h2 className="text-xl font-semibold text-foreground">User Management</h2>
        <p className="text-sm text-foreground-muted">{users.length} registered users</p>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-error/10 border border-error/20 text-error">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-error hover:underline">Dismiss</button>
        </div>
      )}

      {editingUser && (
        <RoleAssignmentModal
          user={editingUser}
          units={units}
          onClose={() => setEditingUser(null)}
          onSuccess={() => { setEditingUser(null); fetchData(); }}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Registered Users</CardTitle>
          <CardDescription>{users.length} user{users.length !== 1 ? "s" : ""} registered</CardDescription>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-foreground-muted">No users registered yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">EDIPI</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">Email</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">Roles</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-b border-border hover:bg-surface-elevated">
                      <td className="py-3 px-4">
                        <span className="font-medium text-foreground font-mono">{user.edipi}</span>
                      </td>
                      <td className="py-3 px-4 text-foreground-muted">{user.email}</td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1">
                          {user.roles.map((role, idx) => (
                            <span key={role.id ?? `${idx}-${role.role_name}`} className={`px-2 py-0.5 text-xs font-medium rounded border ${getRoleColor(role.role_name)}`}>
                              {role.role_name}
                              {role.scope_unit_id && <span className="ml-1 opacity-75">({getUnitName(role.scope_unit_id)})</span>}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Button variant="ghost" size="sm" onClick={() => setEditingUser(user)}>
                          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
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

function RoleAssignmentModal({ user, units, onClose, onSuccess }: { user: UserData; units: UnitSection[]; onClose: () => void; onSuccess: () => void; }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<RoleName>("Standard User");
  const [selectedUnit, setSelectedUnit] = useState<string>("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isUserAppAdmin = user.roles.some((r) => r.role_name === "App Admin");

  const handleAssignRole = () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const success = assignUserRole(user.id, selectedRole, selectedRole === "Unit Admin" ? selectedUnit : null);
      if (!success) throw new Error("Failed to assign role");
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const success = deleteUser(user.id);
      if (!success) throw new Error("Failed to delete user");
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
          <CardDescription>Assign or modify user roles</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm">{error}</div>}

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Current Roles</label>
            <div className="flex flex-wrap gap-2">
              {user.roles.map((role, idx) => (
                <span key={role.id ?? `${idx}-${role.role_name}`} className="px-3 py-1 text-sm rounded-lg bg-surface-elevated border border-border">{role.role_name}</span>
              ))}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-surface-elevated border border-border">
            <label className="block text-sm font-medium text-foreground mb-1">EDIPI</label>
            <span className="font-mono text-foreground-muted">{user.edipi}</span>
          </div>

          {!isUserAppAdmin && (
            <div className="space-y-4 pt-4 border-t border-border">
              <h4 className="font-medium text-foreground">Assign New Role</h4>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Role Type</label>
                <select className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary" value={selectedRole} onChange={(e) => setSelectedRole(e.target.value as RoleName)} disabled={isSubmitting}>
                  <option value="Standard User">Standard User</option>
                  <option value="Unit Admin">Unit Admin</option>
                </select>
              </div>

              {selectedRole === "Unit Admin" && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Unit Scope</label>
                  <select className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary" value={selectedUnit} onChange={(e) => setSelectedUnit(e.target.value)} disabled={isSubmitting}>
                    <option value="">Select a unit...</option>
                    {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.unit_name} ({unit.hierarchy_level})</option>)}
                  </select>
                </div>
              )}

              <Button variant="accent" onClick={handleAssignRole} isLoading={isSubmitting} disabled={isSubmitting || (selectedRole === "Unit Admin" && !selectedUnit)} className="w-full">
                Assign Role
              </Button>
            </div>
          )}

          {isUserAppAdmin && (
            <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 text-warning text-sm">
              This user is an App Admin (assigned via EDIPI). Role changes for App Admins require updating the APP_ADMIN environment variable.
            </div>
          )}

          {/* Delete Account Section */}
          {!isUserAppAdmin && (
            <div className="pt-4 border-t border-border">
              {!showDeleteConfirm ? (
                <Button
                  variant="ghost"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isSubmitting}
                  className="w-full text-error hover:bg-error/10"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete Account
                </Button>
              ) : (
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm">
                    Are you sure you want to delete this account? This action cannot be undone.
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={isSubmitting}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={handleDeleteUser}
                      isLoading={isSubmitting}
                      disabled={isSubmitting}
                      className="flex-1 bg-error text-white hover:bg-error/90"
                    >
                      Confirm Delete
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end pt-4">
            <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>Close</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

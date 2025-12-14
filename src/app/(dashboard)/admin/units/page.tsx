"use client";

import { useState, useEffect, useCallback } from "react";
import Card, {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import type { UnitSection, HierarchyLevel, RoleName } from "@/types";
import {
  getUnitSections,
  createUnitSection,
  updateUnitSection,
  deleteUnitSection,
  getAllUsers,
  getPersonnelByEdipi,
} from "@/lib/client-stores";
import { levelColors } from "@/lib/unit-constants";

// User data structure for displaying admins
interface UserWithRoles {
  id: string;
  edipi: string;
  email: string;
  rank?: string;
  firstName?: string;
  lastName?: string;
  roles: Array<{
    role_name: RoleName;
    scope_unit_id: string | null;
  }>;
}

export default function UnitsPage() {
  const [units, setUnits] = useState<UnitSection[]>([]);
  const [users, setUsers] = useState<UserWithRoles[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingUnit, setEditingUnit] = useState<UnitSection | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    try {
      const unitsData = getUnitSections();
      setUnits(unitsData);

      // Fetch users to display Unit Admins with personnel data
      const usersData = getAllUsers();
      setUsers(
        usersData.map((u) => {
          // Look up personnel by EDIPI to get rank/name
          const personnel = getPersonnelByEdipi(u.edipi);
          return {
            id: u.id,
            edipi: u.edipi,
            email: u.email,
            rank: personnel?.rank,
            firstName: personnel?.first_name,
            lastName: personnel?.last_name,
            roles: (u.roles || []).map((r) => ({
              role_name: r.role_name as RoleName,
              scope_unit_id: r.scope_unit_id,
            })),
          };
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Get users who are Unit Admins (have Unit Admin role with a scope)
  const unitAdmins = users.filter((u) =>
    u.roles.some((r) => r.role_name === "Unit Admin" && r.scope_unit_id)
  );

  // Get unit name by ID
  const getUnitName = (unitId: string | null) => {
    if (!unitId) return "Global";
    const unit = units.find((u) => u.id === unitId);
    return unit?.unit_name || "Unknown";
  };

  // Get all ancestor IDs (parents, grandparents, etc.)
  const getAncestorIds = (unitId: string): string[] => {
    const ancestors: string[] = [];
    let current = units.find((u) => u.id === unitId);
    while (current?.parent_id) {
      ancestors.push(current.parent_id);
      current = units.find((u) => u.id === current?.parent_id);
    }
    return ancestors;
  };

  // Get all descendant IDs (children, grandchildren, etc.)
  const getDescendantIds = (unitId: string): string[] => {
    const descendants: string[] = [];
    const children = units.filter((u) => u.parent_id === unitId);
    for (const child of children) {
      descendants.push(child.id);
      descendants.push(...getDescendantIds(child.id));
    }
    return descendants;
  };

  // Check if a unit is in the selected path (ancestor, self, or descendant)
  const isInSelectedPath = (unitId: string): boolean => {
    if (!selectedUnitId) return true; // No filter, show all
    if (unitId === selectedUnitId) return true;
    const ancestors = getAncestorIds(selectedUnitId);
    const descendants = getDescendantIds(selectedUnitId);
    return ancestors.includes(unitId) || descendants.includes(unitId);
  };

  // Handle unit click for filtering
  const handleUnitClick = (unitId: string) => {
    if (selectedUnitId === unitId) {
      setSelectedUnitId(null); // Clear filter if clicking same unit
    } else {
      setSelectedUnitId(unitId);
    }
  };

  const handleDelete = (id: string) => {
    if (!confirm("Are you sure you want to delete this unit?")) return;

    try {
      deleteUnitSection(id);
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  };

  // Group units by hierarchy level (filtered by selected path)
  const topUnits = units.filter((u) => u.hierarchy_level === "unit" && isInSelectedPath(u.id));
  const companies = units.filter((u) => u.hierarchy_level === "company" && isInSelectedPath(u.id));
  const sections = units.filter((u) => u.hierarchy_level === "section" && isInSelectedPath(u.id));
  const workSections = units.filter((u) => u.hierarchy_level === "work_section" && isInSelectedPath(u.id));

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Unit Sections</h1>
          <p className="text-foreground-muted mt-1">
            Manage your organizational hierarchy
          </p>
        </div>
        <Button variant="accent" onClick={() => setShowAddForm(true)}>
          <svg
            className="w-5 h-5 mr-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6v6m0 0v6m0-6h6m-6 0H6"
            />
          </svg>
          Add Unit
        </Button>
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

      {/* Add/Edit Form Modal */}
      {(showAddForm || editingUnit) && (
        <UnitForm
          unit={editingUnit}
          units={units}
          onClose={() => {
            setShowAddForm(false);
            setEditingUnit(null);
          }}
          onSuccess={() => {
            setShowAddForm(false);
            setEditingUnit(null);
            fetchData();
          }}
        />
      )}

      {/* Unit Admins Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-xs font-medium rounded border bg-primary/20 text-blue-400 border-primary/30">
              ADMINS
            </span>
            Unit Administrators
            <span className="text-foreground-muted text-sm font-normal">
              ({unitAdmins.length})
            </span>
          </CardTitle>
          <CardDescription>
            Users with administrative access to specific units
          </CardDescription>
        </CardHeader>
        <CardContent>
          {unitAdmins.length === 0 ? (
            <p className="text-foreground-muted text-center py-4">
              No Unit Admins assigned. Assign Unit Admin roles from User Management.
            </p>
          ) : (
            <div className="space-y-2">
              {unitAdmins.map((admin) => (
                <div
                  key={admin.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated border border-border"
                >
                  <div>
                    <p className="font-medium text-foreground">
                      {admin.rank && admin.lastName
                        ? `${admin.rank} ${admin.lastName}, ${admin.firstName || ""}`
                        : admin.edipi}
                    </p>
                    <p className="text-sm text-foreground-muted">{admin.email}</p>
                  </div>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {admin.roles
                      .filter((r) => r.role_name === "Unit Admin" && r.scope_unit_id)
                      .map((role, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 text-xs font-medium rounded bg-primary/20 text-blue-400"
                        >
                          {getUnitName(role.scope_unit_id)}
                        </span>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Empty State */}
      {units.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/20 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-highlight"
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
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">
              No Units Configured
            </h2>
            <p className="text-foreground-muted mb-6 max-w-md mx-auto">
              Import a Morning Report to auto-create units, or manually add
              Companies, Sections, and Work Sections.
            </p>
            <Button variant="accent" onClick={() => setShowAddForm(true)}>
              Add Your First Unit
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Filter Indicator */}
      {selectedUnitId && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20">
          <span className="text-sm text-foreground">
            Filtering by: <strong>{getUnitName(selectedUnitId)}</strong>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedUnitId(null)}
            className="ml-auto"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Clear Filter
          </Button>
        </div>
      )}

      {/* Units Hierarchy Display */}
      {units.length > 0 && (
        <div className="space-y-6">
          {/* Top-level Units */}
          {topUnits.length > 0 && (
            <HierarchySection
              title="Units"
              level="unit"
              units={topUnits}
              allUnits={units}
              selectedUnitId={selectedUnitId}
              onUnitClick={handleUnitClick}
              onEdit={setEditingUnit}
              onDelete={handleDelete}
            />
          )}

          {/* Companies */}
          {companies.length > 0 && (
            <HierarchySection
              title="Companies"
              level="company"
              units={companies}
              allUnits={units}
              selectedUnitId={selectedUnitId}
              onUnitClick={handleUnitClick}
              onEdit={setEditingUnit}
              onDelete={handleDelete}
            />
          )}

          {/* Sections */}
          {sections.length > 0 && (
            <HierarchySection
              title="Sections"
              level="section"
              units={sections}
              allUnits={units}
              selectedUnitId={selectedUnitId}
              onUnitClick={handleUnitClick}
              onEdit={setEditingUnit}
              onDelete={handleDelete}
            />
          )}

          {/* Work Sections */}
          {workSections.length > 0 && (
            <HierarchySection
              title="Work Sections"
              level="work_section"
              units={workSections}
              allUnits={units}
              selectedUnitId={selectedUnitId}
              onUnitClick={handleUnitClick}
              onEdit={setEditingUnit}
              onDelete={handleDelete}
            />
          )}
        </div>
      )}
    </div>
  );
}

function HierarchySection({
  title,
  level,
  units,
  allUnits,
  selectedUnitId,
  onUnitClick,
  onEdit,
  onDelete,
}: {
  title: string;
  level: HierarchyLevel;
  units: UnitSection[];
  allUnits: UnitSection[];
  selectedUnitId: string | null;
  onUnitClick: (unitId: string) => void;
  onEdit: (unit: UnitSection) => void;
  onDelete: (id: string) => void;
}) {
  const getParentName = (parentId: string | null) => {
    if (!parentId) return null;
    const parent = allUnits.find((u) => u.id === parentId);
    return parent?.unit_name || "Unknown";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 text-xs font-medium rounded border ${levelColors[level]}`}
          >
            {level.toUpperCase()}
          </span>
          {title}
          <span className="text-foreground-muted text-sm font-normal">
            ({units.length})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {units.map((unit) => {
            const isSelected = selectedUnitId === unit.id;
            return (
              <div
                key={unit.id}
                className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                  isSelected
                    ? "bg-primary/20 border-primary"
                    : "bg-surface-elevated border-border hover:border-border-light"
                }`}
              >
                <div
                  className="flex-1 cursor-pointer"
                  onClick={() => onUnitClick(unit.id)}
                >
                  <h3 className={`font-medium ${isSelected ? "text-primary" : "text-foreground"}`}>
                    {unit.unit_name}
                  </h3>
                  {unit.parent_id && (
                    <p className="text-sm text-foreground-muted">
                      Parent: {getParentName(unit.parent_id)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(unit);
                    }}
                  >
                    <svg
                      className="w-4 h-4"
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
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(unit.id);
                    }}
                    className="text-error hover:bg-error/10"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function UnitForm({
  unit,
  units,
  onClose,
  onSuccess,
}: {
  unit: UnitSection | null;
  units: UnitSection[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    unit_name: unit?.unit_name || "",
    hierarchy_level: unit?.hierarchy_level || "unit",
    parent_id: unit?.parent_id || "",
  });

  const isEditing = !!unit;

  // Get possible parents based on hierarchy level
  const getPossibleParents = () => {
    switch (formData.hierarchy_level) {
      case "company":
        return units.filter((u) => u.hierarchy_level === "unit");
      case "section":
        return units.filter((u) => u.hierarchy_level === "company");
      case "work_section":
        return units.filter((u) => u.hierarchy_level === "section");
      default:
        return [];
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
          <CardDescription>
            {isEditing
              ? "Update the unit information"
              : "Create a new unit in your organizational hierarchy"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm">
                {error}
              </div>
            )}

            <Input
              label="Unit Name"
              placeholder="e.g., 1st Battalion, Alpha Company"
              value={formData.unit_name}
              onChange={(e) =>
                setFormData({ ...formData, unit_name: e.target.value })
              }
              required
              disabled={isSubmitting}
            />

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Hierarchy Level
              </label>
              <select
                className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                value={formData.hierarchy_level}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    hierarchy_level: e.target.value as HierarchyLevel,
                    parent_id: "", // Reset parent when level changes
                  })
                }
                disabled={isSubmitting || isEditing}
              >
                <option value="unit">Unit</option>
                <option value="company">Company</option>
                <option value="section">Section</option>
                <option value="work_section">Work Section</option>
              </select>
            </div>

            {formData.hierarchy_level !== "unit" && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Parent Unit
                </label>
                <select
                  className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                  value={formData.parent_id}
                  onChange={(e) =>
                    setFormData({ ...formData, parent_id: e.target.value })
                  }
                  required
                  disabled={isSubmitting}
                >
                  <option value="">Select parent unit...</option>
                  {possibleParents.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.unit_name}
                    </option>
                  ))}
                </select>
                {possibleParents.length === 0 && (
                  <p className="mt-1.5 text-sm text-warning">
                    No valid parent units available. Create a{" "}
                    {formData.hierarchy_level === "company"
                      ? "unit"
                      : formData.hierarchy_level === "section"
                      ? "company"
                      : "section"}{" "}
                    first.
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="accent"
                isLoading={isSubmitting}
                disabled={
                  isSubmitting ||
                  (formData.hierarchy_level !== "unit" &&
                    possibleParents.length === 0)
                }
                className="flex-1"
              >
                {isEditing ? "Save Changes" : "Add Unit"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

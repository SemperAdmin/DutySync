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
import type { UnitSection, HierarchyLevel } from "@/types";

export default function UnitsPage() {
  const [units, setUnits] = useState<UnitSection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingUnit, setEditingUnit] = useState<UnitSection | null>(null);

  const fetchUnits = useCallback(async () => {
    try {
      const response = await fetch("/api/units");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch units");
      }

      setUnits(data.units || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUnits();
  }, [fetchUnits]);

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this unit?")) return;

    try {
      const response = await fetch(`/api/units/${id}`, { method: "DELETE" });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete unit");
      }

      fetchUnits();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  };

  // Group units by hierarchy level
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
            fetchUnits();
          }}
        />
      )}

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
              Start by adding your top-level battalion, then build out your
              organizational structure with companies, platoons, and sections.
            </p>
            <Button variant="accent" onClick={() => setShowAddForm(true)}>
              Add Your First Unit
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Units Hierarchy Display */}
      {units.length > 0 && (
        <div className="space-y-6">
          {/* Battalions */}
          {battalions.length > 0 && (
            <HierarchySection
              title="Battalions"
              level="battalion"
              units={battalions}
              allUnits={units}
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
              onEdit={setEditingUnit}
              onDelete={handleDelete}
            />
          )}

          {/* Platoons */}
          {platoons.length > 0 && (
            <HierarchySection
              title="Platoons"
              level="platoon"
              units={platoons}
              allUnits={units}
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
  onEdit,
  onDelete,
}: {
  title: string;
  level: HierarchyLevel;
  units: UnitSection[];
  allUnits: UnitSection[];
  onEdit: (unit: UnitSection) => void;
  onDelete: (id: string) => void;
}) {
  const levelColors = {
    battalion: "bg-highlight/20 text-highlight border-highlight/30",
    company: "bg-primary/20 text-blue-400 border-primary/30",
    platoon: "bg-success/20 text-success border-success/30",
    section: "bg-foreground-muted/20 text-foreground-muted border-foreground-muted/30",
  };

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
          {units.map((unit) => (
            <div
              key={unit.id}
              className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated border border-border hover:border-border-light transition-colors"
            >
              <div>
                <h3 className="font-medium text-foreground">{unit.unit_name}</h3>
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
                  onClick={() => onEdit(unit)}
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
                  onClick={() => onDelete(unit.id)}
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
          ))}
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
    hierarchy_level: unit?.hierarchy_level || "battalion",
    parent_id: unit?.parent_id || "",
  });

  const isEditing = !!unit;

  // Get possible parents based on hierarchy level
  const getPossibleParents = () => {
    switch (formData.hierarchy_level) {
      case "company":
        return units.filter((u) => u.hierarchy_level === "battalion");
      case "platoon":
        return units.filter((u) => u.hierarchy_level === "company");
      case "section":
        return units.filter((u) => u.hierarchy_level === "platoon");
      default:
        return [];
    }
  };

  const possibleParents = getPossibleParents();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const url = isEditing ? `/api/units/${unit.id}` : "/api/units";
      const method = isEditing ? "PUT" : "POST";

      const body = {
        unit_name: formData.unit_name,
        hierarchy_level: formData.hierarchy_level,
        parent_id: formData.parent_id || null,
      };

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save unit");
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
                <option value="battalion">Battalion</option>
                <option value="company">Company</option>
                <option value="platoon">Platoon</option>
                <option value="section">Section</option>
              </select>
            </div>

            {formData.hierarchy_level !== "battalion" && (
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
                      ? "battalion"
                      : formData.hierarchy_level === "platoon"
                      ? "company"
                      : "platoon"}{" "}
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
                  (formData.hierarchy_level !== "battalion" &&
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

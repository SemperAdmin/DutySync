"use client";

import { useState, useEffect } from "react";
import Button from "@/components/ui/Button";
import type { DutyType, DutyValue, DutyRequirement, UnitSection } from "@/types";
import {
  getUnitSections,
  getEnrichedDutyTypes,
  createDutyType,
  updateDutyType,
  deleteDutyType,
  createDutyValue,
  updateDutyValue,
  getDutyValueByDutyType,
  addDutyRequirement,
  clearDutyRequirements,
  type EnrichedDutyType,
} from "@/lib/client-stores";

// Common qualifications that can be required for duties
const COMMON_QUALIFICATIONS = [
  "NCO",
  "Officer",
  "E-5 or above",
  "E-6 or above",
  "CQ Certified",
  "Arms Room",
  "Guard Force",
  "Staff Duty Trained",
  "Driver Licensed",
  "Secret Clearance",
  "Top Secret Clearance",
];

// Military ranks for min/max selection
const MILITARY_RANKS = [
  "E-1", "E-2", "E-3", "E-4", "E-5", "E-6", "E-7", "E-8", "E-9",
  "W-1", "W-2", "W-3", "W-4", "W-5",
  "O-1", "O-2", "O-3", "O-4", "O-5", "O-6", "O-7", "O-8", "O-9", "O-10",
];

export default function DutyTypesPage() {
  const [dutyTypes, setDutyTypes] = useState<EnrichedDutyType[]>([]);
  const [units, setUnits] = useState<UnitSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUnitFilter, setSelectedUnitFilter] = useState<string>("");

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [editingDutyType, setEditingDutyType] = useState<EnrichedDutyType | null>(null);
  const [deletingDutyType, setDeletingDutyType] = useState<EnrichedDutyType | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    unit_section_id: "",
    duty_name: "",
    description: "",
    slots_needed: "1",
    required_rank_min: "",
    required_rank_max: "",
    requirements: [] as string[],
    base_weight: "1.0",
    weekend_multiplier: "1.5",
    holiday_multiplier: "2.0",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchData();
  }, [selectedUnitFilter]);

  function fetchData() {
    try {
      setLoading(true);
      const unitsData = getUnitSections();
      setUnits(unitsData);

      const dutyTypesData = getEnrichedDutyTypes(selectedUnitFilter || undefined);
      setDutyTypes(dutyTypesData);
    } catch (err) {
      console.error("Error fetching data:", err);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setFormData({
      unit_section_id: "",
      duty_name: "",
      description: "",
      slots_needed: "1",
      required_rank_min: "",
      required_rank_max: "",
      requirements: [],
      base_weight: "1.0",
      weekend_multiplier: "1.5",
      holiday_multiplier: "2.0",
    });
    setError("");
  }

  function openAddModal() {
    resetForm();
    setIsAddModalOpen(true);
  }

  function openEditModal(dutyType: EnrichedDutyType) {
    setEditingDutyType(dutyType);
    setFormData({
      unit_section_id: dutyType.unit_section_id,
      duty_name: dutyType.duty_name,
      description: dutyType.description || "",
      slots_needed: dutyType.slots_needed.toString(),
      required_rank_min: dutyType.required_rank_min || "",
      required_rank_max: dutyType.required_rank_max || "",
      requirements: dutyType.requirements.map((r) => r.required_qual_name),
      base_weight: dutyType.duty_value?.base_weight.toString() || "1.0",
      weekend_multiplier: dutyType.duty_value?.weekend_multiplier.toString() || "1.5",
      holiday_multiplier: dutyType.duty_value?.holiday_multiplier.toString() || "2.0",
    });
    setError("");
    setIsEditModalOpen(true);
  }

  function openDeleteModal(dutyType: EnrichedDutyType) {
    setDeletingDutyType(dutyType);
    setIsDeleteModalOpen(true);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      // Create duty type
      const newDutyType: DutyType = {
        id: crypto.randomUUID(),
        unit_section_id: formData.unit_section_id,
        duty_name: formData.duty_name,
        description: formData.description || null,
        slots_needed: parseInt(formData.slots_needed),
        required_rank_min: formData.required_rank_min || null,
        required_rank_max: formData.required_rank_max || null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };
      createDutyType(newDutyType);

      // Create duty value
      const newDutyValue: DutyValue = {
        id: crypto.randomUUID(),
        duty_type_id: newDutyType.id,
        base_weight: parseFloat(formData.base_weight),
        weekend_multiplier: parseFloat(formData.weekend_multiplier),
        holiday_multiplier: parseFloat(formData.holiday_multiplier),
      };
      createDutyValue(newDutyValue);

      // Create requirements
      for (const qual of formData.requirements) {
        addDutyRequirement(newDutyType.id, qual);
      }

      setIsAddModalOpen(false);
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create duty type");
    } finally {
      setSubmitting(false);
    }
  }

  function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editingDutyType) return;

    setSubmitting(true);
    setError("");

    try {
      // Update duty type
      updateDutyType(editingDutyType.id, {
        duty_name: formData.duty_name,
        description: formData.description || null,
        slots_needed: parseInt(formData.slots_needed),
        required_rank_min: formData.required_rank_min || null,
        required_rank_max: formData.required_rank_max || null,
      });

      // Update duty value
      const existingValue = getDutyValueByDutyType(editingDutyType.id);
      if (existingValue) {
        updateDutyValue(existingValue.id, {
          base_weight: parseFloat(formData.base_weight),
          weekend_multiplier: parseFloat(formData.weekend_multiplier),
          holiday_multiplier: parseFloat(formData.holiday_multiplier),
        });
      } else {
        const newDutyValue: DutyValue = {
          id: crypto.randomUUID(),
          duty_type_id: editingDutyType.id,
          base_weight: parseFloat(formData.base_weight),
          weekend_multiplier: parseFloat(formData.weekend_multiplier),
          holiday_multiplier: parseFloat(formData.holiday_multiplier),
        };
        createDutyValue(newDutyValue);
      }

      // Update requirements - clear and re-add
      clearDutyRequirements(editingDutyType.id);
      for (const qual of formData.requirements) {
        addDutyRequirement(editingDutyType.id, qual);
      }

      setIsEditModalOpen(false);
      setEditingDutyType(null);
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update duty type");
    } finally {
      setSubmitting(false);
    }
  }

  function handleDelete() {
    if (!deletingDutyType) return;

    setSubmitting(true);

    try {
      clearDutyRequirements(deletingDutyType.id);
      deleteDutyType(deletingDutyType.id);

      setIsDeleteModalOpen(false);
      setDeletingDutyType(null);
      fetchData();
    } catch (err) {
      console.error("Delete error:", err);
    } finally {
      setSubmitting(false);
    }
  }

  function toggleRequirement(qual: string) {
    setFormData((prev) => ({
      ...prev,
      requirements: prev.requirements.includes(qual)
        ? prev.requirements.filter((r) => r !== qual)
        : [...prev.requirements, qual],
    }));
  }

  function getUnitName(unitId: string): string {
    const unit = units.find((u) => u.id === unitId);
    return unit?.unit_name || "Unknown Unit";
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-foreground-muted">Loading duty types...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Duty Types Configuration</h1>
          <p className="text-foreground-muted mt-1">
            Configure duty types, requirements, and point values
          </p>
        </div>
        <Button onClick={openAddModal}>+ Add Duty Type</Button>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <select
          value={selectedUnitFilter}
          onChange={(e) => setSelectedUnitFilter(e.target.value)}
          className="px-3 py-2 bg-surface border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">All Sections</option>
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.unit_name} ({unit.hierarchy_level})
            </option>
          ))}
        </select>
      </div>

      {/* Duty Types Grid */}
      {dutyTypes.length === 0 ? (
        <div className="text-center py-12 bg-surface rounded-lg border border-border">
          <p className="text-foreground-muted">No duty types configured yet.</p>
          <p className="text-sm text-foreground-muted mt-1">
            Click &quot;Add Duty Type&quot; to create your first duty type.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {dutyTypes.map((dutyType) => (
            <div
              key={dutyType.id}
              className="bg-surface rounded-lg border border-border p-4 space-y-3"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-foreground">{dutyType.duty_name}</h3>
                  <p className="text-sm text-foreground-muted">
                    {getUnitName(dutyType.unit_section_id)}
                  </p>
                </div>
                <span
                  className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                    dutyType.is_active
                      ? "bg-green-500/20 text-green-400"
                      : "bg-gray-500/20 text-gray-400"
                  }`}
                >
                  {dutyType.is_active ? "Active" : "Inactive"}
                </span>
              </div>

              {dutyType.description && (
                <p className="text-sm text-foreground-muted">{dutyType.description}</p>
              )}

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-foreground-muted">Slots:</span>{" "}
                  <span className="text-foreground">{dutyType.slots_needed}</span>
                </div>
                {dutyType.required_rank_min && (
                  <div>
                    <span className="text-foreground-muted">Min Rank:</span>{" "}
                    <span className="text-foreground">{dutyType.required_rank_min}</span>
                  </div>
                )}
              </div>

              {/* Point Values */}
              {dutyType.duty_value && (
                <div className="pt-2 border-t border-border">
                  <p className="text-xs text-foreground-muted mb-1">Point Values</p>
                  <div className="flex gap-3 text-xs">
                    <span className="text-foreground">
                      Base: {dutyType.duty_value.base_weight}
                    </span>
                    <span className="text-foreground">
                      Weekend: {dutyType.duty_value.weekend_multiplier}x
                    </span>
                    <span className="text-foreground">
                      Holiday: {dutyType.duty_value.holiday_multiplier}x
                    </span>
                  </div>
                </div>
              )}

              {/* Requirements */}
              {dutyType.requirements.length > 0 && (
                <div className="pt-2 border-t border-border">
                  <p className="text-xs text-foreground-muted mb-1">Requirements</p>
                  <div className="flex flex-wrap gap-1">
                    {dutyType.requirements.map((req) => (
                      <span
                        key={req.required_qual_name}
                        className="px-2 py-0.5 text-xs bg-primary/20 text-primary rounded-full"
                      >
                        {req.required_qual_name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <Button size="sm" variant="secondary" onClick={() => openEditModal(dutyType)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => openDeleteModal(dutyType)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">Add Duty Type</h2>
            </div>
            <form onSubmit={handleCreate} className="p-4 space-y-4">
              {error && (
                <div className="p-3 bg-accent/20 text-accent rounded-lg text-sm">{error}</div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Unit *
                  </label>
                  <select
                    value={formData.unit_section_id}
                    onChange={(e) =>
                      setFormData({ ...formData, unit_section_id: e.target.value })
                    }
                    required
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Select Unit</option>
                    {units.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.unit_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Duty Name *
                  </label>
                  <input
                    type="text"
                    value={formData.duty_name}
                    onChange={(e) => setFormData({ ...formData, duty_name: e.target.value })}
                    required
                    placeholder="e.g., Staff Duty, CQ, Guard"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                  placeholder="Optional description of duties and responsibilities"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Slots Needed *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.slots_needed}
                    onChange={(e) => setFormData({ ...formData, slots_needed: e.target.value })}
                    required
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Min Rank
                  </label>
                  <select
                    value={formData.required_rank_min}
                    onChange={(e) =>
                      setFormData({ ...formData, required_rank_min: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Any Rank</option>
                    {MILITARY_RANKS.map((rank) => (
                      <option key={rank} value={rank}>
                        {rank}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Max Rank
                  </label>
                  <select
                    value={formData.required_rank_max}
                    onChange={(e) =>
                      setFormData({ ...formData, required_rank_max: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Any Rank</option>
                    {MILITARY_RANKS.map((rank) => (
                      <option key={rank} value={rank}>
                        {rank}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Point Values */}
              <div className="border-t border-border pt-4">
                <h3 className="text-sm font-medium text-foreground mb-3">Point Values</h3>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="block text-sm text-foreground-muted mb-1">
                      Base Weight
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={formData.base_weight}
                      onChange={(e) =>
                        setFormData({ ...formData, base_weight: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-foreground-muted mb-1">
                      Weekend Multiplier
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="1"
                      value={formData.weekend_multiplier}
                      onChange={(e) =>
                        setFormData({ ...formData, weekend_multiplier: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-foreground-muted mb-1">
                      Holiday Multiplier
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="1"
                      value={formData.holiday_multiplier}
                      onChange={(e) =>
                        setFormData({ ...formData, holiday_multiplier: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
              </div>

              {/* Requirements */}
              <div className="border-t border-border pt-4">
                <h3 className="text-sm font-medium text-foreground mb-3">
                  Required Qualifications
                </h3>
                <div className="flex flex-wrap gap-2">
                  {COMMON_QUALIFICATIONS.map((qual) => (
                    <button
                      key={qual}
                      type="button"
                      onClick={() => toggleRequirement(qual)}
                      className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                        formData.requirements.includes(qual)
                          ? "bg-primary text-white border-primary"
                          : "bg-background text-foreground-muted border-border hover:border-primary"
                      }`}
                    >
                      {qual}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsAddModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Creating..." : "Create Duty Type"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {isEditModalOpen && editingDutyType && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">Edit Duty Type</h2>
            </div>
            <form onSubmit={handleUpdate} className="p-4 space-y-4">
              {error && (
                <div className="p-3 bg-accent/20 text-accent rounded-lg text-sm">{error}</div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Unit</label>
                  <input
                    type="text"
                    value={getUnitName(formData.unit_section_id)}
                    disabled
                    className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-foreground-muted"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Duty Name *
                  </label>
                  <input
                    type="text"
                    value={formData.duty_name}
                    onChange={(e) => setFormData({ ...formData, duty_name: e.target.value })}
                    required
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Slots Needed *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.slots_needed}
                    onChange={(e) => setFormData({ ...formData, slots_needed: e.target.value })}
                    required
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Min Rank
                  </label>
                  <select
                    value={formData.required_rank_min}
                    onChange={(e) =>
                      setFormData({ ...formData, required_rank_min: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Any Rank</option>
                    {MILITARY_RANKS.map((rank) => (
                      <option key={rank} value={rank}>
                        {rank}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Max Rank
                  </label>
                  <select
                    value={formData.required_rank_max}
                    onChange={(e) =>
                      setFormData({ ...formData, required_rank_max: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Any Rank</option>
                    {MILITARY_RANKS.map((rank) => (
                      <option key={rank} value={rank}>
                        {rank}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Point Values */}
              <div className="border-t border-border pt-4">
                <h3 className="text-sm font-medium text-foreground mb-3">Point Values</h3>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="block text-sm text-foreground-muted mb-1">
                      Base Weight
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={formData.base_weight}
                      onChange={(e) =>
                        setFormData({ ...formData, base_weight: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-foreground-muted mb-1">
                      Weekend Multiplier
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="1"
                      value={formData.weekend_multiplier}
                      onChange={(e) =>
                        setFormData({ ...formData, weekend_multiplier: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-foreground-muted mb-1">
                      Holiday Multiplier
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="1"
                      value={formData.holiday_multiplier}
                      onChange={(e) =>
                        setFormData({ ...formData, holiday_multiplier: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
              </div>

              {/* Requirements */}
              <div className="border-t border-border pt-4">
                <h3 className="text-sm font-medium text-foreground mb-3">
                  Required Qualifications
                </h3>
                <div className="flex flex-wrap gap-2">
                  {COMMON_QUALIFICATIONS.map((qual) => (
                    <button
                      key={qual}
                      type="button"
                      onClick={() => toggleRequirement(qual)}
                      className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                        formData.requirements.includes(qual)
                          ? "bg-primary text-white border-primary"
                          : "bg-background text-foreground-muted border-border hover:border-primary"
                      }`}
                    >
                      {qual}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setIsEditModalOpen(false);
                    setEditingDutyType(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && deletingDutyType && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md">
            <div className="p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">Delete Duty Type</h2>
            </div>
            <div className="p-4">
              <p className="text-foreground-muted">
                Are you sure you want to delete &quot;{deletingDutyType.duty_name}&quot;? This will
                also remove all associated requirements and point values.
              </p>
            </div>
            <div className="flex justify-end gap-3 p-4 border-t border-border">
              <Button
                variant="ghost"
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setDeletingDutyType(null);
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" onClick={handleDelete} disabled={submitting}>
                {submitting ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

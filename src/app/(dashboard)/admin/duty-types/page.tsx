"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Button from "@/components/ui/Button";
import type { DutyType, DutyValue, UnitSection, Personnel, BlockedDuty, RoleName, NonAvailability } from "@/types";
import {
  getUnitSections,
  getEnrichedDutyTypes,
  createDutyType,
  updateDutyType,
  deleteDutyType,
  createDutyValue,
  updateDutyValue,
  getDutyValueByDutyType,
  clearDutyRequirements,
  getAllPersonnel,
  getChildUnits,
  getActiveBlocksForDutyType,
  createBlockedDuty,
  deleteBlockedDuty,
  getAllNonAvailability,
  type EnrichedDutyType,
} from "@/lib/client-stores";
import { getTopLevelUnitForOrganization } from "@/lib/data-layer";
import { useAuth } from "@/lib/supabase-auth";
import { useSyncRefresh } from "@/hooks/useSync";
import { buildHierarchicalUnitOptions, formatUnitOptionLabel } from "@/lib/unit-hierarchy";
import { ORG_SCOPED_ROLES } from "@/lib/constants";
import PersonnelExemptionsDisplay from "@/components/PersonnelExemptionsDisplay";

// USMC rank order for sorting (E1-E9, W1-W5, O1-O10)
const RANK_ORDER = [
  // Enlisted (E1-E9)
  "PVT",    // E-1
  "PFC",    // E-2
  "LCPL",   // E-3
  "CPL",    // E-4
  "SGT",    // E-5
  "SSGT",   // E-6
  "GYSGT",  // E-7
  "MSGT",   // E-8
  "1STSGT", // E-8
  "MGYSGT", // E-9
  "SGTMAJ", // E-9
  // Warrant Officers (W1-W5)
  "WO",     // W-1
  "CWO2",   // W-2
  "CWO3",   // W-3
  "CWO4",   // W-4
  "CWO5",   // W-5
  // Officers (O1-O10)
  "2NDLT",  // O-1
  "1STLT",  // O-2
  "CAPT",   // O-3
  "MAJ",    // O-4
  "LTCOL",  // O-5
  "COL",    // O-6
  "BGEN",   // O-7
  "MAJGEN", // O-8
  "LTGEN",  // O-9
  "GEN",    // O-10
];

type FilterMode = 'include' | 'exclude' | null;

// Extended duty type with blocks info
interface DutyTypeWithBlocks extends EnrichedDutyType {
  activeBlocks: BlockedDuty[];
}

export default function DutyTypesPage() {
  const { user, selectedRuc, availableRucs } = useAuth();
  const [dutyTypes, setDutyTypes] = useState<DutyTypeWithBlocks[]>([]);
  const [units, setUnits] = useState<UnitSection[]>([]);
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [nonAvailability, setNonAvailability] = useState<NonAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUnitFilter, setSelectedUnitFilter] = useState<string>("");

  // Get the organization ID for the currently selected RUC
  const selectedRucOrganizationId = useMemo(() => {
    if (!selectedRuc || availableRucs.length === 0) return null;
    const rucInfo = availableRucs.find(r => r.ruc === selectedRuc);
    return rucInfo?.organizationId || null;
  }, [selectedRuc, availableRucs]);

  // Helper function to derive organization ID from user roles and units
  // Prioritizes selected RUC when available
  const deriveUserOrganizationId = useCallback((allUnits: UnitSection[]): string | null => {
    if (!user?.roles) return null;

    // Check if user is App Admin (no scope restriction)
    const isAppAdmin = user.roles.some(r => r.role_name === "App Admin");
    if (isAppAdmin) return null;

    // If we have a selected RUC organization ID, use it
    if (selectedRucOrganizationId) return selectedRucOrganizationId;

    // Fallback: Find the user's organization-scoped role (Unit Admin preferred)
    const scopedRole = user.roles.find(r => ORG_SCOPED_ROLES.includes(r.role_name as RoleName));
    if (!scopedRole?.scope_unit_id) return null;

    // Find the unit in the loaded data to get its organization
    const scopeUnit = allUnits.find(u => u.id === scopedRole.scope_unit_id);
    return scopeUnit?.organization_id || null;
  }, [user?.roles, selectedRucOrganizationId]);

  // Selection for blocking
  const [selectedDutyIds, setSelectedDutyIds] = useState<Set<string>>(new Set());

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isBlockModalOpen, setIsBlockModalOpen] = useState(false);
  const [isViewBlocksModalOpen, setIsViewBlocksModalOpen] = useState(false);
  const [editingDutyType, setEditingDutyType] = useState<EnrichedDutyType | null>(null);
  const [deletingDutyType, setDeletingDutyType] = useState<EnrichedDutyType | null>(null);
  const [viewingBlocksDutyType, setViewingBlocksDutyType] = useState<DutyTypeWithBlocks | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    unit_section_id: "",
    duty_name: "",
    description: "",
    slots_needed: "1",
    rank_filter_mode: null as FilterMode | null,
    rank_filter_values: [] as string[],
    section_filter_mode: null as FilterMode | null,
    section_filter_values: [] as string[],
    notes: "",
    base_weight: "1.0",
    weekend_multiplier: "1.5",
    holiday_multiplier: "2.0",
    // Supernumerary settings
    requires_supernumerary: false,
    supernumerary_count: "2",
    supernumerary_period_days: "15",
    supernumerary_value: "0.5",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Block form state
  const [blockFormData, setBlockFormData] = useState({
    startDate: "",
    endDate: "",
    reason: "",
  });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const allUnitsData = getUnitSections();

      // Derive organization ID from loaded data
      const userOrganizationId = deriveUserOrganizationId(allUnitsData);

      // Filter units by user's organization (RUC)
      let unitsData = allUnitsData;
      if (userOrganizationId) {
        unitsData = unitsData.filter(u => u.organization_id === userOrganizationId);

        // Set default filter to top-level unit on first load
        if (!selectedUnitFilter) {
          const topLevelUnit = await getTopLevelUnitForOrganization(userOrganizationId);
          if (topLevelUnit) {
            setSelectedUnitFilter(topLevelUnit.id);
          }
        }
      }
      setUnits(unitsData);

      // Get org unit IDs for filtering (computed once)
      const orgUnitIds = userOrganizationId ? new Set(unitsData.map(u => u.id)) : null;

      let personnelData = getAllPersonnel();
      // Filter personnel by user's organization (RUC)
      if (orgUnitIds) {
        personnelData = personnelData.filter(p => orgUnitIds.has(p.unit_section_id));
      }
      setPersonnel(personnelData);

      let dutyTypesData = getEnrichedDutyTypes(selectedUnitFilter || undefined);
      // Filter duty types by user's organization (RUC)
      if (orgUnitIds) {
        dutyTypesData = dutyTypesData.filter(dt => orgUnitIds.has(dt.unit_section_id));
      }
      // Enrich with active blocks
      const enrichedWithBlocks: DutyTypeWithBlocks[] = dutyTypesData.map((dt) => ({
        ...dt,
        activeBlocks: getActiveBlocksForDutyType(dt.id),
      }));
      setDutyTypes(enrichedWithBlocks);

      // Fetch non-availability (exemptions) and filter by organization
      let nonAvailData = getAllNonAvailability();
      if (orgUnitIds) {
        const orgPersonnelIds = new Set(personnelData.map(p => p.id));
        nonAvailData = nonAvailData.filter(na => orgPersonnelIds.has(na.personnel_id));
      }
      setNonAvailability(nonAvailData);
    } catch (err) {
      console.error("Error fetching data:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedUnitFilter, deriveUserOrganizationId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Listen for sync updates and refresh automatically
  useSyncRefresh(["units", "dutyTypes", "personnel", "nonAvailability"], fetchData);

  // Build hierarchical unit options for dropdowns
  const hierarchicalUnits = useMemo(() => {
    return buildHierarchicalUnitOptions(units);
  }, [units]);

  // Get unique ranks from personnel in the selected unit and its descendants
  const availableRanks = useMemo(() => {
    if (!formData.unit_section_id) return [];

    // Get all descendant unit IDs
    const getDescendantIds = (unitId: string): string[] => {
      const children = getChildUnits(unitId);
      const childIds = children.map(c => c.id);
      const descendantIds = children.flatMap(c => getDescendantIds(c.id));
      return [unitId, ...childIds, ...descendantIds];
    };

    const unitIds = new Set(getDescendantIds(formData.unit_section_id));

    // Get unique ranks from personnel in these units
    const ranks = new Set<string>();
    personnel.forEach(p => {
      if (unitIds.has(p.unit_section_id) && p.rank) {
        ranks.add(p.rank);
      }
    });

    // Sort ranks in military order using RANK_ORDER constant
    return Array.from(ranks).sort((a, b) => {
      const aIdx = RANK_ORDER.indexOf(a);
      const bIdx = RANK_ORDER.indexOf(b);
      if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });
  }, [formData.unit_section_id, personnel]);

  // Get child sections of the selected unit
  const availableSections = useMemo(() => {
    if (!formData.unit_section_id) return [];

    // Get all descendant units (children, grandchildren, etc.)
    const getDescendants = (unitId: string): UnitSection[] => {
      const children = units.filter(u => u.parent_id === unitId);
      const descendants = children.flatMap(c => getDescendants(c.id));
      return [...children, ...descendants];
    };

    return getDescendants(formData.unit_section_id);
  }, [formData.unit_section_id, units]);

  // Get active/upcoming exemptions for personnel in the selected unit
  const unitExemptions = useMemo(() => {
    if (!formData.unit_section_id) return [];

    // Get all descendant unit IDs
    const getDescendantIds = (unitId: string): string[] => {
      const children = getChildUnits(unitId);
      const childIds = children.map(c => c.id);
      const descendantIds = children.flatMap(c => getDescendantIds(c.id));
      return [unitId, ...childIds, ...descendantIds];
    };

    const unitIds = new Set(getDescendantIds(formData.unit_section_id));

    // Get personnel in these units
    const unitPersonnelIds = new Set(
      personnel.filter(p => unitIds.has(p.unit_section_id)).map(p => p.id)
    );

    // Create a map for efficient personnel lookup (O(1) instead of O(n))
    const personnelById = new Map(personnel.map(p => [p.id, p]));

    // Get today's date string for comparison
    const today = new Date().toISOString().split('T')[0];

    // Get active/upcoming exemptions (approved or pending, not ended)
    return nonAvailability
      .filter(na => {
        if (!unitPersonnelIds.has(na.personnel_id)) return false;
        // Include if end date is today or in the future, and status is approved/pending/recommended
        if (na.end_date < today) return false;
        return ['approved', 'pending', 'recommended'].includes(na.status);
      })
      .map(na => {
        const person = personnelById.get(na.personnel_id);
        return {
          ...na,
          personnel: person,
        };
      })
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
  }, [formData.unit_section_id, personnel, nonAvailability, getChildUnits]);

  function resetForm() {
    setFormData({
      unit_section_id: "",
      duty_name: "",
      description: "",
      slots_needed: "1",
      rank_filter_mode: null,
      rank_filter_values: [],
      section_filter_mode: null,
      section_filter_values: [],
      notes: "",
      base_weight: "1.0",
      weekend_multiplier: "1.5",
      holiday_multiplier: "2.0",
      requires_supernumerary: false,
      supernumerary_count: "2",
      supernumerary_period_days: "15",
      supernumerary_value: "0.5",
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
      rank_filter_mode: dutyType.rank_filter_mode || null,
      rank_filter_values: dutyType.rank_filter_values || [],
      section_filter_mode: dutyType.section_filter_mode || null,
      section_filter_values: dutyType.section_filter_values || [],
      notes: dutyType.notes || "",
      base_weight: dutyType.duty_value?.base_weight.toString() || "1.0",
      weekend_multiplier: dutyType.duty_value?.weekend_multiplier.toString() || "1.5",
      holiday_multiplier: dutyType.duty_value?.holiday_multiplier.toString() || "2.0",
      requires_supernumerary: dutyType.requires_supernumerary || false,
      supernumerary_count: (dutyType.supernumerary_count || 2).toString(),
      supernumerary_period_days: (dutyType.supernumerary_period_days || 15).toString(),
      supernumerary_value: (dutyType.supernumerary_value || 0.5).toString(),
    });
    setError("");
    setIsEditModalOpen(true);
  }

  function openDeleteModal(dutyType: EnrichedDutyType) {
    setDeletingDutyType(dutyType);
    setIsDeleteModalOpen(true);
  }

  // Selection handlers for blocking
  function toggleDutySelection(dutyId: string) {
    setSelectedDutyIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(dutyId)) {
        newSet.delete(dutyId);
      } else {
        newSet.add(dutyId);
      }
      return newSet;
    });
  }

  function selectAllDuties() {
    setSelectedDutyIds(new Set(dutyTypes.map((dt) => dt.id)));
  }

  function clearSelection() {
    setSelectedDutyIds(new Set());
  }

  function openBlockModal() {
    // Set default dates to today and tomorrow
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    setBlockFormData({
      startDate: today.toISOString().split("T")[0],
      endDate: tomorrow.toISOString().split("T")[0],
      reason: "",
    });
    setError("");
    setIsBlockModalOpen(true);
  }

  function openViewBlocksModal(dutyType: DutyTypeWithBlocks) {
    setViewingBlocksDutyType(dutyType);
    setIsViewBlocksModalOpen(true);
  }

  function handleBlockSelectedDuties(e: React.FormEvent) {
    e.preventDefault();
    if (selectedDutyIds.size === 0) return;

    setSubmitting(true);
    setError("");

    try {
      // Use DateString directly from form input (YYYY-MM-DD format)
      const startDate = blockFormData.startDate;
      const endDate = blockFormData.endDate;

      if (endDate < startDate) {
        setError("End date must be after start date");
        setSubmitting(false);
        return;
      }

      // Create a block for each selected duty type
      for (const dutyId of selectedDutyIds) {
        const dutyType = dutyTypes.find((dt) => dt.id === dutyId);
        if (!dutyType) continue;

        const newBlock: BlockedDuty = {
          id: crypto.randomUUID(),
          duty_type_id: dutyId,
          unit_section_id: dutyType.unit_section_id,
          start_date: startDate, // Already a DateString from input
          end_date: endDate,     // Already a DateString from input
          reason: blockFormData.reason || null,
          blocked_by: user?.id || "",
          created_at: new Date(),
        };
        createBlockedDuty(newBlock);
      }

      setIsBlockModalOpen(false);
      clearSelection();
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to block duties");
    } finally {
      setSubmitting(false);
    }
  }

  function handleRemoveBlock(blockId: string) {
    deleteBlockedDuty(blockId);
    // Refresh viewing duty type blocks
    if (viewingBlocksDutyType) {
      const updatedBlocks = getActiveBlocksForDutyType(viewingBlocksDutyType.id);
      setViewingBlocksDutyType({ ...viewingBlocksDutyType, activeBlocks: updatedBlocks });
    }
    fetchData();
  }

  function formatDate(date: Date | string): string {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
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
        notes: formData.notes || null,
        slots_needed: parseInt(formData.slots_needed),
        required_rank_min: null,  // Deprecated
        required_rank_max: null,  // Deprecated
        rank_filter_mode: formData.rank_filter_values.length > 0 ? formData.rank_filter_mode : null,
        rank_filter_values: formData.rank_filter_values.length > 0 ? formData.rank_filter_values : null,
        section_filter_mode: formData.section_filter_values.length > 0 ? formData.section_filter_mode : null,
        section_filter_values: formData.section_filter_values.length > 0 ? formData.section_filter_values : null,
        is_active: true,
        requires_supernumerary: formData.requires_supernumerary,
        supernumerary_count: (v => Number.isFinite(v) ? v : 2)(parseInt(formData.supernumerary_count)),
        supernumerary_period_days: (v => Number.isFinite(v) ? v : 15)(parseInt(formData.supernumerary_period_days)),
        supernumerary_value: (v => Number.isFinite(v) ? v : 0.5)(parseFloat(formData.supernumerary_value)),
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
        notes: formData.notes || null,
        slots_needed: parseInt(formData.slots_needed),
        rank_filter_mode: formData.rank_filter_values.length > 0 ? formData.rank_filter_mode : null,
        rank_filter_values: formData.rank_filter_values.length > 0 ? formData.rank_filter_values : null,
        section_filter_mode: formData.section_filter_values.length > 0 ? formData.section_filter_mode : null,
        section_filter_values: formData.section_filter_values.length > 0 ? formData.section_filter_values : null,
        requires_supernumerary: formData.requires_supernumerary,
        supernumerary_count: (v => Number.isFinite(v) ? v : 2)(parseInt(formData.supernumerary_count)),
        supernumerary_period_days: (v => Number.isFinite(v) ? v : 15)(parseInt(formData.supernumerary_period_days)),
        supernumerary_value: (v => Number.isFinite(v) ? v : 0.5)(parseFloat(formData.supernumerary_value)),
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

  function toggleRank(rank: string) {
    setFormData((prev) => ({
      ...prev,
      rank_filter_values: prev.rank_filter_values.includes(rank)
        ? prev.rank_filter_values.filter((r) => r !== rank)
        : [...prev.rank_filter_values, rank],
    }));
  }

  function toggleSection(sectionId: string) {
    setFormData((prev) => ({
      ...prev,
      section_filter_values: prev.section_filter_values.includes(sectionId)
        ? prev.section_filter_values.filter((s) => s !== sectionId)
        : [...prev.section_filter_values, sectionId],
    }));
  }

  function getUnitName(unitId: string): string {
    const unit = units.find((u) => u.id === unitId);
    return unit?.unit_name || "Unknown Unit";
  }

  // Render filter summary for display cards
  function renderFilterSummary(dutyType: EnrichedDutyType) {
    const parts: string[] = [];

    if (dutyType.rank_filter_mode && dutyType.rank_filter_values?.length) {
      const modeLabel = dutyType.rank_filter_mode === 'include' ? 'Only' : 'Except';
      parts.push(`Ranks: ${modeLabel} ${dutyType.rank_filter_values.join(', ')}`);
    }

    if (dutyType.section_filter_mode && dutyType.section_filter_values?.length) {
      const modeLabel = dutyType.section_filter_mode === 'include' ? 'Only' : 'Except';
      const sectionNames = dutyType.section_filter_values.map(id => getUnitName(id)).join(', ');
      parts.push(`Sections: ${modeLabel} ${sectionNames}`);
    }

    return parts.length > 0 ? parts : null;
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

      {/* Selection Toolbar */}
      {dutyTypes.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 p-3 bg-surface-elevated rounded-lg border border-border">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                selectedDutyIds.size === dutyTypes.length ? clearSelection() : selectAllDuties()
              }
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-foreground-muted hover:text-foreground border border-border rounded-lg hover:bg-surface transition-colors"
            >
              <input
                type="checkbox"
                checked={selectedDutyIds.size === dutyTypes.length && dutyTypes.length > 0}
                onChange={() => {}}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
              />
              Select All
            </button>
          </div>

          {selectedDutyIds.size > 0 && (
            <>
              <span className="text-sm text-foreground-muted">
                {selectedDutyIds.size} selected
              </span>
              <Button size="sm" variant="secondary" onClick={openBlockModal}>
                Block Selected Dates
              </Button>
              <Button size="sm" variant="ghost" onClick={clearSelection}>
                Clear Selection
              </Button>
            </>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-4">
        <select
          value={selectedUnitFilter}
          onChange={(e) => setSelectedUnitFilter(e.target.value)}
          className="px-3 py-2 bg-surface border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono"
        >
          <option value="">All Sections</option>
          {hierarchicalUnits.map((option) => (
            <option key={option.id} value={option.id}>
              {formatUnitOptionLabel(option, true)}
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
          {dutyTypes.map((dutyType) => {
            const filterSummary = renderFilterSummary(dutyType);
            return (
              <div
                key={dutyType.id}
                className={`bg-surface rounded-lg border p-4 space-y-3 transition-colors ${
                  selectedDutyIds.has(dutyType.id)
                    ? "border-primary bg-primary/5"
                    : "border-border"
                }`}
              >
                {/* Selection checkbox and header */}
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedDutyIds.has(dutyType.id)}
                    onChange={() => toggleDutySelection(dutyType.id)}
                    className="w-4 h-4 mt-1 rounded border-border text-primary focus:ring-primary cursor-pointer"
                  />
                  <div className="flex-1">
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

                {/* Blocked status indicator */}
                {dutyType.activeBlocks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => openViewBlocksModal(dutyType)}
                    className="w-full flex items-center justify-between p-2 bg-accent/10 border border-accent/20 rounded-lg text-left hover:bg-accent/20 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <svg
                        className="w-4 h-4 text-accent"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                        />
                      </svg>
                      <span className="text-sm text-accent font-medium">
                        {dutyType.activeBlocks.length} blocked date{dutyType.activeBlocks.length > 1 ? "s" : ""}
                      </span>
                    </div>
                    <span className="text-xs text-accent/70">View</span>
                  </button>
                )}

                {dutyType.description && (
                  <p className="text-sm text-foreground-muted">{dutyType.description}</p>
                )}

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-foreground-muted">Slots:</span>{" "}
                    <span className="text-foreground">{dutyType.slots_needed}</span>
                  </div>
                </div>

                {/* Eligibility Filters */}
                {filterSummary && (
                  <div className="pt-2 border-t border-border">
                    <p className="text-xs text-foreground-muted mb-1">Eligibility Filters</p>
                    <div className="space-y-1">
                      {filterSummary.map((filter, idx) => (
                        <p key={idx} className="text-xs text-foreground">{filter}</p>
                      ))}
                    </div>
                  </div>
                )}

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

                {/* Supernumerary */}
                {dutyType.requires_supernumerary && (
                  <div className="pt-2 border-t border-border">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-highlight/20 text-highlight">
                        Supernumerary
                      </span>
                    </div>
                    <div className="flex gap-3 text-xs">
                      <span className="text-foreground">
                        Slots: {dutyType.supernumerary_count}/mo
                      </span>
                      <span className="text-foreground">
                        Period: {dutyType.supernumerary_period_days}d
                      </span>
                      <span className="text-foreground">
                        Value: {dutyType.supernumerary_value}
                      </span>
                    </div>
                  </div>
                )}

                {/* Notes */}
                {dutyType.notes && (
                  <div className="pt-2 border-t border-border">
                    <p className="text-xs text-foreground-muted mb-1">Notes</p>
                    <p className="text-xs text-foreground">{dutyType.notes}</p>
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
            );
          })}
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
                      setFormData({
                        ...formData,
                        unit_section_id: e.target.value,
                        rank_filter_values: [],
                        section_filter_values: [],
                      })
                    }
                    required
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                  >
                    <option value="">Select Unit</option>
                    {hierarchicalUnits.map((option) => (
                      <option key={option.id} value={option.id}>
                        {formatUnitOptionLabel(option)}
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
                  className="w-full max-w-[120px] px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Rank Filter */}
              {formData.unit_section_id && availableRanks.length > 0 && (
                <div className="border-t border-border pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-foreground">Rank Filter</h3>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, rank_filter_mode: formData.rank_filter_mode === 'include' ? null : 'include' })}
                        className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                          formData.rank_filter_mode === 'include'
                            ? "bg-success/20 text-success border-success"
                            : "bg-background text-foreground-muted border-border hover:border-success"
                        }`}
                      >
                        Include Only
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, rank_filter_mode: formData.rank_filter_mode === 'exclude' ? null : 'exclude' })}
                        className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                          formData.rank_filter_mode === 'exclude'
                            ? "bg-error/20 text-error border-error"
                            : "bg-background text-foreground-muted border-border hover:border-error"
                        }`}
                      >
                        Exclude
                      </button>
                    </div>
                  </div>
                  {formData.rank_filter_mode && (
                    <>
                      <p className="text-xs text-foreground-muted mb-2">
                        {formData.rank_filter_mode === 'include'
                          ? 'Only selected ranks will be eligible for this duty'
                          : 'Selected ranks will NOT be eligible for this duty'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {availableRanks.map((rank) => (
                          <button
                            key={rank}
                            type="button"
                            onClick={() => toggleRank(rank)}
                            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                              formData.rank_filter_values.includes(rank)
                                ? formData.rank_filter_mode === 'include'
                                  ? "bg-success/20 text-success border-success"
                                  : "bg-error/20 text-error border-error"
                                : "bg-background text-foreground-muted border-border hover:border-primary"
                            }`}
                          >
                            {rank}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Section Filter */}
              {formData.unit_section_id && availableSections.length > 0 && (
                <div className="border-t border-border pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-foreground">Section Filter</h3>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, section_filter_mode: formData.section_filter_mode === 'include' ? null : 'include' })}
                        className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                          formData.section_filter_mode === 'include'
                            ? "bg-success/20 text-success border-success"
                            : "bg-background text-foreground-muted border-border hover:border-success"
                        }`}
                      >
                        Include Only
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, section_filter_mode: formData.section_filter_mode === 'exclude' ? null : 'exclude' })}
                        className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                          formData.section_filter_mode === 'exclude'
                            ? "bg-error/20 text-error border-error"
                            : "bg-background text-foreground-muted border-border hover:border-error"
                        }`}
                      >
                        Exclude
                      </button>
                    </div>
                  </div>
                  {formData.section_filter_mode && (
                    <>
                      <p className="text-xs text-foreground-muted mb-2">
                        {formData.section_filter_mode === 'include'
                          ? 'Only personnel from selected sections will be eligible'
                          : 'Personnel from selected sections will NOT be eligible'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {availableSections.map((section) => (
                          <button
                            key={section.id}
                            type="button"
                            onClick={() => toggleSection(section.id)}
                            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                              formData.section_filter_values.includes(section.id)
                                ? formData.section_filter_mode === 'include'
                                  ? "bg-success/20 text-success border-success"
                                  : "bg-error/20 text-error border-error"
                                : "bg-background text-foreground-muted border-border hover:border-primary"
                            }`}
                          >
                            {section.unit_name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Personnel Exemptions */}
              {formData.unit_section_id && (
                <PersonnelExemptionsDisplay exemptions={unitExemptions} />
              )}

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

              {/* Supernumerary Configuration */}
              <div className="border-t border-border pt-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Supernumerary Coverage</h3>
                    <p className="text-xs text-foreground-muted">Configure standby personnel for this duty type</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.requires_supernumerary}
                      onChange={(e) => setFormData({ ...formData, requires_supernumerary: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-surface-elevated peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-foreground-muted after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-checked:after:bg-white"></div>
                  </label>
                </div>
                {formData.requires_supernumerary && (
                  <div className="grid gap-4 md:grid-cols-3 p-3 bg-surface-elevated rounded-lg border border-border">
                    <div>
                      <label className="block text-sm text-foreground-muted mb-1">
                        Supernumerary Slots
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={formData.supernumerary_count}
                        onChange={(e) => setFormData({ ...formData, supernumerary_count: e.target.value })}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <p className="text-xs text-foreground-muted mt-1">Per month (e.g., 2)</p>
                    </div>
                    <div>
                      <label className="block text-sm text-foreground-muted mb-1">
                        Period (Days)
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        value={formData.supernumerary_period_days}
                        onChange={(e) => setFormData({ ...formData, supernumerary_period_days: e.target.value })}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <p className="text-xs text-foreground-muted mt-1">15 = half-month</p>
                    </div>
                    <div>
                      <label className="block text-sm text-foreground-muted mb-1">
                        Standby Value
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={formData.supernumerary_value}
                        onChange={(e) => setFormData({ ...formData, supernumerary_value: e.target.value })}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <p className="text-xs text-foreground-muted mt-1">Score if not activated</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Duty Type Notes */}
              <div className="border-t border-border pt-4">
                <label className="block text-sm font-medium text-foreground mb-1">
                  Duty Type Notes
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                  placeholder="Optional notes about this duty type (e.g., special instructions, requirements, etc.)"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
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
                  className="w-full max-w-[120px] px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Rank Filter */}
              {availableRanks.length > 0 && (
                <div className="border-t border-border pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-foreground">Rank Filter</h3>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, rank_filter_mode: formData.rank_filter_mode === 'include' ? null : 'include' })}
                        className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                          formData.rank_filter_mode === 'include'
                            ? "bg-success/20 text-success border-success"
                            : "bg-background text-foreground-muted border-border hover:border-success"
                        }`}
                      >
                        Include Only
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, rank_filter_mode: formData.rank_filter_mode === 'exclude' ? null : 'exclude' })}
                        className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                          formData.rank_filter_mode === 'exclude'
                            ? "bg-error/20 text-error border-error"
                            : "bg-background text-foreground-muted border-border hover:border-error"
                        }`}
                      >
                        Exclude
                      </button>
                    </div>
                  </div>
                  {formData.rank_filter_mode && (
                    <>
                      <p className="text-xs text-foreground-muted mb-2">
                        {formData.rank_filter_mode === 'include'
                          ? 'Only selected ranks will be eligible for this duty'
                          : 'Selected ranks will NOT be eligible for this duty'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {availableRanks.map((rank) => (
                          <button
                            key={rank}
                            type="button"
                            onClick={() => toggleRank(rank)}
                            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                              formData.rank_filter_values.includes(rank)
                                ? formData.rank_filter_mode === 'include'
                                  ? "bg-success/20 text-success border-success"
                                  : "bg-error/20 text-error border-error"
                                : "bg-background text-foreground-muted border-border hover:border-primary"
                            }`}
                          >
                            {rank}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Section Filter */}
              {availableSections.length > 0 && (
                <div className="border-t border-border pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-foreground">Section Filter</h3>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, section_filter_mode: formData.section_filter_mode === 'include' ? null : 'include' })}
                        className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                          formData.section_filter_mode === 'include'
                            ? "bg-success/20 text-success border-success"
                            : "bg-background text-foreground-muted border-border hover:border-success"
                        }`}
                      >
                        Include Only
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, section_filter_mode: formData.section_filter_mode === 'exclude' ? null : 'exclude' })}
                        className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                          formData.section_filter_mode === 'exclude'
                            ? "bg-error/20 text-error border-error"
                            : "bg-background text-foreground-muted border-border hover:border-error"
                        }`}
                      >
                        Exclude
                      </button>
                    </div>
                  </div>
                  {formData.section_filter_mode && (
                    <>
                      <p className="text-xs text-foreground-muted mb-2">
                        {formData.section_filter_mode === 'include'
                          ? 'Only personnel from selected sections will be eligible'
                          : 'Personnel from selected sections will NOT be eligible'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {availableSections.map((section) => (
                          <button
                            key={section.id}
                            type="button"
                            onClick={() => toggleSection(section.id)}
                            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                              formData.section_filter_values.includes(section.id)
                                ? formData.section_filter_mode === 'include'
                                  ? "bg-success/20 text-success border-success"
                                  : "bg-error/20 text-error border-error"
                                : "bg-background text-foreground-muted border-border hover:border-primary"
                            }`}
                          >
                            {section.unit_name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Personnel Exemptions */}
              {formData.unit_section_id && (
                <PersonnelExemptionsDisplay exemptions={unitExemptions} />
              )}

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

              {/* Supernumerary Configuration */}
              <div className="border-t border-border pt-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Supernumerary Coverage</h3>
                    <p className="text-xs text-foreground-muted">Configure standby personnel for this duty type</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.requires_supernumerary}
                      onChange={(e) => setFormData({ ...formData, requires_supernumerary: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-surface-elevated peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-foreground-muted after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-checked:after:bg-white"></div>
                  </label>
                </div>
                {formData.requires_supernumerary && (
                  <div className="grid gap-4 md:grid-cols-3 p-3 bg-surface-elevated rounded-lg border border-border">
                    <div>
                      <label className="block text-sm text-foreground-muted mb-1">
                        Supernumerary Slots
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={formData.supernumerary_count}
                        onChange={(e) => setFormData({ ...formData, supernumerary_count: e.target.value })}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <p className="text-xs text-foreground-muted mt-1">Per month (e.g., 2)</p>
                    </div>
                    <div>
                      <label className="block text-sm text-foreground-muted mb-1">
                        Period (Days)
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        value={formData.supernumerary_period_days}
                        onChange={(e) => setFormData({ ...formData, supernumerary_period_days: e.target.value })}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <p className="text-xs text-foreground-muted mt-1">15 = half-month</p>
                    </div>
                    <div>
                      <label className="block text-sm text-foreground-muted mb-1">
                        Standby Value
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={formData.supernumerary_value}
                        onChange={(e) => setFormData({ ...formData, supernumerary_value: e.target.value })}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <p className="text-xs text-foreground-muted mt-1">Score if not activated</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Duty Type Notes */}
              <div className="border-t border-border pt-4">
                <label className="block text-sm font-medium text-foreground mb-1">
                  Duty Type Notes
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                  placeholder="Optional notes about this duty type (e.g., special instructions, requirements, etc.)"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
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

      {/* Block Dates Modal */}
      {isBlockModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md">
            <div className="p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">Block Duty Dates</h2>
              <p className="text-sm text-foreground-muted mt-1">
                Block {selectedDutyIds.size} selected duty type{selectedDutyIds.size > 1 ? "s" : ""} for specific dates
              </p>
            </div>
            <form onSubmit={handleBlockSelectedDuties} className="p-4 space-y-4">
              {error && (
                <div className="p-3 bg-accent/20 text-accent rounded-lg text-sm">{error}</div>
              )}

              <div className="space-y-3">
                <div className="p-3 bg-surface-elevated rounded-lg border border-border">
                  <p className="text-xs text-foreground-muted mb-2">Blocking:</p>
                  <div className="flex flex-wrap gap-1">
                    {Array.from(selectedDutyIds).map((id) => {
                      const dt = dutyTypes.find((d) => d.id === id);
                      return dt ? (
                        <span
                          key={id}
                          className="px-2 py-0.5 text-xs bg-primary/20 text-primary rounded-full"
                        >
                          {dt.duty_name}
                        </span>
                      ) : null;
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      Start Date *
                    </label>
                    <input
                      type="date"
                      value={blockFormData.startDate}
                      onChange={(e) =>
                        setBlockFormData({ ...blockFormData, startDate: e.target.value })
                      }
                      required
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      End Date *
                    </label>
                    <input
                      type="date"
                      value={blockFormData.endDate}
                      onChange={(e) =>
                        setBlockFormData({ ...blockFormData, endDate: e.target.value })
                      }
                      required
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Reason (optional)
                  </label>
                  <input
                    type="text"
                    value={blockFormData.reason}
                    onChange={(e) =>
                      setBlockFormData({ ...blockFormData, reason: e.target.value })
                    }
                    placeholder="e.g., Holiday, Training, Special Event"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsBlockModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Blocking..." : "Block Dates"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Blocks Modal */}
      {isViewBlocksModalOpen && viewingBlocksDutyType && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md">
            <div className="p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">Blocked Dates</h2>
              <p className="text-sm text-foreground-muted mt-1">
                {viewingBlocksDutyType.duty_name}
              </p>
            </div>
            <div className="p-4 space-y-3 max-h-80 overflow-y-auto">
              {viewingBlocksDutyType.activeBlocks.length === 0 ? (
                <p className="text-foreground-muted text-center py-4">
                  No active blocks for this duty type.
                </p>
              ) : (
                viewingBlocksDutyType.activeBlocks.map((block) => (
                  <div
                    key={block.id}
                    className="flex items-center justify-between p-3 bg-surface-elevated rounded-lg border border-border"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {formatDate(block.start_date)} - {formatDate(block.end_date)}
                      </p>
                      {block.reason && (
                        <p className="text-xs text-foreground-muted mt-0.5">{block.reason}</p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveBlock(block.id)}
                      className="text-accent hover:text-accent hover:bg-accent/10"
                    >
                      Remove
                    </Button>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-end gap-3 p-4 border-t border-border">
              <Button
                variant="secondary"
                onClick={() => {
                  setIsViewBlocksModalOpen(false);
                  setViewingBlocksDutyType(null);
                }}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

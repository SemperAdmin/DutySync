"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Button from "@/components/ui/Button";
import type { UnitSection } from "@/types";
import {
  getUnitSections,
  getDutyTypeById,
  getPersonnelById,
  getDutyTypesByUnitWithDescendants,
  getPersonnelByUnitWithDescendants,
  getActiveSupernumeraryForDutyType,
  type EnrichedSlot,
} from "@/lib/client-stores";
import {
  previewSchedule,
  applyPreviewedSlots,
  previewSupernumeraryAssignments,
  applySupernumeraryAssignments,
} from "@/lib/duty-thruster";
import type { DutySlot, SupernumeraryAssignment } from "@/types";
import { useSyncRefresh } from "@/hooks/useSync";
import { buildHierarchicalUnitOptions, formatUnitOptionLabel } from "@/lib/unit-hierarchy";
import { parseLocalDate, formatDateToString } from "@/lib/date-utils";
import { useAuth } from "@/lib/supabase-auth";
import { ORG_SCOPED_ROLES } from "@/lib/constants";
import type { RoleName } from "@/types";

// Extracted component for supernumerary debug info
interface SupernumeraryDebugInfoProps {
  selectedUnit: string;
  selectedUnitOrganizationId: string | null;
  startDate: string;
}

function SupernumeraryDebugInfo({ selectedUnit, selectedUnitOrganizationId, startDate }: SupernumeraryDebugInfoProps) {
  const dutyTypes = getDutyTypesByUnitWithDescendants(selectedUnit);
  const supernumeraryTypes = dutyTypes.filter(dt => dt.is_active && dt.requires_supernumerary);

  return (
    <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
      <h4 className="text-sm font-medium text-blue-400 mb-1">Supernumerary Debug Info</h4>
      <ul className="text-xs text-blue-300 space-y-1">
        <li>Organization ID: {selectedUnitOrganizationId || "Not set"}</li>
        <li>Total duty types: {dutyTypes.length}</li>
        <li>With supernumerary enabled: {supernumeraryTypes.length}</li>
        {supernumeraryTypes.map(dt => {
          const personnel = getPersonnelByUnitWithDescendants(dt.unit_section_id);
          const rankFiltered = personnel.filter(p => {
            if (!dt.rank_filter_mode) return true;
            const values = dt.rank_filter_values || [];
            return dt.rank_filter_mode === 'include'
              ? values.includes(p.rank)
              : !values.includes(p.rank);
          });
          const existingSuper = getActiveSupernumeraryForDutyType(dt.id, startDate as `${number}-${number}-${number}`);
          return (
            <li key={dt.id} className="ml-4">
              • {dt.duty_name}: count={dt.supernumerary_count}, period={dt.supernumerary_period_days}d
              <br />
              <span className="ml-4">unit_section_id: {dt.unit_section_id}</span>
              <br />
              <span className="ml-4">Personnel in unit: {personnel.length}, After rank filter: {rankFiltered.length}</span>
              <br />
              <span className="ml-4">Existing supernumerary: {existingSuper.length}</span>
              <br />
              <span className="ml-4">Rank filter: {dt.rank_filter_mode || 'none'} {JSON.stringify(dt.rank_filter_values)}</span>
            </li>
          );
        })}
        {supernumeraryTypes.length === 0 && (
          <li className="text-yellow-400">No duty types have supernumerary enabled!</li>
        )}
      </ul>
    </div>
  );
}

// Enriched supernumerary assignment for display
interface EnrichedSupernumeraryAssignment extends SupernumeraryAssignment {
  duty_type_name: string;
  personnel_name: string;
  personnel_rank: string;
}

interface ScheduleResult {
  success: boolean;
  preview: boolean;
  slots_created: number;
  slots_skipped: number;
  errors: string[];
  warnings: string[];
  slots: EnrichedSlot[];
  supernumerary_created: number;
  supernumerary: EnrichedSupernumeraryAssignment[];
}

export default function SchedulerPage() {
  const { user, selectedRuc, availableRucs } = useAuth();
  const [units, setUnits] = useState<UnitSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  // Form state
  const [selectedUnit, setSelectedUnit] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [clearExisting, setClearExisting] = useState(false);

  // Results
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [error, setError] = useState("");

  // Store preview slots so we can apply the exact same schedule
  const [previewSlots, setPreviewSlots] = useState<DutySlot[]>([]);
  // Store preview supernumerary assignments
  const [previewSupernumerary, setPreviewSupernumerary] = useState<SupernumeraryAssignment[]>([]);

  // Get the organization ID for the currently selected RUC
  const selectedRucOrganizationId = useMemo(() => {
    if (!selectedRuc || availableRucs.length === 0) return null;
    const rucInfo = availableRucs.find(r => r.ruc === selectedRuc);
    return rucInfo?.organizationId || null;
  }, [selectedRuc, availableRucs]);

  const fetchUnits = useCallback(() => {
    try {
      setLoading(true);
      const allUnitsData = getUnitSections();

      // Derive organization ID - prioritize selected RUC
      let userOrganizationId: string | null = selectedRucOrganizationId;

      // Fallback to role-based organization if no selected RUC
      if (!userOrganizationId && user?.roles) {
        const isAppAdmin = user.roles.some(r => r.role_name === "App Admin");
        if (!isAppAdmin) {
          const scopedRole = user.roles.find(r => ORG_SCOPED_ROLES.includes(r.role_name as RoleName));
          if (scopedRole?.scope_unit_id) {
            const scopeUnit = allUnitsData.find(u => u.id === scopedRole.scope_unit_id);
            userOrganizationId = scopeUnit?.organization_id || null;
          }
        }
      }

      let data = allUnitsData;
      // Filter units by user's organization (RUC)
      if (userOrganizationId) {
        data = data.filter(u => u.organization_id === userOrganizationId);
      }
      setUnits(data);
    } catch (err) {
      console.error("Error fetching units:", err);
    } finally {
      setLoading(false);
    }
  }, [user?.roles, selectedRucOrganizationId]);

  useEffect(() => {
    fetchUnits();
    // Set default dates (next 30 days) using local date
    const today = new Date();
    const thirtyDaysLater = new Date(today);
    thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
    // Use formatDateToString for local dates instead of toISOString (which is UTC)
    setStartDate(formatDateToString(today));
    setEndDate(formatDateToString(thirtyDaysLater));
  }, [fetchUnits]);

  // Auto-refresh when sync service detects data changes
  useSyncRefresh(["units", "dutyTypes", "personnel"], fetchUnits);

  // Build hierarchical unit options for dropdown
  const hierarchicalUnits = useMemo(() => {
    return buildHierarchicalUnitOptions(units);
  }, [units]);

  // Get the organization ID for the selected unit (for supernumerary)
  const selectedUnitOrganizationId = useMemo(() => {
    if (!selectedUnit) return null;
    const unit = units.find(u => u.id === selectedUnit);
    return unit?.organization_id || selectedRucOrganizationId || null;
  }, [selectedUnit, units, selectedRucOrganizationId]);

  // Helper to enrich slots with duty type and personnel info
  function enrichSlots(slots: DutySlot[]): EnrichedSlot[] {
    return slots.map((slot) => {
      const dutyType = getDutyTypeById(slot.duty_type_id);
      const personnel = slot.personnel_id ? getPersonnelById(slot.personnel_id) : undefined;
      return {
        ...slot,
        duty_type: dutyType ? { id: dutyType.id, duty_name: dutyType.duty_name, unit_section_id: dutyType.unit_section_id } : null,
        personnel: personnel ? { id: personnel.id, first_name: personnel.first_name, last_name: personnel.last_name, rank: personnel.rank, unit_section_id: personnel.unit_section_id } : null,
        assigned_by_info: {
          type: "scheduler" as const,
          display: "Automated by Scheduler",
        },
      };
    });
  }

  // Helper to enrich supernumerary assignments with duty type and personnel info
  function enrichSupernumerary(assignments: SupernumeraryAssignment[]): EnrichedSupernumeraryAssignment[] {
    return assignments.map((assignment) => {
      const dutyType = getDutyTypeById(assignment.duty_type_id);
      const personnel = getPersonnelById(assignment.personnel_id);
      return {
        ...assignment,
        duty_type_name: dutyType?.duty_name || "Unknown Duty",
        personnel_name: personnel
          ? `${personnel.last_name}, ${personnel.first_name}`
          : "Unknown",
        personnel_rank: personnel?.rank || "",
      };
    });
  }

  function handlePreview() {
    if (!selectedUnit || !startDate || !endDate) {
      setError("Please select a unit and date range");
      return;
    }

    setGenerating(true);
    setError("");
    setResult(null);
    setPreviewSlots([]);
    setPreviewSupernumerary([]);

    try {
      const request = {
        unitId: selectedUnit,
        startDate, // Already a DateString from input
        endDate,   // Already a DateString from input
        assignedBy: "admin",
        clearExisting,
      };

      const scheduleResult = previewSchedule(request);

      // Store the raw preview slots so we can apply exactly these later
      setPreviewSlots(scheduleResult.slots);

      // Preview supernumerary assignments if we have an organization ID
      let supernumeraryResult: { assignments: SupernumeraryAssignment[]; warnings: string[] } = {
        assignments: [],
        warnings: [],
      };
      if (selectedUnitOrganizationId) {
        supernumeraryResult = previewSupernumeraryAssignments(
          selectedUnit,
          selectedUnitOrganizationId,
          startDate,
          endDate
        );
        setPreviewSupernumerary(supernumeraryResult.assignments);
      }

      setResult({
        success: scheduleResult.success,
        preview: true,
        slots_created: scheduleResult.slotsCreated,
        slots_skipped: scheduleResult.slotsSkipped,
        errors: scheduleResult.errors,
        warnings: [...scheduleResult.warnings, ...supernumeraryResult.warnings],
        slots: enrichSlots(scheduleResult.slots),
        supernumerary_created: supernumeraryResult.assignments.length,
        supernumerary: enrichSupernumerary(supernumeraryResult.assignments),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate preview");
    } finally {
      setGenerating(false);
    }
  }

  function handleApply() {
    if (previewSlots.length === 0 && previewSupernumerary.length === 0) {
      setError("No preview to apply. Please preview first.");
      return;
    }

    setGenerating(true);
    setError("");

    try {
      // Apply the exact preview slots that were shown
      const applyResult = applyPreviewedSlots(
        previewSlots,
        clearExisting,
        startDate as `${number}-${number}-${number}`,
        endDate as `${number}-${number}-${number}`,
        selectedUnit
      );

      // Apply supernumerary assignments
      let supernumeraryApplyResult = { created: 0, warnings: [] as string[] };
      if (previewSupernumerary.length > 0) {
        supernumeraryApplyResult = applySupernumeraryAssignments(
          previewSupernumerary,
          clearExisting,
          startDate,
          endDate,
          selectedUnit
        );
      }

      // Update result to show applied (not preview)
      setResult({
        success: applyResult.success,
        preview: false,
        slots_created: applyResult.slotsCreated,
        slots_skipped: applyResult.slotsSkipped,
        errors: applyResult.errors,
        warnings: [...applyResult.warnings, ...supernumeraryApplyResult.warnings],
        slots: enrichSlots(applyResult.slots),
        supernumerary_created: supernumeraryApplyResult.created,
        supernumerary: enrichSupernumerary(previewSupernumerary),
      });

      // Clear preview after applying
      setPreviewSlots([]);
      setPreviewSupernumerary([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply schedule");
    } finally {
      setGenerating(false);
    }
  }

  function getDayType(dateStr: string): string {
    const date = parseLocalDate(dateStr);
    const day = date.getDay();
    // Simple weekend check
    if (day === 0 || day === 6) return "weekend";
    return "weekday";
  }

  function formatDate(dateStr: string): string {
    const date = parseLocalDate(dateStr);
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  function getUnitName(unitId: string): string {
    const unit = units.find((u) => u.id === unitId);
    return unit?.unit_name || "Unknown";
  }

  // Group slots by date for display
  function groupSlotsByDate(slots: EnrichedSlot[]): Map<string, EnrichedSlot[]> {
    const grouped = new Map<string, EnrichedSlot[]>();
    for (const slot of slots) {
      // Use the date_assigned string directly - it's already in YYYY-MM-DD format
      // Don't convert through new Date() as that parses as UTC and causes timezone issues
      const dateKey = slot.date_assigned;
      if (!grouped.has(dateKey)) {
        grouped.set(dateKey, []);
      }
      grouped.get(dateKey)!.push(slot);
    }
    return grouped;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-foreground-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Duty Thruster Scheduler</h1>
        <p className="text-foreground-muted mt-1">
          Auto-generate fair duty schedules based on duty scores and availability
        </p>
      </div>

      {/* Configuration Form */}
      <div className="bg-surface rounded-lg border border-border p-6 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Schedule Configuration</h2>

        {error && (
          <div className="p-3 bg-accent/20 text-accent rounded-lg text-sm">{error}</div>
        )}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Unit *
            </label>
            <select
              value={selectedUnit}
              onChange={(e) => setSelectedUnit(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono"
            >
              <option value="">Select Unit</option>
              {hierarchicalUnits.map((option) => (
                <option key={option.id} value={option.id}>
                  {formatUnitOptionLabel(option, true)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Start Date *
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              End Date *
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={clearExisting}
                onChange={(e) => setClearExisting(e.target.checked)}
                className="w-4 h-4 rounded border-border bg-background text-primary focus:ring-primary"
              />
              <span className="text-sm text-foreground">Clear existing slots</span>
            </label>
          </div>
        </div>

        <div className="flex gap-3 pt-4 border-t border-border">
          <Button
            onClick={handlePreview}
            variant="secondary"
            disabled={generating}
          >
            {generating ? "Processing..." : "Preview Schedule"}
          </Button>
          <Button
            onClick={handleApply}
            disabled={generating || (previewSlots.length === 0 && previewSupernumerary.length === 0)}
          >
            {generating ? "Processing..." : "Apply Schedule"}
          </Button>
        </div>

        <p className="text-xs text-foreground-muted">
          <strong>Preview</strong> shows what the schedule would look like without saving.{" "}
          <strong>Apply Schedule</strong> creates the exact duty assignments shown in the preview.
        </p>
      </div>

      {/* Algorithm Info */}
      <div className="bg-surface rounded-lg border border-border p-6">
        <h3 className="text-md font-semibold text-foreground mb-3">
          How Duty Thruster Works
        </h3>
        <div className="grid gap-4 md:grid-cols-3 text-sm">
          <div>
            <h4 className="font-medium text-highlight mb-1">Fairness First</h4>
            <p className="text-foreground-muted">
              Personnel with the lowest duty scores are assigned first, ensuring equitable
              distribution of duties.
            </p>
          </div>
          <div>
            <h4 className="font-medium text-highlight mb-1">Smart Point System</h4>
            <p className="text-foreground-muted">
              Weekends earn 1.5x points, holidays earn 2x points. Higher-burden duties
              can be weighted accordingly.
            </p>
          </div>
          <div>
            <h4 className="font-medium text-highlight mb-1">Qualification Aware</h4>
            <p className="text-foreground-muted">
              Only personnel with required qualifications are considered for each duty
              type.
            </p>
          </div>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="bg-surface rounded-lg border border-border p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              {result.preview ? "Schedule Preview" : "Applied Schedule"}
            </h2>
            <div className="flex gap-3 text-sm">
              <span className="text-green-400">
                {result.slots_created} slots {result.preview ? "planned" : "applied"}
              </span>
              {result.supernumerary_created > 0 && (
                <span className="text-blue-400">
                  {result.supernumerary_created} supernumerary
                </span>
              )}
              {result.slots_skipped > 0 && (
                <span className="text-yellow-400">{result.slots_skipped} skipped</span>
              )}
            </div>
          </div>

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <h4 className="text-sm font-medium text-yellow-400 mb-1">Warnings</h4>
              <ul className="text-xs text-yellow-300 space-y-1">
                {result.warnings.slice(0, 10).map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
                {result.warnings.length > 10 && (
                  <li>... and {result.warnings.length - 10} more</li>
                )}
              </ul>
            </div>
          )}

          {/* Debug: Supernumerary Info */}
          {result.preview && selectedUnit && (
            <SupernumeraryDebugInfo
              selectedUnit={selectedUnit}
              selectedUnitOrganizationId={selectedUnitOrganizationId}
              startDate={startDate}
            />
          )}

          {/* Errors */}
          {result.errors.length > 0 && (
            <div className="p-3 bg-accent/20 border border-accent/30 rounded-lg">
              <h4 className="text-sm font-medium text-accent mb-1">Errors</h4>
              <ul className="text-xs text-accent space-y-1">
                {result.errors.map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Slots by Date */}
          {result.slots.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-foreground">Duty Assignments</h3>
              <div className="max-h-[500px] overflow-y-auto space-y-4">
                {Array.from(groupSlotsByDate(result.slots).entries()).map(
                  ([dateKey, slots]) => (
                    <div key={dateKey} className="border-l-2 border-primary pl-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-foreground">
                          {formatDate(dateKey)}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-xs rounded-full ${
                            getDayType(dateKey) === "weekend"
                              ? "bg-highlight/20 text-highlight"
                              : "bg-foreground-muted/20 text-foreground-muted"
                          }`}
                        >
                          {getDayType(dateKey)}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {slots.map((slot) => (
                          <div
                            key={slot.id}
                            className="flex items-center justify-between bg-surface-elevated rounded px-3 py-2 text-sm"
                          >
                            <div className="flex items-center gap-3">
                              <span className="font-medium text-primary">
                                {slot.duty_type?.duty_name || "Unknown Duty"}
                              </span>
                              <span className="text-foreground">
                                {slot.personnel
                                  ? `${slot.personnel.rank} ${slot.personnel.last_name}, ${slot.personnel.first_name}`
                                  : "Unassigned"}
                              </span>
                            </div>
                            <span className="text-foreground-muted">
                              +{(slot.points ?? 0).toFixed(1)} pts
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          )}

          {result.slots.length === 0 && result.supernumerary.length === 0 && (
            <p className="text-foreground-muted text-center py-8">
              No duty slots were generated. Check that you have active duty types and
              available personnel for the selected unit.
            </p>
          )}

          {/* Supernumerary Assignments */}
          {result.supernumerary.length > 0 && (
            <div className="space-y-3 pt-4 border-t border-border">
              <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                Supernumerary Assignments (Standby Personnel)
              </h3>
              <p className="text-xs text-foreground-muted">
                Personnel on standby who can be activated if regular duty personnel are unavailable.
              </p>
              <div className="grid gap-2">
                {result.supernumerary.map((assignment) => (
                  <div
                    key={assignment.id}
                    className="flex items-center justify-between bg-blue-500/10 border border-blue-500/20 rounded px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-blue-400">
                        {assignment.duty_type_name}
                      </span>
                      <span className="text-foreground">
                        {assignment.personnel_rank} {assignment.personnel_name}
                      </span>
                    </div>
                    <span className="text-foreground-muted text-xs">
                      {assignment.period_start} to {assignment.period_end}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

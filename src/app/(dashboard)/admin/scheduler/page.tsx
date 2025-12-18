"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Button from "@/components/ui/Button";
import type { UnitSection } from "@/types";
import {
  getUnitSections,
  getDutyTypeById,
  getPersonnelById,
  type EnrichedSlot,
} from "@/lib/client-stores";
import { generateSchedule, previewSchedule } from "@/lib/duty-thruster";
import { useSyncRefresh } from "@/hooks/useSync";
import { buildHierarchicalUnitOptions, formatUnitOptionLabel } from "@/lib/unit-hierarchy";

interface ScheduleResult {
  success: boolean;
  preview: boolean;
  slots_created: number;
  slots_skipped: number;
  errors: string[];
  warnings: string[];
  slots: EnrichedSlot[];
}

export default function SchedulerPage() {
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

  const fetchUnits = useCallback(() => {
    try {
      const data = getUnitSections();
      setUnits(data);
    } catch (err) {
      console.error("Error fetching units:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUnits();
    // Set default dates (next 30 days)
    const today = new Date();
    const thirtyDaysLater = new Date(today);
    thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
    setStartDate(today.toISOString().split("T")[0]);
    setEndDate(thirtyDaysLater.toISOString().split("T")[0]);
  }, [fetchUnits]);

  // Auto-refresh when sync service detects data changes
  useSyncRefresh(["units", "dutyTypes", "personnel"], fetchUnits);

  // Build hierarchical unit options for dropdown
  const hierarchicalUnits = useMemo(() => {
    return buildHierarchicalUnitOptions(units);
  }, [units]);

  function handleGenerate(preview: boolean) {
    if (!selectedUnit || !startDate || !endDate) {
      setError("Please select a unit and date range");
      return;
    }

    setGenerating(true);
    setError("");
    setResult(null);

    try {
      const request = {
        unitId: selectedUnit,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        assignedBy: "admin",
        clearExisting,
      };

      const scheduleResult = preview
        ? previewSchedule(request)
        : generateSchedule(request);

      // Enrich slots with duty type and personnel info
      const enrichedSlots: EnrichedSlot[] = scheduleResult.slots.map((slot) => {
        const dutyType = getDutyTypeById(slot.duty_type_id);
        const personnel = slot.personnel_id ? getPersonnelById(slot.personnel_id) : undefined;
        return {
          ...slot,
          duty_type: dutyType ? { id: dutyType.id, duty_name: dutyType.duty_name, unit_section_id: dutyType.unit_section_id } : null,
          personnel: personnel ? { id: personnel.id, first_name: personnel.first_name, last_name: personnel.last_name, rank: personnel.rank } : null,
        };
      });

      setResult({
        success: scheduleResult.success,
        preview,
        slots_created: scheduleResult.slotsCreated,
        slots_skipped: scheduleResult.slotsSkipped,
        errors: scheduleResult.errors,
        warnings: scheduleResult.warnings,
        slots: enrichedSlots,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate schedule");
    } finally {
      setGenerating(false);
    }
  }

  function getDayType(dateStr: string): string {
    const date = new Date(dateStr);
    const day = date.getDay();
    // Simple weekend check
    if (day === 0 || day === 6) return "weekend";
    return "weekday";
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
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
      const dateKey = new Date(slot.date_assigned).toISOString().split("T")[0];
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
            onClick={() => handleGenerate(true)}
            variant="secondary"
            disabled={generating}
          >
            {generating ? "Processing..." : "Preview Schedule"}
          </Button>
          <Button onClick={() => handleGenerate(false)} disabled={generating}>
            {generating ? "Processing..." : "Generate Schedule"}
          </Button>
        </div>

        <p className="text-xs text-foreground-muted">
          <strong>Preview</strong> shows what the schedule would look like without saving.{" "}
          <strong>Generate</strong> creates the actual duty assignments.
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
              {result.preview ? "Schedule Preview" : "Generated Schedule"}
            </h2>
            <div className="flex gap-3 text-sm">
              <span className="text-green-400">
                {result.slots_created} slots {result.preview ? "planned" : "created"}
              </span>
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
                              +{slot.duty_points_earned.toFixed(1)} pts
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

          {result.slots.length === 0 && (
            <p className="text-foreground-muted text-center py-8">
              No duty slots were generated. Check that you have active duty types and
              available personnel for the selected unit.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

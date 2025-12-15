"use client";

import { useState, useEffect, useMemo } from "react";
import Button from "@/components/ui/Button";
import type { UnitSection, DutyType, Personnel, RoleName } from "@/types";
import {
  getUnitSections,
  getEnrichedSlots,
  getAllDutyTypes,
  getPersonnelByUnit,
  getDutyRequirements,
  hasQualification,
  getActiveNonAvailability,
  updateDutySlot,
  createDutySlot,
  type EnrichedSlot,
} from "@/lib/client-stores";
import { useAuth } from "@/lib/client-auth";

// Manager role names that can assign duties
const MANAGER_ROLES: RoleName[] = [
  "App Admin",
  "Unit Admin",
  "Unit Manager",
  "Company Manager",
  "Section Manager",
  "Work Section Manager",
];

export default function RosterPage() {
  const { user } = useAuth();
  const [slots, setSlots] = useState<EnrichedSlot[]>([]);
  const [units, setUnits] = useState<UnitSection[]>([]);
  const [dutyTypes, setDutyTypes] = useState<DutyType[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUnit, setSelectedUnit] = useState("");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedSlot, setSelectedSlot] = useState<EnrichedSlot | null>(null);

  // Assignment modal state
  const [assignmentModal, setAssignmentModal] = useState<{
    isOpen: boolean;
    date: Date | null;
    dutyType: DutyType | null;
    existingSlot: EnrichedSlot | null;
  }>({ isOpen: false, date: null, dutyType: null, existingSlot: null });
  const [assigning, setAssigning] = useState(false);

  // Check if user can assign duties
  const canAssignDuties = useMemo(() => {
    if (!user?.roles) return false;
    return user.roles.some(r => MANAGER_ROLES.includes(r.role_name as RoleName));
  }, [user?.roles]);

  // Get first and last day of the current month
  const { startDate, endDate, monthDays } = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0);

    // Generate array of days in the month
    const days: Date[] = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }

    return { startDate, endDate, monthDays: days };
  }, [currentDate]);

  useEffect(() => {
    fetchData();
  }, [selectedUnit, startDate, endDate]);

  function fetchData() {
    try {
      setLoading(true);

      // Fetch units
      const unitsData = getUnitSections();
      setUnits(unitsData);

      // Fetch all duty types
      const dutyTypesData = getAllDutyTypes();
      setDutyTypes(dutyTypesData);

      // Fetch duty slots for the date range
      const slotsData = getEnrichedSlots(startDate, endDate, selectedUnit || undefined);
      setSlots(slotsData);
    } catch (err) {
      console.error("Error fetching data:", err);
    } finally {
      setLoading(false);
    }
  }

  function navigateMonth(delta: number) {
    setCurrentDate((prev) => {
      const newDate = new Date(prev);
      newDate.setMonth(newDate.getMonth() + delta);
      return newDate;
    });
  }

  function goToToday() {
    setCurrentDate(new Date());
  }

  // Get slot for a specific date and duty type
  function getSlotForDateAndType(date: Date, dutyTypeId: string): EnrichedSlot | null {
    const dateStr = date.toISOString().split("T")[0];
    return slots.find((slot) => {
      const slotDateStr = new Date(slot.date_assigned).toISOString().split("T")[0];
      return slotDateStr === dateStr && slot.duty_type_id === dutyTypeId;
    }) || null;
  }

  function isToday(date: Date): boolean {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  }

  function isWeekend(date: Date): boolean {
    const day = date.getDay();
    return day === 0 || day === 6;
  }

  function formatMonthYear(date: Date): string {
    return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }

  function formatDate(date: Date): string {
    return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case "completed":
        return "bg-green-500/20 text-green-400";
      case "cancelled":
        return "bg-red-500/20 text-red-400 line-through";
      default:
        return "bg-primary/10 text-foreground";
    }
  }

  // Filter duty types based on selected unit
  const filteredDutyTypes = useMemo(() => {
    if (!selectedUnit) {
      return dutyTypes.filter(dt => dt.is_active);
    }
    return dutyTypes.filter(dt => dt.is_active && dt.unit_section_id === selectedUnit);
  }, [dutyTypes, selectedUnit]);

  // Get eligible personnel for a duty type on a specific date
  function getEligiblePersonnel(dutyType: DutyType, date: Date): Personnel[] {
    const unitPersonnel = getPersonnelByUnit(dutyType.unit_section_id);
    const requirements = getDutyRequirements(dutyType.id);

    return unitPersonnel.filter(person => {
      // Check if person is available (not on non-availability)
      const nonAvail = getActiveNonAvailability(person.id, date);
      if (nonAvail) return false;

      // Check qualifications if any are required
      if (requirements.length > 0) {
        const hasAllQuals = requirements.every(req =>
          hasQualification(person.id, req.required_qual_name)
        );
        if (!hasAllQuals) return false;
      }

      return true;
    });
  }

  // Handle cell click for assignment
  function handleCellClick(date: Date, dutyType: DutyType) {
    if (!canAssignDuties) return;

    const existingSlot = getSlotForDateAndType(date, dutyType.id);
    setAssignmentModal({
      isOpen: true,
      date,
      dutyType,
      existingSlot,
    });
  }

  // Handle personnel assignment
  function handleAssign(personnelId: string) {
    if (!assignmentModal.date || !assignmentModal.dutyType || !user) return;

    setAssigning(true);

    try {
      if (assignmentModal.existingSlot) {
        // Update existing slot (swap)
        updateDutySlot(assignmentModal.existingSlot.id, {
          personnel_id: personnelId,
          assigned_by: user.id,
        });
      } else {
        // Create new slot
        const newSlot = {
          id: crypto.randomUUID(),
          duty_type_id: assignmentModal.dutyType.id,
          personnel_id: personnelId,
          date_assigned: assignmentModal.date,
          assigned_by: user.id,
          duty_points_earned: 1.0, // Default points - could calculate based on day type
          status: "scheduled" as const,
          created_at: new Date(),
          updated_at: new Date(),
        };
        createDutySlot(newSlot);
      }

      // Refresh data and close modal
      fetchData();
      setAssignmentModal({ isOpen: false, date: null, dutyType: null, existingSlot: null });
    } catch (err) {
      console.error("Error assigning duty:", err);
    } finally {
      setAssigning(false);
    }
  }

  // Helper to properly escape a CSV cell
  function escapeCsvCell(cell: string | number | null | undefined): string {
    const str = String(cell ?? "");
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  // Export to CSV
  function exportToCSV() {
    const headers = ["Date", "Day", ...filteredDutyTypes.map(dt => dt.duty_name)];
    const rows = monthDays.map((date) => {
      const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
      const dateStr = date.toISOString().split("T")[0];

      const dutyAssignments = filteredDutyTypes.map(dt => {
        const slot = getSlotForDateAndType(date, dt.id);
        if (!slot) return "";
        if (!slot.personnel) return "Unassigned";
        return `${slot.personnel.rank} ${slot.personnel.last_name}`;
      });

      return [dateStr, dayName, ...dutyAssignments];
    });

    const csv = [
      headers.map(escapeCsvCell).join(","),
      ...rows.map((row) => row.map(escapeCsvCell).join(",")),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    a.download = `duty-roster-${year}-${String(month + 1).padStart(2, "0")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Print roster
  function printRoster() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const monthYear = formatMonthYear(currentDate);
    const unitName = selectedUnit
      ? units.find((u) => u.id === selectedUnit)?.unit_name || "Selected Unit"
      : "All Units";

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Duty Roster - ${monthYear}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; color: #333; font-size: 11px; }
            h1 { text-align: center; margin-bottom: 5px; font-size: 18px; }
            h2 { text-align: center; color: #666; margin-top: 0; font-weight: normal; font-size: 14px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 4px 6px; text-align: center; }
            th { background-color: #1A237E; color: white; font-size: 10px; }
            td { font-size: 10px; }
            tr:nth-child(even) { background-color: #f9f9f9; }
            .weekend { background-color: #FFF3E0; }
            .today { background-color: #E3F2FD; }
            .date-col { text-align: left; white-space: nowrap; }
            @media print {
              body { padding: 0; }
              button { display: none; }
            }
          </style>
        </head>
        <body>
          <h1>Duty Roster</h1>
          <h2>${monthYear} - ${unitName}</h2>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Day</th>
                ${filteredDutyTypes.map(dt => `<th>${dt.duty_name}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${monthDays.map((date) => {
                const isWeekendDay = isWeekend(date);
                const isTodayDate = isToday(date);
                const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
                const formattedDate = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

                return `
                  <tr class="${isWeekendDay ? "weekend" : ""} ${isTodayDate ? "today" : ""}">
                    <td class="date-col">${formattedDate}</td>
                    <td>${dayName}</td>
                    ${filteredDutyTypes.map(dt => {
                      const slot = getSlotForDateAndType(date, dt.id);
                      if (!slot) return '<td>-</td>';
                      if (!slot.personnel) return '<td style="color: #999;">Unassigned</td>';
                      return `<td>${slot.personnel.rank} ${slot.personnel.last_name}</td>`;
                    }).join("")}
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
          <p style="margin-top: 20px; text-align: center; color: #666; font-size: 10px;">
            Generated on ${new Date().toLocaleString()} by Duty Sync
          </p>
          <div style="text-align: center; margin-top: 20px;">
            <button onclick="window.print()" style="padding: 10px 20px; font-size: 14px; cursor: pointer;">
              Print / Save as PDF
            </button>
          </div>
        </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  }

  // Get eligible personnel for the assignment modal
  const eligiblePersonnel = useMemo(() => {
    if (!assignmentModal.isOpen || !assignmentModal.date || !assignmentModal.dutyType) {
      return [];
    }
    return getEligiblePersonnel(assignmentModal.dutyType, assignmentModal.date);
  }, [assignmentModal.isOpen, assignmentModal.date, assignmentModal.dutyType]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Duty Roster</h1>
          <p className="text-foreground-muted mt-1">
            {canAssignDuties
              ? "View and assign duty assignments by date and type"
              : "View duty assignments by date and type"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={exportToCSV}>
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={printRoster}>
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print / PDF
          </Button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-surface rounded-lg border border-border p-4">
        <div className="flex items-center gap-4">
          {/* Month Navigation */}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigateMonth(-1)}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Button>
            <h2 className="text-lg font-semibold text-foreground min-w-[180px] text-center">
              {formatMonthYear(currentDate)}
            </h2>
            <Button variant="ghost" size="sm" onClick={() => navigateMonth(1)}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Button>
          </div>
          <Button variant="secondary" size="sm" onClick={goToToday}>
            Today
          </Button>
        </div>

        {/* Unit Filter */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-foreground-muted">Filter by Unit:</label>
          <select
            value={selectedUnit}
            onChange={(e) => setSelectedUnit(e.target.value)}
            className="px-3 py-1.5 bg-background border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">All Units</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.unit_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Cross-Table Roster */}
      <div className="bg-surface rounded-lg border border-border overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-foreground-muted">Loading roster...</div>
          </div>
        ) : filteredDutyTypes.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <div className="text-foreground-muted">
              No duty types found. {selectedUnit ? "Try selecting a different unit or 'All Units'." : "Create duty types in the Duty Types page."}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface-elevated">
                  <th className="text-left px-3 py-3 text-sm font-medium text-foreground sticky left-0 bg-surface-elevated z-10 min-w-[100px]">
                    Date
                  </th>
                  <th className="text-center px-2 py-3 text-sm font-medium text-foreground min-w-[50px]">
                    Day
                  </th>
                  {filteredDutyTypes.map((dt) => (
                    <th
                      key={dt.id}
                      className="text-center px-3 py-3 text-sm font-medium text-foreground min-w-[120px]"
                      title={dt.description || dt.duty_name}
                    >
                      {dt.duty_name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthDays.map((date, idx) => {
                  const dateIsToday = isToday(date);
                  const dateIsWeekend = isWeekend(date);
                  const dayName = date.toLocaleDateString("en-US", { weekday: "short" });

                  return (
                    <tr
                      key={idx}
                      className={`border-b border-border last:border-0 ${
                        dateIsToday ? "bg-primary/10" : dateIsWeekend ? "bg-highlight/5" : ""
                      }`}
                    >
                      <td className={`px-3 py-2 text-sm sticky left-0 z-10 ${
                        dateIsToday ? "bg-primary/10 font-bold text-primary" : dateIsWeekend ? "bg-highlight/5" : "bg-surface"
                      }`}>
                        <span className={dateIsToday ? "text-primary" : dateIsWeekend ? "text-highlight" : "text-foreground"}>
                          {formatDate(date)}
                        </span>
                      </td>
                      <td className={`text-center px-2 py-2 text-sm ${
                        dateIsWeekend ? "text-highlight font-medium" : "text-foreground-muted"
                      }`}>
                        {dayName}
                      </td>
                      {filteredDutyTypes.map((dt) => {
                        const slot = getSlotForDateAndType(date, dt.id);

                        return (
                          <td
                            key={dt.id}
                            className={`text-center px-3 py-2 text-sm ${canAssignDuties ? "cursor-pointer hover:bg-primary/5" : ""}`}
                            onClick={() => canAssignDuties && handleCellClick(date, dt)}
                          >
                            {slot ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (canAssignDuties) {
                                    handleCellClick(date, dt);
                                  } else {
                                    setSelectedSlot(slot);
                                  }
                                }}
                                className={`px-2 py-1 rounded text-xs transition-colors hover:brightness-110 ${getStatusColor(slot.status)}`}
                              >
                                {slot.personnel ? (
                                  <span>
                                    {slot.personnel.rank} {slot.personnel.last_name}
                                  </span>
                                ) : (
                                  <span className="text-foreground-muted italic">Unassigned</span>
                                )}
                              </button>
                            ) : (
                              <span className={`text-foreground-muted/50 ${canAssignDuties ? "hover:text-primary" : ""}`}>
                                {canAssignDuties ? "+ Assign" : "-"}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-primary/10" />
          <span className="text-foreground-muted">Scheduled</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-green-500/20" />
          <span className="text-foreground-muted">Completed</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-red-500/20" />
          <span className="text-foreground-muted">Cancelled</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-highlight/10 border border-highlight/30" />
          <span className="text-foreground-muted">Weekend</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-primary/10 border border-primary" />
          <span className="text-foreground-muted">Today</span>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-foreground">{slots.length}</div>
          <div className="text-sm text-foreground-muted">Total Duties</div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-foreground">
            {slots.filter((s) => s.status === "scheduled").length}
          </div>
          <div className="text-sm text-foreground-muted">Scheduled</div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-green-400">
            {slots.filter((s) => s.status === "completed").length}
          </div>
          <div className="text-sm text-foreground-muted">Completed</div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-red-400">
            {slots.filter((s) => s.status === "cancelled").length}
          </div>
          <div className="text-sm text-foreground-muted">Cancelled</div>
        </div>
      </div>

      {/* Slot Detail Modal (read-only) */}
      {selectedSlot && !assignmentModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Duty Details</h2>
              <button
                onClick={() => setSelectedSlot(null)}
                className="text-foreground-muted hover:text-foreground"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="text-sm text-foreground-muted">Duty Type</label>
                <p className="text-foreground font-medium">
                  {selectedSlot.duty_type?.duty_name || "Unknown"}
                </p>
              </div>
              <div>
                <label className="text-sm text-foreground-muted">Assigned To</label>
                <p className="text-foreground font-medium">
                  {selectedSlot.personnel
                    ? `${selectedSlot.personnel.rank} ${selectedSlot.personnel.first_name} ${selectedSlot.personnel.last_name}`
                    : "Unassigned"}
                </p>
              </div>
              <div>
                <label className="text-sm text-foreground-muted">Date</label>
                <p className="text-foreground">
                  {new Date(selectedSlot.date_assigned).toLocaleDateString("en-US", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
              </div>
              <div className="flex gap-4">
                <div>
                  <label className="text-sm text-foreground-muted">Status</label>
                  <p>
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-sm ${getStatusColor(selectedSlot.status)}`}
                    >
                      {selectedSlot.status.charAt(0).toUpperCase() + selectedSlot.status.slice(1)}
                    </span>
                  </p>
                </div>
                <div>
                  <label className="text-sm text-foreground-muted">Points Earned</label>
                  <p className="text-foreground font-medium">
                    {selectedSlot.duty_points_earned.toFixed(1)} pts
                  </p>
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-border flex justify-end">
              <Button variant="ghost" onClick={() => setSelectedSlot(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Assignment Modal */}
      {assignmentModal.isOpen && assignmentModal.date && assignmentModal.dutyType && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border w-full max-w-lg">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  {assignmentModal.existingSlot ? "Swap Duty Assignment" : "Assign Duty"}
                </h2>
                <p className="text-sm text-foreground-muted mt-1">
                  {assignmentModal.dutyType.duty_name} - {formatDate(assignmentModal.date)}
                </p>
              </div>
              <button
                onClick={() => setAssignmentModal({ isOpen: false, date: null, dutyType: null, existingSlot: null })}
                className="text-foreground-muted hover:text-foreground"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4">
              {/* Current assignment info */}
              {assignmentModal.existingSlot?.personnel && (
                <div className="mb-4 p-3 bg-primary/10 rounded-lg">
                  <p className="text-sm text-foreground-muted">Currently Assigned:</p>
                  <p className="text-foreground font-medium">
                    {assignmentModal.existingSlot.personnel.rank} {assignmentModal.existingSlot.personnel.first_name} {assignmentModal.existingSlot.personnel.last_name}
                  </p>
                </div>
              )}

              {/* Eligible personnel list */}
              <div className="space-y-2">
                <p className="text-sm text-foreground-muted">
                  Select personnel to assign ({eligiblePersonnel.length} eligible):
                </p>

                {eligiblePersonnel.length === 0 ? (
                  <div className="text-center py-8 text-foreground-muted">
                    <p>No eligible personnel found.</p>
                    <p className="text-xs mt-1">Check qualifications and non-availability.</p>
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto space-y-1">
                    {eligiblePersonnel.map((person) => {
                      const isCurrentlyAssigned = assignmentModal.existingSlot?.personnel?.id === person.id;

                      return (
                        <button
                          key={person.id}
                          onClick={() => !isCurrentlyAssigned && handleAssign(person.id)}
                          disabled={assigning || isCurrentlyAssigned}
                          className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                            isCurrentlyAssigned
                              ? "bg-primary/20 text-primary cursor-default"
                              : "bg-surface-elevated hover:bg-primary/10 text-foreground"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="font-medium">{person.rank} {person.last_name}, {person.first_name}</span>
                              <span className="text-xs text-foreground-muted ml-2">
                                Score: {person.current_duty_score.toFixed(1)}
                              </span>
                            </div>
                            {isCurrentlyAssigned && (
                              <span className="text-xs bg-primary/30 px-2 py-0.5 rounded">Current</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-border flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setAssignmentModal({ isOpen: false, date: null, dutyType: null, existingSlot: null })}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
